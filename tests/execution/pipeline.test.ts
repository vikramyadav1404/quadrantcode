/**
 * F3.1 · the execution pipeline against a real database.
 *
 * Four acceptance criteria live here: the hourly limit's message, the
 * concurrency cap under genuine parallelism, an outage degrading rather than
 * crashing, and an external-link problem never being compared against anything.
 *
 * The provider is the fake throughout — **there is no Judge0 instance** — which
 * is exactly why the seam exists: everything except the execution itself can be
 * exercised today.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executionJobs, problems, runAttempts } from '@/server/db/schema';
import {
  CONCURRENT_LIMIT,
  type ExecutionRunner,
  FakeExecutionProvider,
  HOURLY_LIMIT,
  ProviderUnavailableError,
  getExecution,
  runExecutionJob,
  submitExecution,
  sweepStalledExecutions,
} from '@/server/services/execution';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const NOW = new Date('2026-04-02T10:00:00.000Z');

/** Records what it was asked to run, and runs nothing. */
class RecordingRunner implements ExecutionRunner {
  readonly enqueued: string[] = [];

  async enqueue(jobId: string): Promise<void> {
    this.enqueued.push(jobId);
  }
}

/** A provider that is always down. */
class DeadProvider extends FakeExecutionProvider {
  override async execute(): Promise<never> {
    throw new ProviderUnavailableError('judge0', 'connection refused');
  }
}

