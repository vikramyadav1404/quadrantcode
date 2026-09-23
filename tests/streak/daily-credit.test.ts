/**
 * F1.3 · `creditSolvedDay`, against a real Postgres.
 *
 * There were two private copies of this, one per solve path, both doing
 * `solved_count + 1` unconditionally. An accepted Submit credited the day, and
 * pressing "Solved" on the same session credited it again — which is not an
 * exotic race but the ordinary workflow, because the solve page has no
 * auto-complete.
 *
 * It is now derived rather than accumulated, so the property to assert is
 * IDEMPOTENCE: calling it repeatedly, from either path, cannot inflate the
 * count. An incrementing implementation fails every test in the first block.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dailySessions,
  executionJobs,
  problems,
  runAttempts,
  solveSessions,
} from '@/server/db/schema';
import { creditSolvedDay } from '@/server/services/streak';
import { and, eq } from 'drizzle-orm';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const LOCAL_DATE = '2026-09-23';
const NOW = new Date('2026-09-23T10:00:00.000Z');
const TZ = 'Asia/Kolkata';

suite('F1.3 · creditSolvedDay is idempotent across both solve paths', () => {
  let ctx: TestContext;
  let userId = '';

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    const user = await createUser(ctx.db, { timezone: TZ });
    userId = user.id;
  });

  async function makeProblem(slug: string): Promise<string> {
    const [row] = await ctx.db
      .insert(problems)
      .values({
        slug,
        title: `Problem ${slug}`,
        sourceType: 'original',
        difficulty: 'medium',
        statement: 'Our own original statement text.',
      })
      .returning({ id: problems.id });
    return row!.id;
  }

  /** A session that ended `solved` on the local date under test. */
  async function solvedSession(problemId: string): Promise<string> {
    const [row] = await ctx.db
      .insert(solveSessions)
      .values({
        userId,
        problemId,
        status: 'solved',
        startedAt: new Date(NOW.getTime() - 600_000),
        endedAt: NOW,
        // `solve_sessions_heartbeat_after_start`: the column defaults to real
        // now(), which is before these fixed fixture timestamps.
        lastHeartbeatAt: NOW,
        startedLocalDate: LOCAL_DATE,
        endedLocalDate: LOCAL_DATE,
      })
      .returning({ id: solveSessions.id });
    return row!.id;
  }

  /** An accepted Submit on the same day — the other path into the same counter. */
  async function acceptedSubmit(problemId: string, sessionId: string | null): Promise<void> {
    const [job] = await ctx.db
      .insert(executionJobs)
      .values({
        userId,
        problemId,
        sessionId,
        language: 'python3',
        mode: 'submit',
        status: 'completed',
        source: 'def solve(values):\n    return values[0]',
        // `execution_jobs_terminal_has_end`: a terminal status needs an end.
        startedAt: new Date(NOW.getTime() - 5_000),
        finishedAt: NOW,
      })
      .returning({ id: executionJobs.id });
    await ctx.db.insert(runAttempts).values({
      jobId: job!.id,
      userId,
      problemId,
      sessionId,
      language: 'python3',
      verdict: 'accepted',
      // `run_attempts_server_verification_coherent`: a verified attempt has to
      // say when, and by whom.
      serverVerified: true,
      serverVerifiedAt: NOW,
      providerName: 'judge0',
      createdAt: NOW,
    });
  }

  const solvedCount = async () => {
    const [row] = await ctx.db
      .select({ solvedCount: dailySessions.solvedCount })
      .from(dailySessions)
      .where(and(eq(dailySessions.userId, userId), eq(dailySessions.localDate, LOCAL_DATE)));
    return row?.solvedCount ?? null;
  };

  const credit = () =>
    ctx.db.transaction((tx) =>
      creditSolvedDay(tx, { userId, localDate: LOCAL_DATE, timeZone: TZ, now: NOW }),
    );

  it('counts one problem once, however many times it is credited', async () => {
    const problemId = await makeProblem('one-problem');
    await solvedSession(problemId);

    await credit();
    expect(await solvedCount()).toBe(1);
    await credit();
    await credit();
    expect(await solvedCount()).toBe(1);
  });

  it('BOTH paths on one problem still count once — the double-credit bug', async () => {
    /*
     * Exactly the reported workflow, modelled as it actually happens: the
     * accepted Submit credits the day, and then ending the session as solved
     * credits it AGAIN. Two calls, not one — crediting once would pass even
     * against the old incrementing code, which is what makes the second
     * `credit()` here the assertion that matters.
     */
    const problemId = await makeProblem('submit-then-solved');
    const sessionId = await solvedSession(problemId);
    await acceptedSubmit(problemId, sessionId);

    await credit(); // submit path
    await credit(); // session path
    expect(await solvedCount()).toBe(1);
  });

  it('repairs a row that an incrementing writer already inflated', async () => {
    // Derived, not accumulated, so existing drift heals on the next touch
    // rather than needing a migration.
    const problemId = await makeProblem('already-wrong');
    await solvedSession(problemId);
    await ctx.db.insert(dailySessions).values({
      userId,
      localDate: LOCAL_DATE,
      targetCount: 2,
      solvedCount: 7,
      revisionCount: 0,
      completed: true,
    });

    await credit();
    expect(await solvedCount()).toBe(1);
  });
});

