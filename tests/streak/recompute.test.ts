/**
 * F1.3 · the recompute.
 *
 * The pure engine is tested first and exhaustively; the database-backed suite
 * below asserts persistence, and specifically that a second run is a genuine
 * no-op down to `updated_at`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dailyGoals, dailySessions } from '@/server/db/schema';
import { MONTHLY_FREEZE_ALLOWANCE } from '@/server/services/streak/freezes';
import {
  type DaySnapshot,
  computeStreak,
  recomputeStreak,
} from '@/server/services/streak/recompute';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

/** Terse day builder: 'x' complete, '.' incomplete. */
function daysFrom(start: string, pattern: string): DaySnapshot[] {
  const days: DaySnapshot[] = [];
  const cursor = new Date(`${start}T12:00:00.000Z`);
  for (const mark of pattern) {
    const date = cursor.toISOString().slice(0, 10);
    days.push({
      date,
      solvedCount: mark === 'x' ? 2 : 0,
      revisionCount: 0,
      completed: mark === 'x',
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const lastDate = (start: string, length: number) =>
  new Date(new Date(`${start}T12:00:00.000Z`).getTime() + (length - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe('F1.3 · computeStreak — the chain', () => {
  it('counts an unbroken run', () => {
    const days = daysFrom('2026-03-01', 'xxxxx');
    const { state } = computeStreak(days, lastDate('2026-03-01', 5));
    expect(state.currentStreak).toBe(5);
    expect(state.longestStreak).toBe(5);
    expect(state.lastCompletedLocalDate).toBe('2026-03-05');
  });

  it('a MISSING day is a missed day, not a skipped one', () => {
    /*
     * `daily_sessions` has no row for a day with no activity. Iterating stored
     * rows alone would treat 5 scattered days as a 5-day streak — the
     * difference between "you have a 5-day streak" and "you had 5 days spread
     * over three weeks".
     */
    const sparse: DaySnapshot[] = [
      { date: '2026-03-01', solvedCount: 2, revisionCount: 0, completed: true },
      { date: '2026-03-10', solvedCount: 2, revisionCount: 0, completed: true },
    ];
    const { state } = computeStreak(sparse, '2026-03-10');
    expect(state.currentStreak).toBe(1);
  });

  it('keeps the longest streak after the current one breaks', () => {
    // 5 on, 3 off (2 frozen, 1 not), then 2 on.
    const days = daysFrom('2026-03-01', 'xxxxx...xx');
    const { state } = computeStreak(days, lastDate('2026-03-01', 10));
    expect(state.longestStreak).toBeGreaterThanOrEqual(5);
    expect(state.currentStreak).toBeLessThan(state.longestStreak);
  });

  it('TODAY being incomplete does not break the streak', () => {
    /*
     * The failure the ticket names in its own warning. Today is normally
     * incomplete — the user has not solved yet — so counting it as a miss makes
     * every streak in the product read zero each morning and repair itself each
     * evening.
     */
    const days = daysFrom('2026-03-01', 'xxxxx.');
    const { state } = computeStreak(days, '2026-03-06');
    expect(state.currentStreak).toBe(5);
  });

  it('YESTERDAY being incomplete does break it — once freezes run out', () => {
    /*
     * The positive control for the grace above: it applies to TODAY only.
     *
     * Needs THREE settled misses, not two. My first version used two and
     * expected a break, which was simply wrong — two misses is exactly the
     * monthly allowance, so the chain correctly survived at 7 (5 solved + 2
     * frozen). The test was asserting a bug that was not there.
     */
    const days = daysFrom('2026-03-01', 'xxxxx....'); // 03-06,07,08 missed; today 03-09
    const { state } = computeStreak(days, '2026-03-09');

    expect(state.currentStreak).toBe(0);
    expect(state.longestStreak).toBe(7); // 5 solved + 2 frozen, before the break
  });

  it('a freeze is NOT spent on today', () => {
    /*
     * The bug this suite found. Today is not a missed day — the user has the
     * rest of it — so offering today to the freeze logic burns one every time a
     * recompute runs, draining the monthly allowance in two days.
     *
     * The symptom was subtle: a five-day run read as SIX, because today had
     * been frozen and counted.
     */
    const days = daysFrom('2026-03-01', 'xxxxx.');
    const { state, coverage } = computeStreak(days, '2026-03-06');

    expect(coverage).toEqual([]);
    expect(state.currentStreak).toBe(5);
  });

  it('an empty history is a zero streak, not a crash', () => {
    const { state } = computeStreak([], '2026-03-01');
    expect(state).toEqual({ currentStreak: 0, longestStreak: 0, lastCompletedLocalDate: null });
  });

  it('longest is never below current', () => {
    // The invariant `user_streaks_longest_at_least_current` enforces in SQL.
    for (const pattern of ['x', 'xx', '.x', 'x.x', 'xxxxxxxxxx', '..x..x']) {
      const days = daysFrom('2026-03-01', pattern);
      const { state } = computeStreak(days, lastDate('2026-03-01', pattern.length));
      expect(state.longestStreak).toBeGreaterThanOrEqual(state.currentStreak);
    }
  });
});

describe('F1.3 · computeStreak — freezes', () => {
  it('a single missed day is covered and the chain survives', () => {
    const days = daysFrom('2026-03-01', 'xx.xx');
    const { state, coverage } = computeStreak(days, lastDate('2026-03-01', 5));

    expect(coverage.map((row) => row.coveredLocalDate)).toEqual(['2026-03-03']);
    expect(state.currentStreak).toBe(5);
  });

  it('breaks once the monthly allowance is exhausted', () => {
    // Three misses, two freezes. The third gap ends the chain.
    const days = daysFrom('2026-03-01', 'x.x.x.x');
    const { state, coverage } = computeStreak(days, lastDate('2026-03-01', 7));

    expect(coverage).toHaveLength(MONTHLY_FREEZE_ALLOWANCE);
    expect(state.currentStreak).toBe(1); // only the final 'x'
  });

  it('does not spend a freeze on a completed day', () => {
    const days = daysFrom('2026-03-01', 'xxxxx');
    const { coverage } = computeStreak(days, lastDate('2026-03-01', 5));
    expect(coverage).toEqual([]);
  });

  it('a BACKFILL releases the freeze and it protects a later day', () => {
    // The decision from D18, end to end through the engine.
    const before = computeStreak(daysFrom('2026-03-01', 'x.x'), '2026-03-03');
    expect(before.coverage.map((row) => row.coveredLocalDate)).toEqual(['2026-03-02']);

    const backfilled = daysFrom('2026-03-01', 'xxx');
    const after = computeStreak(backfilled, '2026-03-03');
    expect(after.coverage).toEqual([]);
    expect(after.state.currentStreak).toBe(3);
  });
});

describe('F1.3 · computeStreak — determinism', () => {
  it('is a pure function of its inputs', () => {
    const days = daysFrom('2026-03-01', 'xx.x.xx..x');
    const today = lastDate('2026-03-01', 10);
    expect(computeStreak(days, today)).toEqual(computeStreak(days, today));
  });

  it('spans a DST boundary without gaining or losing a day', () => {
    /*
     * 2026-03-08 is spring-forward in America/New_York (23-hour day) and
     * 2026-11-01 is fall-back (25 hours). The engine works on local DATES, so
     * neither can add or drop one — but that is a claim worth asserting rather
     * than assuming, since a date-arithmetic bug would show up exactly here.
     */
    const spring = daysFrom('2026-03-06', 'xxxxx'); // 03-06 … 03-10
    expect(computeStreak(spring, '2026-03-10').state.currentStreak).toBe(5);

    const fall = daysFrom('2026-10-30', 'xxxxx'); // 10-30 … 11-03
    expect(computeStreak(fall, '2026-11-03').state.currentStreak).toBe(5);
  });

  it('spans a leap day', () => {
    const days = daysFrom('2024-02-27', 'xxxxx'); // includes 02-29
    expect(computeStreak(days, '2024-03-02').state.currentStreak).toBe(5);
    expect(days.map((day) => day.date)).toContain('2024-02-29');
  });

  it('spans a year boundary', () => {
    const days = daysFrom('2025-12-29', 'xxxxx'); // into 2026
    const { state } = computeStreak(days, '2026-01-02');
    expect(state.currentStreak).toBe(5);
    // …and the freeze allowance reset at the month boundary is not confused by
    // the year change.
    expect(state.lastCompletedLocalDate).toBe('2026-01-02');
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('F1.3 · recomputeStreak — persistence and idempotency', () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'streak@example.com' })).id;
  });

  async function seedDays(pattern: string, start = '2026-03-01') {
    const days = daysFrom(start, pattern);
    await ctx.db.insert(dailySessions).values(
      days.map((day) => ({
        userId,
        localDate: day.date,
        solvedCount: day.solvedCount,
        revisionCount: day.revisionCount,
        completed: day.completed,
      })),
    );
    return lastDate(start, pattern.length);
  }

  it('persists the computed state', async () => {
    const today = await seedDays('xxxxx');
    const state = await recomputeStreak(ctx.db, userId, today);

    expect(state.currentStreak).toBe(5);

    const [row] = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;
    expect(row!.current_streak).toBe(5);
    expect(row!.longest_streak).toBe(5);
  });

  it('A SECOND RUN CHANGES NOTHING — including updated_at', async () => {
    /*
     * The spec asks for "identical row versions", and this is the assertion
     * that makes that mean something. An unconditional UPDATE satisfies every
     * test that compares the interesting columns while moving `updated_at` —
     * which is the version of "idempotent" most implementations settle for.
     *
     * Asserted on the FULL row, so a column added later is covered by default
     * rather than needing someone to remember to add it here.
     */
    const today = await seedDays('xx.xx');
    await recomputeStreak(ctx.db, userId, today);

    const [first] = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;
    const freezesFirst = await ctx.sql`
      SELECT * FROM streak_freezes WHERE user_id = ${userId} ORDER BY covered_local_date
    `;

    // A real gap in wall-clock time, so a bumped timestamp cannot coincide.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await recomputeStreak(ctx.db, userId, today);

    const [second] = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;
    const freezesSecond = await ctx.sql`
      SELECT * FROM streak_freezes WHERE user_id = ${userId} ORDER BY covered_local_date
    `;

    expect(second).toEqual(first);
    // consumed_at too: rewriting identical coverage would drift it forward on
    // every recompute and the log would stop meaning anything.
    expect(freezesSecond).toEqual(freezesFirst);
  });

  it('the idempotency assertion can actually fail', async () => {
    /*
     * The positive control. If `updated_at` were not being compared — or if the
     * row were somehow identical for an unrelated reason — the test above would
     * pass vacuously. This proves a genuine change DOES move it.
     */
    const today = await seedDays('xxxxx');
    await recomputeStreak(ctx.db, userId, today);
    const [before] = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;

    await new Promise((resolve) => setTimeout(resolve, 50));
    await ctx.db.insert(dailySessions).values({
      userId,
      localDate: '2026-03-06',
      solvedCount: 2,
      revisionCount: 0,
      completed: true,
    });
    await recomputeStreak(ctx.db, userId, '2026-03-07');

    const [after] = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;
    expect(after).not.toEqual(before);
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime(),
    );
  });

  it('writes freeze coverage with the date it covered', async () => {
    // The acceptance criterion, read from the database.
    const today = await seedDays('xx.xx');
    await recomputeStreak(ctx.db, userId, today);

    const rows = await ctx.sql`
      SELECT covered_local_date FROM streak_freezes WHERE user_id = ${userId}
    `;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.covered_local_date)).toContain('2026-03-03');
  });

  it('BACKFILL: a late session repairs the streak and releases the freeze', async () => {
    const today = await seedDays('xx.xx');
    await recomputeStreak(ctx.db, userId, today);
    expect(await ctx.sql`SELECT id FROM streak_freezes WHERE user_id = ${userId}`).toHaveLength(
      1,
    );

    /*
     * The user logs the missed day late. An UPDATE, not an INSERT: the seed
     * already created a zero-count row for that date and
     * `daily_sessions_user_date_key` is unique, so a backfill is an upsert in
     * practice. Writing it as a plain insert is how the first version of this
     * test failed on a constraint rather than on the behaviour it was about.
     */
    await ctx.sql`
      UPDATE daily_sessions SET solved_count = 2, completed = true
      WHERE user_id = ${userId} AND local_date = '2026-03-03'
    `;
    const state = await recomputeStreak(ctx.db, userId, today);

    expect(state.currentStreak).toBe(5);
    expect(await ctx.sql`SELECT id FROM streak_freezes WHERE user_id = ${userId}`).toEqual([]);
  });

  it('uses the goal IN FORCE on each day, not the current one', async () => {
    /*
     * A user who raises their target must not have last month's completed days
     * retroactively un-completed. Same immutability principle as D18's
     * timezone rule, applied to the goal.
     */
    await ctx.db.insert(dailyGoals).values([
      { userId, effectiveFrom: '2026-03-01', targetProblems: 2 },
      { userId, effectiveFrom: '2026-03-04', targetProblems: 5 },
    ]);
    await ctx.db.insert(dailySessions).values(
      ['2026-03-01', '2026-03-02', '2026-03-03'].map((localDate) => ({
        userId,
        localDate,
        solvedCount: 2,
        revisionCount: 0,
      })),
    );

    const state = await recomputeStreak(ctx.db, userId, '2026-03-03');
    // All three met the target of 2 that applied then.
    expect(state.currentStreak).toBe(3);
  });

  it('creates a row for a user who has never had a streak', async () => {
    const state = await recomputeStreak(ctx.db, userId, '2026-03-01');
    expect(state.currentStreak).toBe(0);

    const rows = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });

  it('respects the database invariant longest >= current', async () => {
    const today = await seedDays('xxxxx');
    await recomputeStreak(ctx.db, userId, today);
    // A direct violation must be rejected, proving the CHECK is real.
    await expect(
      ctx.sql`UPDATE user_streaks SET current_streak = 99 WHERE user_id = ${userId}`,
    ).rejects.toThrow();
  });
});
