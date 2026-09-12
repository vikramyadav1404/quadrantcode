import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executionJobs, problems, runAttempts } from '@/server/db/schema';
import {
  claimExecutionJob,
  finalizeClaimedExecution,
  heartbeatExecutionJob,
  retryClaimedExecution,
} from '@/server/services/execution';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const NOW = new Date('2026-09-08T10:00:00.000Z');

suite('execution leases and fencing', () => {
  let ctx: TestContext;
  let jobId: string;
  let userId: string;
  let problemId: string;

  beforeAll(async () => {
    /*
     * A real pool, not the default single connection. The hundred-way test
     * below asserts that concurrent deliveries contend for one lease; on
     * `max: 1` postgres.js would queue all hundred claims onto one connection
     * and the assertion would hold because nothing ever raced, which is the
     * shape of a test that passes for the wrong reason.
     */
    ctx = await setupTestDb({ max: 16 });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db)).id;
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'lease-contract',
        title: 'Lease Contract',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'easy',
      })
      .returning();
    problemId = problem!.id;
    const [job] = await ctx.db
      .insert(executionJobs)
      .values({
        userId,
        problemId,
        language: 'python3',
        source: 'print(1)',
        backend: 'vercel_sandbox',
        nextAttemptAt: NOW,
      })
      .returning();
    jobId = job!.id;
  });

  it('one hundred simultaneous deliveries produce one active lease', async () => {
    /*
     * allSettled, not all: `Promise.all` rejects on the first failure and
     * reports that one error, which would hide ninety-eight others and say
     * nothing about how the losers failed. Losing a race must be an ordinary
     * return value — a deadlock, a serialisation failure or a pool timeout is
     * a different outcome entirely, and at-least-once delivery means the losers
     * are the common case, not the exceptional one.
     */
    const settled = await Promise.allSettled(
      Array.from({ length: 100 }, () => claimExecutionJob(ctx.db, jobId, NOW)),
    );

    const rejected = settled.filter((result) => result.status === 'rejected');
    expect(rejected.map((result) => String(result.reason))).toEqual([]);

    const claims = settled.map((result) => {
      if (result.status !== 'fulfilled') throw new Error('unreachable, asserted above');
      return result.value;
    });

    expect(claims.filter((claim) => claim.kind === 'claimed')).toHaveLength(1);

    const losers = claims.filter((claim) => claim.kind !== 'claimed');
    expect(losers).toHaveLength(99);

    // Every loser says the same ordinary thing: somebody else holds the lease,
    // come back later. Not 'noop' (which would mean the row vanished) and not
    // 'capacity' (which would mean the ceiling, not the race, refused them).
    for (const loser of losers) {
      expect(loser.kind).toBe('retry');
      if (loser.kind !== 'retry') continue;
      expect(loser.reason).toBe('leased');
      expect(loser.afterSeconds).toBeGreaterThan(0);
    }
  });

  it('reclaims an expired lease and fences the stale worker', async () => {
    const first = await claimExecutionJob(ctx.db, jobId, NOW);
    if (first.kind !== 'claimed') throw new Error('expected first claim');
    const later = new Date(NOW.getTime() + 76_000);
    const second = await claimExecutionJob(ctx.db, jobId, later);
    if (second.kind !== 'claimed') throw new Error('expected lease reclamation');
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(heartbeatExecutionJob(ctx.db, jobId, first.leaseToken, later)).rejects.toThrow(
      /temporarily unavailable/i,
    );

    const stale = await finalizeClaimedExecution(ctx.db, {
      jobId,
      leaseToken: first.leaseToken,
      finishedAt: later,
      attempt: {
        jobId,
        userId,
        problemId,
        language: 'python3',
        verdict: 'accepted',
      },
      applyEffects: async () => undefined,
    });
    expect(stale).toBe('stale');
    expect(await ctx.db.select().from(runAttempts)).toHaveLength(0);
  });

  it('the third infrastructure failure is terminal', async () => {
    let at = NOW;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await claimExecutionJob(ctx.db, jobId, at);
      if (claim.kind !== 'claimed') throw new Error('expected claim');
      const result = await retryClaimedExecution(ctx.db, {
        jobId,
        leaseToken: claim.leaseToken,
        attempt: claim.attempt,
        code: 'SANDBOX_TEMPORARY',
        now: at,
      });
      expect(result.terminal).toBe(attempt === 3);
      at = new Date(at.getTime() + (result.afterSeconds ?? 0) * 1_000 + 1);
    }
    const [job] = await ctx.db.select().from(executionJobs);
    expect(job).toMatchObject({
      status: 'failed',
      attemptCount: 3,
      lastErrorCode: 'SANDBOX_TEMPORARY',
    });
  });
});
