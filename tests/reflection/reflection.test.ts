/**
 * F1.5 · the post-solve reflection.
 *
 * Two criteria live here. One is about what skipping means — "skipping the
 * reflection completes the session cleanly" — and the other is the storage rule
 * seen from the service side: what `saveReflection` writes has to be the thing
 * a `WHERE` clause can find.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { problems, reflections, userProblems } from '@/server/db/schema';
import {
  SessionNotFoundError,
  abandonSession,
  completeSession,
  startSession,
} from '@/server/services/session';
import {
  SessionNotReflectableError,
  getReflection,
  saveReflection,
} from '@/server/services/reflection';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const START = new Date('2026-03-02T10:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const TIME_ZONE = 'Asia/Kolkata';

suite('F1.5 · saveReflection', () => {
  let ctx: TestContext;
  let userId: string;
  let problemId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'reflect@example.com', timezone: TIME_ZONE }))
      .id;

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
    problemId = problem!.id;
  });

  const actor = (now: Date) => ({ userId, timeZone: TIME_ZONE, now });

  /** A finished session, which is the only kind that can be reflected on. */
  async function solvedSession(outcome: 'solved' | 'stuck' = 'solved') {
    const session = await startSession(ctx.db, { ...actor(START), problemId });
    await completeSession(ctx.db, { ...actor(at(25)), sessionId: session.id, outcome });
    return session.id;
  }

  it('writes the multi-selects as rows a WHERE clause can find', async () => {
    const sessionId = await solvedSession();

    await saveReflection(ctx.db, {
      userId,
      sessionId,
      approach: 'Sorted the array, then two pointers.',
      achievedComplexity: 'O(n log n)',
      stuckAreas: ['approach', 'edge_cases'],
      mistakes: ['off_by_one', 'missed_edge_case'],
      confidence: 'medium',
      now: at(26),
    });

    // The criterion's own query, run against what the service wrote.
    const rows = await ctx.sql`
      SELECT m.category
      FROM reflection_mistakes m
      JOIN reflections r ON r.id = m.reflection_id
      WHERE r.session_id = ${sessionId} AND m.category = 'off_by_one'
    `;
    expect(rows).toHaveLength(1);

    const view = await getReflection(ctx.db, { userId, sessionId });
    expect(view?.mistakes.sort()).toEqual(['missed_edge_case', 'off_by_one']);
    expect(view?.stuckAreas.sort()).toEqual(['approach', 'edge_cases']);
    expect(view?.approach).toContain('two pointers');
    expect(view?.achievedComplexity).toBe('O(n log n)');
  });

  it('A RE-SUBMIT REPLACES THE ANSWER, SO UNTICKING REMOVES', async () => {
    /*
     * The failure a pure insert would produce: a box the user unticked stays
     * ticked forever, and F3.5 counts a mistake they told us they had not made.
     */
    const sessionId = await solvedSession();

    await saveReflection(ctx.db, {
      userId,
      sessionId,
      mistakes: ['off_by_one', 'tle'],
      stuckAreas: ['debugging'],
      now: at(26),
    });

    await saveReflection(ctx.db, {
      userId,
      sessionId,
      mistakes: ['off_by_one'],
      stuckAreas: [],
      now: at(30),
    });

    const view = await getReflection(ctx.db, { userId, sessionId });
    expect(view?.mistakes).toEqual(['off_by_one']);
    expect(view?.stuckAreas).toEqual([]);

    // Still one reflection, not two accounts of the same solve.
    expect(await ctx.db.select().from(reflections)).toHaveLength(1);
  });

  it('SKIPPING LEAVES THE SESSION COMPLETE AND NO ROW BEHIND', async () => {
    /*
     * The acceptance criterion. Skipping is not an action the service takes —
     * it is the absence of one, which is why "clean" has to be asserted about
     * the session rather than about a skip record.
     */
    const sessionId = await solvedSession();

    expect(await getReflection(ctx.db, { userId, sessionId })).toBeNull();
    expect(await ctx.db.select().from(reflections)).toHaveLength(0);

    const [session] = await ctx.sql`
      SELECT status, ended_at FROM solve_sessions WHERE id = ${sessionId}
    `;
    expect(session!.status).toBe('solved');
    expect(session!.ended_at).not.toBeNull();

    // And the solve still counted: the streak does not wait for a reflection.
    const [day] = await ctx.sql`SELECT solved_count FROM daily_sessions`;
    expect(day!.solved_count).toBe(1);
  });

  it('AN EMPTY MISTAKE LIST IS NOT THE SAME AS "none"', async () => {
    /*
     * A question left alone and an answer of "nothing went wrong" are different
     * facts. F3.5 counts recurrence, so conflating them would turn every
     * skipped question into evidence of a clean solve.
     */
    const skipped = await solvedSession();
    await saveReflection(ctx.db, { userId, sessionId: skipped, mistakes: [], now: at(26) });

    const clean = await startSession(ctx.db, { ...actor(at(40)), problemId });
    await completeSession(ctx.db, {
      ...actor(at(60)),
      sessionId: clean.id,
      outcome: 'solved',
    });
    await saveReflection(ctx.db, {
      userId,
      sessionId: clean.id,
      mistakes: ['none'],
      now: at(61),
    });

    const rows = await ctx.sql`SELECT category FROM reflection_mistakes`;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.category)).toBe('none');
  });

  it('records confidence in ONE place, and mirrors it for the catalog', async () => {
    const sessionId = await solvedSession();

    await saveReflection(ctx.db, {
      userId,
      sessionId,
      confidence: 'high',
      now: at(26),
    });

    const [session] = await ctx.sql`
      SELECT confidence FROM solve_sessions WHERE id = ${sessionId}
    `;
    expect(session!.confidence).toBe('high');

    // The catalog reads user_problems, so answering late must not leave the two
    // saying different things about the same solve.
    const [attempt] = await ctx.db
      .select()
      .from(userProblems)
      .where(and(eq(userProblems.userId, userId), eq(userProblems.problemId, problemId)));
    expect(attempt?.confidence).toBe('high');
  });

  it('refuses a reflection on a session that is still running', async () => {
    const session = await startSession(ctx.db, { ...actor(START), problemId });

    await expect(
      saveReflection(ctx.db, { userId, sessionId: session.id, now: at(5) }),
    ).rejects.toBeInstanceOf(SessionNotReflectableError);
  });

  it('REFUSES A REFLECTION ON AN ABANDONED SESSION', async () => {
    /*
     * Abandonment is not an attempt (D20) and the sweep does it on the user's
     * behalf — a reflection attached to one would be a considered account of a
     * solve that never concluded.
     */
    const session = await startSession(ctx.db, { ...actor(START), problemId });
    await abandonSession(ctx.db, { ...actor(at(10)), sessionId: session.id });

    await expect(
      saveReflection(ctx.db, { userId, sessionId: session.id, now: at(11) }),
    ).rejects.toBeInstanceOf(SessionNotReflectableError);
  });

  it('allows a reflection on a STUCK outcome, which is where it matters most', async () => {
    const sessionId = await solvedSession('stuck');

    const view = await saveReflection(ctx.db, {
      userId,
      sessionId,
      stuckAreas: ['complexity'],
      mistakes: ['tle'],
      now: at(26),
    });

    expect(view.mistakes).toEqual(['tle']);
  });

  it("refuses to reflect on another user's session", async () => {
    const sessionId = await solvedSession();
    const intruder = await createUser(ctx.db, { email: 'intruder-reflect@example.com' });

    await expect(
      saveReflection(ctx.db, { userId: intruder.id, sessionId, now: at(26) }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('drops a duplicate category rather than failing on the unique index', async () => {
    // A form can post the same value twice; that is one answer, not an error.
    const sessionId = await solvedSession();

    const view = await saveReflection(ctx.db, {
      userId,
      sessionId,
      mistakes: ['tle', 'tle'],
      now: at(26),
    });

    expect(view.mistakes).toEqual(['tle']);
  });
});
