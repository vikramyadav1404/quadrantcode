/**
 * F2.2 · revision modes against a real database.
 *
 * The target rule and the comparison are proved pure in `modes-pure.test.ts`.
 * What only a database shows: that each mode lands on the session row, that a
 * speed hit/miss is decided from the event-derived duration at completion,
 * that the CHECK refuses a speed field on a non-speed row, and that each mode's
 * view loads only what that mode may show.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  problemTags,
  problems,
  reflectionMistakes,
  reflections,
  solveSessions,
  userProblems,
} from '@/server/db/schema';
import { REVISION_MODES } from '@/lib/revision/modes';
import { markStuck } from '@/server/services/reflection';
import {
  NotScheduledForRevisionError,
  modeComparison,
  revisionContext,
  sittingView,
  startRevisionSitting,
} from '@/server/services/revision/modes';
import {
  ActiveSessionExistsError,
  abandonSession,
  completeSession,
  startSession,
} from '@/server/services/session';
import {
  type TestContext,
  createUser,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const START = new Date('2026-03-02T10:00:00.000Z');
const TIME_ZONE = 'Asia/Kolkata';
const minutes = (base: Date, count: number) => new Date(base.getTime() + count * 60_000);

suite('F2.2 · revision modes', () => {
  let ctx: TestContext;
  let userId: string;
  let counter = 0;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'modes@example.com', timezone: TIME_ZONE })).id;
    counter = 0;
  });

  async function makeProblem(
    options: { pattern?: string; estimatedMinutes?: number; isPremium?: boolean } = {},
  ) {
    counter += 1;
    const slug = `modes-${counter}`;
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug,
        title: `Modes ${counter}`,
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: `https://leetcode.com/problems/${slug}/`,
        difficulty: 'medium',
        estimatedMinutes: options.estimatedMinutes ?? 30,
        isPremium: options.isPremium ?? false,
        // The column defaults to 'draft', and the pattern set rightly lists
        // only what the catalog would open.
        status: 'published',
      })
      .returning();
    if (options.pattern) {
      await ctx.db
        .insert(problemTags)
        .values({ problemId: problem!.id, tagType: 'pattern', tagValue: options.pattern });
    }
    return problem!.id;
  }

  /** Solve through the real lifecycle — which is what schedules the revision. */
  async function solve(problemId: string, at: Date, forMinutes = 20) {
    const session = await startSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: at,
      problemId,
    });
    await completeSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: minutes(at, forMinutes),
      sessionId: session.id,
      outcome: 'solved',
    });
    return session.id;
  }

  async function sitting(problemId: string, mode: (typeof REVISION_MODES)[number], at: Date) {
    return startRevisionSitting(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: at,
      problemId,
      mode,
    });
  }

  it('FOUR MODES CREATE FOUR DISTINGUISHABLE SESSIONS WITH THE MODE RECORDED', async () => {
    const problemId = await makeProblem();
    await solve(problemId, START);

    let at = minutes(START, 60);
    for (const mode of REVISION_MODES) {
      const session = await sitting(problemId, mode, at);
      expect(session.revisionMode).toBe(mode);
      await abandonSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: minutes(at, 1),
        sessionId: session.id,
      });
      at = minutes(at, 10);
    }

    const rows = await ctx.db
      .select({ mode: solveSessions.revisionMode })
      .from(solveSessions)
      .where(eq(solveSessions.problemId, problemId));
    expect(rows.map((row) => row.mode).sort()).toEqual(
      [null, ...REVISION_MODES].sort((a, b) => String(a).localeCompare(String(b))),
    );
  });

  it('refuses a mode on a problem that was never solved and scheduled', async () => {
    const problemId = await makeProblem();
    await expect(sitting(problemId, 'blind', START)).rejects.toBeInstanceOf(
      NotScheduledForRevisionError,
    );
  });

  it('keeps the one-live-session rule: a revision is not a way round it', async () => {
    const problemId = await makeProblem();
    await solve(problemId, START);
    await sitting(problemId, 'blind', minutes(START, 60));
    await expect(sitting(problemId, 'speed', minutes(START, 61))).rejects.toBeInstanceOf(
      ActiveSessionExistsError,
    );
  });

  describe('speed mode', () => {
    it('SETS THE TARGET TO min(PREVIOUS BEST, ESTIMATE) AND RECORDS A HIT', async () => {
      const problemId = await makeProblem({ estimatedMinutes: 30 });
      await solve(problemId, START, 12); // best: 12 minutes, under the 30-minute estimate

      const [record] = await ctx.db
        .select({ best: userProblems.bestTimeSeconds })
        .from(userProblems)
        .where(eq(userProblems.problemId, problemId));
      expect(record?.best).toBe(720);

      const at = minutes(START, 60);
      const session = await sitting(problemId, 'speed', at);
      expect(session.speedTargetSeconds).toBe(720);

      await completeSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: minutes(at, 10),
        sessionId: session.id,
        outcome: 'solved',
      });
      const [row] = await ctx.db
        .select({ met: solveSessions.speedTargetMet })
        .from(solveSessions)
        .where(eq(solveSessions.id, session.id));
      expect(row?.met).toBe(true);
    });

    it('records a miss when solved over the target, and when it ends stuck', async () => {
      const problemId = await makeProblem({ estimatedMinutes: 30 });
      await solve(problemId, START, 12);

      const slow = await sitting(problemId, 'speed', minutes(START, 60));
      await completeSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: minutes(START, 75),
        sessionId: slow.id,
        outcome: 'solved',
      });

      const stuck = await sitting(problemId, 'speed', minutes(START, 120));
      await completeSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: minutes(START, 121),
        sessionId: stuck.id,
        outcome: 'stuck',
      });

      const rows = await ctx.db
        .select({ id: solveSessions.id, met: solveSessions.speedTargetMet })
        .from(solveSessions)
        .where(eq(solveSessions.revisionMode, 'speed'));
      expect(rows.find((row) => row.id === slow.id)?.met).toBe(false);
      expect(rows.find((row) => row.id === stuck.id)?.met).toBe(false);
    });

    it('THE DATABASE REFUSES A SPEED TARGET ON A NON-SPEED SITTING', async () => {
      // Positive control for `solve_sessions_speed_fields_consistent`: the
      // service never writes this, so only a direct write can prove the CHECK.
      const problemId = await makeProblem();
      await solve(problemId, START);
      const blind = await sitting(problemId, 'blind', minutes(START, 60));

      const rejection = await expectDbRejection(
        ctx.db.execute(
          sql`update solve_sessions set speed_target_seconds = 60 where id = ${blind.id}`,
        ),
        'solve_sessions_speed_fields_consistent',
      );
      expect(rejection.code).toBe('23514'); // check_violation, not some other failure
    });
  });

  describe('what each mode loads', () => {
    async function historyWithNotes(problemId: string) {
      // A finished attempt carrying a stuck note and a recorded mistake.
      const session = await startSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: START,
        problemId,
      });
      await markStuck(ctx.db, {
        userId,
        now: minutes(START, 5),
        sessionId: session.id,
        category: 'edge_cases',
        note: 'SECRET-NOTE-used left < right',
      });
      await completeSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: minutes(START, 20),
        sessionId: session.id,
        outcome: 'solved',
      });
      const [reflection] = await ctx.db
        .insert(reflections)
        .values({ sessionId: session.id, approach: 'SECRET-APPROACH two pointers' })
        .returning();
      await ctx.db.insert(reflectionMistakes).values([
        { reflectionId: reflection!.id, category: 'off_by_one' },
        { reflectionId: reflection!.id, category: 'none' },
      ]);
    }

    it('BLIND RETRY LOADS NOTHING BUT ITS NAME', async () => {
      const problemId = await makeProblem();
      await historyWithNotes(problemId);
      const session = await sitting(problemId, 'blind', minutes(START, 60));

      const view = await sittingView(ctx.db, { userId, now: minutes(START, 61), session });
      expect(view).toEqual({ mode: 'blind' });
      expect(JSON.stringify(view)).not.toContain('SECRET');
    });

    it('mistake-first briefs the recorded mistakes and last stuck points, as labels', async () => {
      const problemId = await makeProblem();
      await historyWithNotes(problemId);
      const session = await sitting(problemId, 'mistake_first', minutes(START, 60));

      const view = await sittingView(ctx.db, { userId, now: minutes(START, 61), session });
      expect(view?.mode).toBe('mistake_first');
      if (view?.mode !== 'mistake_first') return;
      // "Nothing went wrong" is not a mistake to brief on.
      expect(view.mistakes).toEqual(['Off by one']);
      expect(view.stuckPoints).toEqual([
        { category: 'Edge cases', note: 'SECRET-NOTE-used left < right', atSeconds: 300 },
      ]);
      expect(view.lastAttemptedAt).not.toBeNull();
    });

    it('pattern offers other visible problems sharing the pattern, never itself or premium ones', async () => {
      const problemId = await makeProblem({ pattern: 'two-pointers' });
      await makeProblem({ pattern: 'two-pointers' });
      await makeProblem({ pattern: 'two-pointers' });
      await makeProblem({ pattern: 'two-pointers', isPremium: true });
      await makeProblem({ pattern: 'sliding-window' });
      await solve(problemId, START);
      const session = await sitting(problemId, 'pattern', minutes(START, 60));

      const view = await sittingView(ctx.db, { userId, now: minutes(START, 61), session });
      expect(view).toEqual({
        mode: 'pattern',
        pattern: 'two-pointers',
        related: [
          { slug: 'modes-2', title: 'Modes 2' },
          { slug: 'modes-3', title: 'Modes 3' },
        ],
      });
    });

    it('an ordinary solve has no sitting view at all', async () => {
      const problemId = await makeProblem();
      const session = await startSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: START,
        problemId,
      });
      expect(await sittingView(ctx.db, { userId, now: START, session })).toBeNull();
    });
  });

  describe('the revision page facts and the comparison', () => {
    it('reports last attempt, last outcome and mistakes per due problem', async () => {
      const problemId = await makeProblem();
      await solve(problemId, START);

      const context = await revisionContext(ctx.db, { userId, problemIds: [problemId] });
      expect(context.get(problemId)).toEqual({
        lastAttemptedAt: minutes(START, 20),
        lastOutcome: 'solved',
        mistakes: [],
      });
    });

    it('SAYS "NOT ENOUGH DATA" UNDER TEN MEASURED REVISIONS', async () => {
      const problemId = await makeProblem();
      await solve(problemId, START);
      const blind = await sitting(problemId, 'blind', minutes(START, 60));
      await completeSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: minutes(START, 70),
        sessionId: blind.id,
        outcome: 'solved',
      });
      await solve(problemId, minutes(START, 200)); // the attempt that measures it

      expect(await modeComparison(ctx.db, { userId })).toEqual({
        enough: false,
        measured: 1,
        minimum: 10,
      });
    });
  });
});