suite('F3.1 · the execution pipeline', () => {
  let ctx: TestContext;
  let userId: string;
  let externalProblemId: string;
  let runner: RecordingRunner;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'execution@example.com' })).id;
    runner = new RecordingRunner();

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'two-sum',
        title: 'Two Sum',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'easy',
      })
      .returning();
    externalProblemId = problem!.id;
  });

  const submit = (overrides: Partial<Parameters<typeof submitExecution>[1]> = {}) =>
    submitExecution(ctx.db, {
      userId,
      problemId: externalProblemId,
      language: 'python3',
      source: 'print(1)',
      now: NOW,
      runner,
      featureFlags: { FEATURE_EXECUTION: 'true' },
      ...overrides,
    });

  describe('submitting', () => {
    it('FEATURE_EXECUTION disabled creates neither a job nor a dispatch', async () => {
      const result = await submit({ featureFlags: { FEATURE_EXECUTION: 'false' } });
      expect(result).toMatchObject({ ok: false, limit: { reason: 'invalid' } });
      expect(await ctx.db.select().from(executionJobs)).toHaveLength(0);
      expect(runner.enqueued).toEqual([]);
    });

    it('writes a queued job and hands the id to the runner', async () => {
      const result = await submit();

      expect(result.ok).toBe(true);
      const [job] = await ctx.db.select().from(executionJobs);
      expect(job?.status).toBe('queued');
      expect(job?.finishedAt).toBeNull();
      expect(runner.enqueued).toEqual([job!.id]);
    });

    it('THE REQUEST PATH NEVER RUNS THE CODE', async () => {
      /*
       * The ticket's architectural requirement. A submission that waited on the
       * provider would hold the invocation open for as long as someone's
       * infinite loop takes to be killed.
       */
      await submit();

      const [job] = await ctx.db.select().from(executionJobs);
      expect(job?.status).toBe('queued');
      expect(job?.startedAt).toBeNull();
      expect(await ctx.db.select().from(runAttempts)).toHaveLength(0);
    });
  });

  describe('running', () => {
    it('moves queued → running → completed and records the result', async () => {
      const submitted = await submit();
      if (!submitted.ok) throw new Error('submission was refused');

      await runExecutionJob(ctx.db, new FakeExecutionProvider(), submitted.jobId, NOW);

      const [job] = await ctx.db.select().from(executionJobs);
      expect(job?.status).toBe('completed');
      expect(job?.startedAt).not.toBeNull();
      expect(job?.finishedAt).not.toBeNull();

      const [attempt] = await ctx.db.select().from(runAttempts);
      expect(attempt?.verdict).toBe('accepted');
      expect(attempt?.language).toBe('python3');
      expect(attempt?.runtimeMs).toBeGreaterThan(0);
    });

    it('acknowledges a duplicate delivery without running twice', async () => {
      const submitted = await submit();
      if (!submitted.ok) throw new Error('submission was refused');

      await runExecutionJob(ctx.db, new FakeExecutionProvider(), submitted.jobId, NOW);

      expect(
        await runExecutionJob(ctx.db, new FakeExecutionProvider(), submitted.jobId, NOW),
      ).toEqual({ kind: 'noop' });
      expect(await ctx.db.select().from(runAttempts)).toHaveLength(1);
    });

    it('AN OUTAGE RETRIES, THEN FAILS TERMINALLY WITH NO VERDICT', async () => {
      /*
       * The acceptance criterion. "Judge0 is down" and "your code is wrong"
       * must never reach a user as the same thing — so the job fails, and NO
       * `run_attempts` row is written. An `internal_error` verdict would be a
       * statement about their program that nothing observed.
       */
      const submitted = await submit();
      if (!submitted.ok) throw new Error('submission was refused');

      expect(await runExecutionJob(ctx.db, new DeadProvider(), submitted.jobId, NOW)).toEqual({
        kind: 'retry',
        afterSeconds: 15,
      });
      await runExecutionJob(
        ctx.db,
        new DeadProvider(),
        submitted.jobId,
        new Date(NOW.getTime() + 16_000),
      );
      await runExecutionJob(
        ctx.db,
        new DeadProvider(),
        submitted.jobId,
        new Date(NOW.getTime() + 77_000),
      );

      const [job] = await ctx.db.select().from(executionJobs);
      expect(job?.status).toBe('failed');
      expect(job?.error).toContain('after several attempts');
      expect(await ctx.db.select().from(runAttempts)).toHaveLength(0);
    });

    it('stores a sanitized retry code without a provider error body', async () => {
      const submitted = await submit();
      if (!submitted.ok) throw new Error('submission was refused');

      await runExecutionJob(ctx.db, new DeadProvider(), submitted.jobId, NOW);

      const [job] = await ctx.db.select().from(executionJobs);
      expect(job!.status).toBe('queued');
      expect(job!.lastErrorCode).toBe('PROVIDER_UNAVAILABLE');
      expect(job!.error).toBeNull();
    });
  });

  describe('C1 · an external-link problem is a scratchpad', () => {
    it('NEVER COMPARES OUTPUT, AND RECORDS NO TEST COUNTS', async () => {
      /*
       * The acceptance criterion, and the constraint behind it: we do not hold
       * another platform's test cases, so there is nothing to compare against.
       * `0 / 0` would read as a failure rather than as "not applicable".
       */
      const submitted = await submit();
      if (!submitted.ok) throw new Error('submission was refused');

      await runExecutionJob(ctx.db, new FakeExecutionProvider(), submitted.jobId, NOW);

      const [attempt] = await ctx.db.select().from(runAttempts);
      expect(attempt?.testsPassed).toBeNull();
      expect(attempt?.testsTotal).toBeNull();

      const view = await getExecution(ctx.db, { userId, jobId: submitted.jobId });
      expect(view?.scratchpad).toBe(true);
    });

    it('passes the user stdin through and shows the output', async () => {
      const submitted = await submit({ stdin: '4 5\n' });
      if (!submitted.ok) throw new Error('submission was refused');

      await runExecutionJob(ctx.db, new FakeExecutionProvider(), submitted.jobId, NOW);

      const view = await getExecution(ctx.db, { userId, jobId: submitted.jobId });
      expect(view?.stdout).toContain('4 5');
    });
  });

  describe('limits', () => {
    it('THE HOURLY LIMIT NAMES THE TIME IT RESETS', async () => {
      // The acceptance criterion: "too many requests" is not actionable.
      for (let index = 0; index < HOURLY_LIMIT; index += 1) {
        await ctx.db.insert(executionJobs).values({
          userId,
          problemId: externalProblemId,
          language: 'python3',
          source: `print(${index})`,
          status: 'completed',
          finishedAt: NOW,
          createdAt: new Date(NOW.getTime() - 30 * 60_000),
        });
      }

      const refused = await submit();

      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('expected a refusal');
      expect(refused.limit.reason).toBe('hourly');
      // Thirty minutes into the window, so capacity returns thirty minutes on.
      expect(refused.limit.message).toContain('10:30');
      expect(refused.limit.retryAt).not.toBeNull();
    });

    it('the concurrency message offers no time, because there is none', async () => {
      /*
       * A concurrent limit clears when a run finishes, not at a clock time.
       * Inventing one would be a promise nothing keeps.
       */
      for (let index = 0; index < CONCURRENT_LIMIT; index += 1) {
        await ctx.db.insert(executionJobs).values({
          userId,
          problemId: externalProblemId,
          language: 'python3',
          source: `print(${index})`,
          status: 'running',
          startedAt: NOW,
        });
      }

      const refused = await submit();
      if (refused.ok) throw new Error('expected a refusal');

      expect(refused.limit.reason).toBe('concurrent');
      expect(refused.limit.retryAt).toBeNull();
      expect(refused.limit.message).not.toMatch(/\d{2}:\d{2}/);
    });

    it('THE CONCURRENCY CAP HOLDS UNDER PARALLEL SUBMISSION', async () => {
      /*
       * The acceptance criterion, and the one that check-then-insert fails.
       * Six submissions arriving together each read a count of four and each
       * decide they are the fifth — unless the check and the insert are
       * serialised per user, which is what the advisory lock does.
       */
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_LIMIT + 3 }, () => submit()),
      );

      const accepted = results.filter((result) => result.ok);
      const refused = results.filter((result) => !result.ok);

      expect(accepted).toHaveLength(CONCURRENT_LIMIT);
      expect(refused).toHaveLength(3);

      const live = await ctx.sql`
        SELECT id FROM execution_jobs WHERE status in ('queued','running')
      `;
      expect(live).toHaveLength(CONCURRENT_LIMIT);
    });

    it('a refused submission leaves no row behind', async () => {
      // Otherwise the rejected rows count against the very limit that rejected
      // them, and the user is locked out for an hour by their own retries.
      for (let index = 0; index < CONCURRENT_LIMIT; index += 1) {
        await ctx.db.insert(executionJobs).values({
          userId,
          problemId: externalProblemId,
          language: 'python3',
          source: 'x',
          status: 'queued',
        });
      }

      await submit();

      const rows = await ctx.db.select().from(executionJobs);
      expect(rows).toHaveLength(CONCURRENT_LIMIT);
    });

    it("counts only this user's executions", async () => {
      const other = await createUser(ctx.db, { email: 'other-exec@example.com' });

      for (let index = 0; index < CONCURRENT_LIMIT; index += 1) {
        await ctx.db.insert(executionJobs).values({
          userId: other.id,
          problemId: externalProblemId,
          language: 'python3',
          source: 'x',
          status: 'running',
          startedAt: NOW,
        });
      }

      expect((await submit()).ok).toBe(true);
    });

    it('enforces the shared UTC-day free-tier admission limit', async () => {
      const other = await createUser(ctx.db, { email: 'daily-cap@example.com' });
      for (let index = 0; index < 20; index += 1) {
        await ctx.db.insert(executionJobs).values({
          userId: other.id,
          problemId: externalProblemId,
          language: 'python3',
          source: `print(${index})`,
          status: 'completed',
          finishedAt: NOW,
          createdAt: NOW,
        });
      }
      const refused = await submit();
      expect(refused).toMatchObject({
        ok: false,
        limit: { reason: 'global_daily', retryAt: expect.any(Date) },
      });
    });
  });

  describe('the stall sweep', () => {
    it('FAILS A JOB WHOSE RUNNER WENT AWAY, FREEING THE CAP', async () => {
      /*
       * The consequence that matters most: a stuck `running` row counts against
       * the concurrency cap forever, so five dead jobs lock a user out of the
       * feature entirely.
       */
      await ctx.db.insert(executionJobs).values({
        userId,
        problemId: externalProblemId,
        language: 'python3',
        source: 'x',
        status: 'running',
        startedAt: new Date(NOW.getTime() - 600_000),
        heartbeatAt: new Date(NOW.getTime() - 600_000),
      });

      const swept = await sweepStalledExecutions(ctx.db, NOW);
      expect(swept).toBe(1);

      const [job] = await ctx.db.select().from(executionJobs);
      expect(job?.status).toBe('failed');
      expect(job?.error).toContain('may or may not have run');

      expect((await submit()).ok).toBe(true);
    });

    it('leaves a job that is merely slow alone', async () => {
      await ctx.db.insert(executionJobs).values({
        userId,
        problemId: externalProblemId,
        language: 'python3',
        source: 'x',
        status: 'running',
        startedAt: NOW,
        heartbeatAt: new Date(NOW.getTime() - 5_000),
      });

      expect(await sweepStalledExecutions(ctx.db, NOW)).toBe(0);
    });
  });

  describe('reading a result', () => {
    it("returns nothing for another user's execution", async () => {
      const submitted = await submit();
      if (!submitted.ok) throw new Error('submission was refused');

      const intruder = await createUser(ctx.db, { email: 'intruder-exec@example.com' });

      expect(
        await getExecution(ctx.db, { userId: intruder.id, jobId: submitted.jobId }),
      ).toBeNull();
    });

    it('reports a queued job with no verdict rather than a placeholder one', async () => {
      const submitted = await submit();
      if (!submitted.ok) throw new Error('submission was refused');

      const view = await getExecution(ctx.db, { userId, jobId: submitted.jobId });
      expect(view?.status).toBe('queued');
      expect(view?.verdict).toBeNull();
    });
  });
});
