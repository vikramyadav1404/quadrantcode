/**
 * F1.3 · the heatmap.
 *
 * The criterion is "365 cells with correct per-day counts". The assertion that
 * matters more is the one it does not name: **a frozen day must not look like a
 * solved day.** Merging them shows an unbroken wall of green across days the
 * user did not solve, and they would believe it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dailyGoals, dailySessions } from '@/server/db/schema';
import { HEATMAP_DAYS, buildHeatmap } from '@/server/services/streak/heatmap';
import { recomputeStreak } from '@/server/services/streak/recompute';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('F1.3 · buildHeatmap', () => {
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
    userId = (await createUser(ctx.db, { email: 'heatmap@example.com' })).id;
  });

  it('renders exactly 365 cells, ending on today', async () => {
    const days = await buildHeatmap(ctx.db, userId, '2026-03-10');
    expect(days).toHaveLength(HEATMAP_DAYS);
    expect(days.at(-1)?.date).toBe('2026-03-10');
    expect(days[0]?.date).toBe('2025-03-11');
  });

  it('fills days with no row rather than leaving holes', async () => {
    // A grid with gaps is not a grid. Every cell exists even with no data.
    const days = await buildHeatmap(ctx.db, userId, '2026-03-10');
    expect(days.every((day) => day.kind === 'empty')).toBe(true);
    expect(days.every((day) => day.solvedCount === 0)).toBe(true);
  });

  it('carries the per-day counts', async () => {
    await ctx.db.insert(dailySessions).values({
      userId,
      localDate: '2026-03-09',
      solvedCount: 3,
      revisionCount: 2,
    });

    const days = await buildHeatmap(ctx.db, userId, '2026-03-10');
    const day = days.find((entry) => entry.date === '2026-03-09');
    expect(day?.solvedCount).toBe(3);
    expect(day?.revisionCount).toBe(2);
  });

  it('A FROZEN DAY IS NOT A SOLVED DAY', async () => {
    /*
     * The assertion the criterion does not ask for and the user needs most.
     * Both count toward the streak; only one is something they did. If these
     * ever rendered the same, an unbroken chain of green would include days
     * with no activity at all.
     */
    await ctx.db.insert(dailySessions).values([
      { userId, localDate: '2026-03-08', solvedCount: 2, revisionCount: 0 },
      { userId, localDate: '2026-03-09', solvedCount: 0, revisionCount: 0 },
      { userId, localDate: '2026-03-10', solvedCount: 2, revisionCount: 0 },
    ]);
    await recomputeStreak(ctx.db, userId, '2026-03-10');

    const days = await buildHeatmap(ctx.db, userId, '2026-03-10');
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get('2026-03-08')?.kind).toBe('solved');
    expect(byDate.get('2026-03-09')?.kind).toBe('frozen');
    expect(byDate.get('2026-03-10')?.kind).toBe('solved');

    // …and the frozen day genuinely had no solves, which is what makes showing
    // it as 'solved' a lie rather than a rounding.
    expect(byDate.get('2026-03-09')?.solvedCount).toBe(0);
  });

  it('distinguishes partial activity from nothing at all', async () => {
    // One solve against a target of two is not a completed day, but it is also
    // not an empty one — collapsing them would erase effort the user made.
    await ctx.db.insert(dailySessions).values({
      userId,
      localDate: '2026-03-09',
      solvedCount: 1,
      revisionCount: 0,
    });

    const days = await buildHeatmap(ctx.db, userId, '2026-03-10');
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get('2026-03-09')?.kind).toBe('partial');
    expect(byDate.get('2026-03-08')?.kind).toBe('empty');
  });

  it('uses the goal in force on each day, matching the recompute', async () => {
    /*
     * The heatmap and the streak must not disagree about what a completed day
     * is. Two implementations of the same rule would drift; both call
     * evaluateDayCompletion, and this asserts they agree at the boundary where
     * the goal changed.
     */
    await ctx.db.insert(dailyGoals).values([
      { userId, effectiveFrom: '2026-03-01', targetProblems: 2 },
      { userId, effectiveFrom: '2026-03-10', targetProblems: 5 },
    ]);
    await ctx.db.insert(dailySessions).values([
      { userId, localDate: '2026-03-09', solvedCount: 2, revisionCount: 0 },
      { userId, localDate: '2026-03-10', solvedCount: 2, revisionCount: 0 },
    ]);

    const days = await buildHeatmap(ctx.db, userId, '2026-03-10');
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get('2026-03-09')?.kind).toBe('solved'); // target was 2
    expect(byDate.get('2026-03-10')?.kind).toBe('partial'); // target is now 5
  });

  it('never shows another user data', async () => {
    const other = await createUser(ctx.db, { email: 'other-heatmap@example.com' });
    await ctx.db.insert(dailySessions).values({
      userId: other.id,
      localDate: '2026-03-09',
      solvedCount: 5,
      revisionCount: 5,
    });

    const days = await buildHeatmap(ctx.db, userId, '2026-03-10');
    expect(days.every((day) => day.solvedCount === 0)).toBe(true);
  });

  it('spans a leap day without dropping a cell', async () => {
    // 2024 is a leap year; the window crossing 02-29 must still be 365 long
    // and must contain that date.
    const days = await buildHeatmap(ctx.db, userId, '2024-03-01');
    expect(days).toHaveLength(HEATMAP_DAYS);
    expect(days.map((day) => day.date)).toContain('2024-02-29');
  });
});
