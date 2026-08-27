/**
 * F1.3 · a user changing their timezone mid-streak.
 *
 * The ticket asks for this case by name and adds a condition that is the whole
 * point: **define and test the chosen behaviour, do not leave it accidental.**
 * D18 defines it — a recorded day never moves, only future activity uses the
 * new zone — and until this file existed, that definition was asserted nowhere.
 * The settings copy was written from it, the recompute was built around it, and
 * a regression in either would have gone through green.
 *
 * The two directions fail differently, which is why both are here. Moving WEST
 * can land the user on a date they have already had; moving EAST can skip one
 * they never experienced. Neither is a bug, both look like one, and the second
 * quietly costs a freeze.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dailySessions } from '@/server/db/schema';
import { localDateFor } from '@/server/services/streak/day';
import { computeStreak } from '@/server/services/streak/recompute';
import { summariseForShell } from '@/server/services/streak/summary';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

/** Five complete days, 2026-03-01 through 03-05, as they were recorded. */
const RECORDED = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'].map(
  (date) => ({ date, solvedCount: 2, revisionCount: 0, completed: true }),
);

describe('F1.3 · the same instant, in two zones', () => {
  it('MOVING WEST can put the user back on a date they have already had', () => {
    // 00:05 on the 6th in Kolkata is still the afternoon of the 5th in New York.
    const instant = new Date('2026-03-05T18:35:00.000Z');

    expect(localDateFor(instant, 'Asia/Kolkata')).toBe('2026-03-06');
    expect(localDateFor(instant, 'America/New_York')).toBe('2026-03-05');
  });

  it('MOVING EAST can skip a date the user never experienced', () => {
    // Mid-afternoon on the 6th in New York is already the 7th in Kolkata.
    const instant = new Date('2026-03-06T20:00:00.000Z');

    expect(localDateFor(instant, 'America/New_York')).toBe('2026-03-06');
    expect(localDateFor(instant, 'Asia/Kolkata')).toBe('2026-03-07');
  });
});

describe('F1.3 · the streak across a timezone change', () => {
  it('moving WEST does not break the streak, and does not re-count the day', () => {
    /*
     * Today resolves to 2026-03-05 in the new zone — a date already recorded
     * and already counted. The chain is five, not six: the day is one day
     * however many times the user arrives at it.
     */
    const { state, coverage } = computeStreak(RECORDED, '2026-03-05');

    expect(state.currentStreak).toBe(5);
    expect(state.lastCompletedLocalDate).toBe('2026-03-05');
    expect(coverage).toHaveLength(0);
  });

  it('MOVING EAST SPENDS A FREEZE ON A DAY THE USER NEVER LIVED', () => {
    /*
     * The consequence worth stating out loud. Today is 2026-03-07 in the new
     * zone, so 03-06 is a settled day with no activity — indistinguishable, to
     * the engine, from a day the user skipped. A freeze covers it and the
     * streak survives at six.
     *
     * That is the correct behaviour under D18 (history is immutable, so the
     * engine cannot know the day was never available) and it is still a cost
     * the user did not choose. It is asserted here so that a future change to
     * freeze handling has to confront this case deliberately rather than
     * discover it in production, where the symptom is a freeze balance that
     * dropped for no reason the user can see.
     */
    const { state, coverage } = computeStreak(RECORDED, '2026-03-07');

    expect(state.currentStreak).toBe(6); // 5 solved + 1 frozen
    expect(coverage).toEqual([{ coveredLocalDate: '2026-03-06' }]);
  });

  it('the streak is a function of the recorded dates, not of the current zone', () => {
    // The same rows and the same `today` produce the same answer whatever the
    // user's zone now says — the determinism D18 protects by refusing to
    // re-resolve history.
    const first = computeStreak(RECORDED, '2026-03-06');
    const second = computeStreak([...RECORDED], '2026-03-06');

    expect(second).toEqual(first);
    expect(first.state.currentStreak).toBe(5); // today unfinished, not yet a miss
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('F1.3 · a timezone change never rewrites history', () => {
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
    userId = (await createUser(ctx.db, { email: 'tzchange@example.com' })).id;
    await ctx.db.insert(dailySessions).values(
      RECORDED.map((day) => ({
        userId,
        localDate: day.date,
        solvedCount: day.solvedCount,
        revisionCount: day.revisionCount,
        completed: day.completed,
      })),
    );
  });

  it('RECORDED DAYS DO NOT MOVE when the user changes zone', async () => {
    /*
     * The claim D18 makes and the settings page repeats to the user. If a
     * recompute in the new zone re-resolved stored days, solves would migrate
     * between dates — silently breaking a streak someone earned, or inventing
     * one they did not.
     */
    const before = await ctx.sql`
      SELECT local_date, solved_count FROM daily_sessions
      WHERE user_id = ${userId} ORDER BY local_date
    `;

    await summariseForShell(ctx.db, userId, '2026-03-05'); // "today", in the new zone

    const after = await ctx.sql`
      SELECT local_date, solved_count FROM daily_sessions
      WHERE user_id = ${userId} ORDER BY local_date
    `;

    expect(after).toEqual(before);
  });

  it('the shell answers for today as the NEW zone resolves it', async () => {
    const west = await summariseForShell(ctx.db, userId, '2026-03-05');
    expect(west.streakDays).toBe(5);
    expect(west.streakAtRisk).toBe(false); // 03-05 is complete

    await ctx.sql`DELETE FROM streak_freezes WHERE user_id = ${userId}`;

    const east = await summariseForShell(ctx.db, userId, '2026-03-07');
    expect(east.streakDays).toBe(6); // 03-06 frozen
    expect(east.streakAtRisk).toBe(true); // 03-07 itself is unfinished
  });
});