suite('F1.3 · creditSolvedDay still counts what it should', () => {
  let ctx: TestContext;
  let userId = '';

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    const user = await createUser(ctx.db, { timezone: TZ });
    userId = user.id;
  });

  /*
   * The positive control.
   *
   * Every assertion above is "the number did not go up". An implementation that
   * always wrote 1 — or 0 — would satisfy all of them. These require the count
   * to actually track distinct problems, which is what makes the idempotence
   * tests meaningful rather than vacuous.
   */
  it('two different problems count two, and a third counts three', async () => {
    const insertSolved = async (slug: string) => {
      const [p] = await ctx.db
        .insert(problems)
        .values({
          slug,
          title: `Problem ${slug}`,
          sourceType: 'original',
          difficulty: 'easy',
          statement: 'Original text.',
        })
        .returning({ id: problems.id });
      await ctx.db.insert(solveSessions).values({
        userId,
        problemId: p!.id,
        status: 'solved',
        startedAt: new Date(NOW.getTime() - 600_000),
        endedAt: NOW,
        // `solve_sessions_heartbeat_after_start`: the column defaults to real
        // now(), which is before these fixed fixture timestamps.
        lastHeartbeatAt: NOW,
        startedLocalDate: LOCAL_DATE,
        endedLocalDate: LOCAL_DATE,
      });
    };
    const credit = () =>
      ctx.db.transaction((tx) =>
        creditSolvedDay(tx, { userId, localDate: LOCAL_DATE, timeZone: TZ, now: NOW }),
      );
    const read = async () => {
      const [row] = await ctx.db
        .select({ solvedCount: dailySessions.solvedCount, completed: dailySessions.completed })
        .from(dailySessions)
        .where(and(eq(dailySessions.userId, userId), eq(dailySessions.localDate, LOCAL_DATE)));
      return row!;
    };

    await insertSolved('problem-a');
    await credit();
    expect((await read()).solvedCount).toBe(1);
    expect((await read()).completed).toBe(false);

    await insertSolved('problem-b');
    await credit();
    const two = await read();
    expect(two.solvedCount).toBe(2);
    // Default target is 2, so the second solve completes the day.
    expect(two.completed).toBe(true);

    await insertSolved('problem-c');
    await credit();
    expect((await read()).solvedCount).toBe(3);
  });

  it('does not count a session that ended on a different local date', async () => {
    const [p] = await ctx.db
      .insert(problems)
      .values({
        slug: 'yesterday',
        title: 'Yesterday',
        sourceType: 'original',
        difficulty: 'easy',
        statement: 'Original text.',
      })
      .returning({ id: problems.id });
    await ctx.db.insert(solveSessions).values({
      userId,
      problemId: p!.id,
      status: 'solved',
      startedAt: new Date('2026-09-22T09:00:00.000Z'),
      endedAt: new Date('2026-09-22T09:30:00.000Z'),
      lastHeartbeatAt: new Date('2026-09-22T09:30:00.000Z'),
      startedLocalDate: '2026-09-22',
      endedLocalDate: '2026-09-22',
    });

    await ctx.db.transaction((tx) =>
      creditSolvedDay(tx, { userId, localDate: LOCAL_DATE, timeZone: TZ, now: NOW }),
    );
    const [row] = await ctx.db
      .select({ solvedCount: dailySessions.solvedCount })
      .from(dailySessions)
      .where(and(eq(dailySessions.userId, userId), eq(dailySessions.localDate, LOCAL_DATE)));
    expect(row?.solvedCount).toBe(0);
  });
});
