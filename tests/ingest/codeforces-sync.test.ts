/**
 * Codeforces sync: the pure mapping, and the sync against a real database with
 * the network stubbed. Outcomes are read back from the tables, not trusted from
 * the return value.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codeforcesLinks, problems, userProblems } from '@/server/db/schema';
import {
  CODEFORCES_SYNC_COOLDOWN_MS,
  CodeforcesSyncError,
  acceptedProblems,
  saveCodeforcesHandle,
  syncCodeforces,
} from '@/server/services/ingest/codeforces-sync';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const sub = (
  contestId: number,
  index: string,
  name: string,
  verdict: string,
  seconds: number,
  rating?: number,
) => ({
  creationTimeSeconds: seconds,
  verdict,
  problem: { contestId, index, name, rating, tags: ['dp', 'greedy'] },
});

const SUBMISSIONS = [
  sub(4, 'A', 'Watermelon', 'OK', 2_000, 800),
  sub(4, 'A', 'Watermelon', 'OK', 1_000, 800), // earlier accept wins
  sub(4, 'A', 'Watermelon', 'WRONG_ANSWER', 500, 800),
  sub(1520, 'G', 'To Go Or Not To Go?', 'OK', 3_000, 2200),
  sub(71, 'A', 'Way Too Long Words', 'TIME_LIMIT_EXCEEDED', 4_000, 800),
  sub(102_001, 'A', 'Gym problem', 'OK', 5_000), // gym: skipped
];

const stub =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe('acceptedProblems (pure)', () => {
  it('keeps one row per accepted problem, dated by the first accept', () => {
    const rows = acceptedProblems(SUBMISSIONS);
    expect(rows.map((problem) => problem.row.title)).toEqual([
      'Watermelon',
      'To Go Or Not To Go?',
    ]);
    expect(rows[0]!.firstAcceptedAt.getTime()).toBe(1_000_000);
    expect(rows[0]!.row.url).toBe('https://codeforces.com/problemset/problem/4/A');
    expect(rows[0]!.row.difficulty).toBe('easy');
    expect(rows[1]!.row.difficulty).toBe('hard');
    expect(rows[0]!.row.topics).toContain('dynamic-programming');
  });

  it('skips rejected verdicts and gym problems', () => {
    const titles = acceptedProblems(SUBMISSIONS).map((problem) => problem.row.title);
    expect(titles).not.toContain('Way Too Long Words');
    expect(titles).not.toContain('Gym problem');
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('syncCodeforces', () => {
  let ctx: TestContext;
  let userId: string;
  const now = new Date('2026-11-18T12:00:00Z');

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'cf@example.com' })).id;
  });

  it('imports accepted problems as private drafts and marks them solved', async () => {
    await saveCodeforcesHandle(ctx.db, userId, 'tourist');
    const result = await syncCodeforces(ctx.db, {
      userId,
      now,
      fetchImpl: stub({ status: 'OK', result: SUBMISSIONS }),
    });
    expect(result).toEqual({
      accepted: 2,
      created: 2,
      linked: 0,
      alreadyTracked: 0,
      markedSolved: 2,
    });

    const rows = await ctx.db
      .select({ status: userProblems.status, firstSolvedAt: userProblems.firstSolvedAt })
      .from(userProblems)
      .where(eq(userProblems.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'solved')).toBe(true);
    expect(rows.map((row) => row.firstSolvedAt?.getTime()).sort()).toEqual([
      1_000_000, 3_000_000,
    ]);

    const created = await ctx.db.select({ status: problems.status }).from(problems);
    expect(created.every((problem) => problem.status === 'draft')).toBe(true);

    const [link] = await ctx.db.select().from(codeforcesLinks);
    expect(link!.lastResult).toMatchObject({ accepted: 2, markedSolved: 2 });
  });

  it('is idempotent, never downgrades, and respects the cooldown', async () => {
    await saveCodeforcesHandle(ctx.db, userId, 'tourist');
    const fetchImpl = stub({ status: 'OK', result: SUBMISSIONS });
    await syncCodeforces(ctx.db, { userId, now, fetchImpl });

    // The user moves one problem on to revision; a later sync must leave it.
    const [first] = await ctx.db.select().from(userProblems).limit(1);
    await ctx.db
      .update(userProblems)
      .set({ status: 'needs_revision' })
      .where(eq(userProblems.id, first!.id));

    await expect(
      syncCodeforces(ctx.db, { userId, now: new Date(now.getTime() + 60_000), fetchImpl }),
    ).rejects.toThrow(/Synced recently/);

    const later = new Date(now.getTime() + CODEFORCES_SYNC_COOLDOWN_MS + 1);
    const again = await syncCodeforces(ctx.db, { userId, now: later, fetchImpl });
    expect(again).toMatchObject({ created: 0, alreadyTracked: 2, markedSolved: 0 });

    const [kept] = await ctx.db
      .select({ status: userProblems.status })
      .from(userProblems)
      .where(and(eq(userProblems.id, first!.id)));
    expect(kept!.status).toBe('needs_revision');
    expect(await ctx.db.select().from(problems)).toHaveLength(2);
  });

  it('records a failure, gives the slot back, and rejects bad handles', async () => {
    await expect(saveCodeforcesHandle(ctx.db, userId, 'no spaces!')).rejects.toBeInstanceOf(
      CodeforcesSyncError,
    );

    await saveCodeforcesHandle(ctx.db, userId, 'ghost_user');
    await expect(
      syncCodeforces(ctx.db, {
        userId,
        now,
        fetchImpl: stub(
          { status: 'FAILED', comment: 'handle: User with handle ghost_user not found' },
          400,
        ),
      }),
    ).rejects.toThrow(/No Codeforces user is called ghost_user/);

    const [link] = await ctx.db.select().from(codeforcesLinks);
    expect(link!.lastSyncedAt).toBeNull();
    expect(link!.lastResult).toMatchObject({ error: expect.stringMatching(/ghost_user/) });
    expect(await ctx.db.select().from(userProblems)).toHaveLength(0);
  });
});
