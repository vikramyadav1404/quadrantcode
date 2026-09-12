/**
 * F1.3 · what the application shell shows.
 *
 * The badge and the ring sit on every authenticated page, so a wrong number
 * here is the number users see most. Two claims carry the weight:
 *
 *   - the ring reports SOLVES, never a count rounded up to look finished
 *   - the badge only warns when there is a streak to lose
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dailyGoals, dailySessions } from '@/server/db/schema';
import { DEFAULT_TARGET_PROBLEMS } from '@/server/services/streak/goals';
import { summariseForShell } from '@/server/services/streak/summary';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('F1.3 · summariseForShell', () => {
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
    userId = (await createUser(ctx.db, { email: 'shell@example.com' })).id;
  });

  async function seedDay(
    localDate: string,
    solvedCount: number,
    revisionCount = 0,
    completed = false,
  ) {
    await ctx.db
      .insert(dailySessions)
      .values({ userId, localDate, solvedCount, revisionCount, completed });
  }

  it('a brand-new user gets zeros and the default target, not an error', async () => {
    const shell = await summariseForShell(ctx.db, userId, '2026-03-02');

    expect(shell).toEqual({
      streakDays: 0,
      streakAtRisk: false,
      goalCompleted: 0,
      goalTarget: DEFAULT_TARGET_PROBLEMS,
      goalMet: false,
    });
  });

  it('counts today once the target is met', async () => {
    await seedDay('2026-03-02', 2, 0, true);

    const shell = await summariseForShell(ctx.db, userId, '2026-03-02');

    expect(shell.streakDays).toBe(1);
    expect(shell.goalCompleted).toBe(2);
    expect(shell.goalMet).toBe(true);
    expect(shell.streakAtRisk).toBe(false);
  });

  it('THE RING KEEPS THE HONEST COUNT ON A REVISION-PATH DAY', async () => {
    /*
     * One solve alongside two revisions completes the day (rules.ts), against a
     * target of two. So the day counts and the count is still 1.
     *
     * Both facts have to survive to the shell. Reporting 2 of 2 would be a lie
     * about what the user did; reporting 1 of 2 alone would contradict the
     * badge beside it, which has already counted the day. `goalMet` is what
     * lets the ring fill without inflating the number.
     */
    await seedDay('2026-03-02', 1, 2, true);

    const shell = await summariseForShell(ctx.db, userId, '2026-03-02');

    expect(shell.goalCompleted).toBe(1);
    expect(shell.goalTarget).toBe(2);
    expect(shell.goalMet).toBe(true);
    expect(shell.streakDays).toBe(1);
  });

  it('warns that a live streak is at risk while today is unfinished', async () => {
    await seedDay('2026-03-01', 2, 0, true);

    const shell = await summariseForShell(ctx.db, userId, '2026-03-02');

    // Yesterday's streak survives — today is not yet a miss.
    expect(shell.streakDays).toBe(1);
    expect(shell.streakAtRisk).toBe(true);
    expect(shell.goalCompleted).toBe(0);
  });

  it('does NOT warn when there is no streak to lose', async () => {
    /*
     * `atRisk` turns the badge warning-coloured. On a zero streak that is an
     * alarm about nothing, and a colour that cries wolf stops being read.
     */
    const shell = await summariseForShell(ctx.db, userId, '2026-03-02');

    expect(shell.streakDays).toBe(0);
    expect(shell.streakAtRisk).toBe(false);
  });

  it('takes the target from the goal in force', async () => {
    await ctx.db
      .insert(dailyGoals)
      .values({ userId, effectiveFrom: '2026-03-01', targetProblems: 3 });
    await seedDay('2026-03-02', 2);

    const shell = await summariseForShell(ctx.db, userId, '2026-03-02');

    expect(shell.goalTarget).toBe(3);
    expect(shell.goalCompleted).toBe(2);
    expect(shell.goalMet).toBe(false); // 2 of 3, and no revisions
  });

  it('a goal dated after today does not govern today', async () => {
    /*
     * Reachable through the timezone rule, not through the settings form: a
     * user moving west has their local date move backwards, so the row they
     * saved as "today" an hour ago can start tomorrow.
     */
    await ctx.db.insert(dailyGoals).values([
      { userId, effectiveFrom: '2026-03-01', targetProblems: 2 },
      { userId, effectiveFrom: '2026-03-05', targetProblems: 9 },
    ]);
    await seedDay('2026-03-02', 2, 0, true);

    const shell = await summariseForShell(ctx.db, userId, '2026-03-02');

    expect(shell.goalTarget).toBe(2);
    expect(shell.goalMet).toBe(true);
  });

  it('IS SAFE TO CALL ON EVERY PAGE LOAD — same answer, no row churn', async () => {
    /*
     * This runs in the app layout, so it runs on every authenticated render.
     * It recomputes rather than trusting the stored row (the stored number ages
     * overnight), which is only defensible if a repeat call writes nothing.
     * Asserted on the full row, `updated_at` included.
     */
    await seedDay('2026-03-01', 2, 0, true);
    await seedDay('2026-03-02', 2, 0, true);

    const first = await summariseForShell(ctx.db, userId, '2026-03-02');
    const [rowBefore] = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;

    // A real gap in wall-clock time, so an unchanged timestamp means something.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await summariseForShell(ctx.db, userId, '2026-03-02');
    const [rowAfter] = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;

    expect(second).toEqual(first);
    expect(rowAfter).toEqual(rowBefore);
  });
});
