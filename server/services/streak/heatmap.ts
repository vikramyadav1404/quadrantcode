/**
 * The 365-day contribution heatmap.
 *
 * ## A frozen day is not a solved day, and the heatmap says so
 *
 * The obvious implementation renders `daily_sessions` and colours anything that
 * counted toward the streak. That produces an unbroken chain of green across
 * days the user did not solve — they would look at it and believe they had.
 *
 * That is the same failure D18 names for the timezone change: behaviour that is
 * correct and unexplained is indistinguishable from a defect, except here it is
 * worse, because the user is not confused — they are confidently wrong about
 * their own history.
 *
 * So a frozen day carries its own kind, its own visual treatment, and a tooltip
 * that says what actually happened. `HeatmapDay.kind` is the contract:
 *
 *   'solved'     the day was completed by real activity
 *   'frozen'     the day was missed and a streak freeze covered it
 *   'partial'    there was activity, but not enough to complete the day
 *   'empty'      nothing happened
 *
 * `solved` and `frozen` both count toward the streak. They are still different
 * facts and the UI must not merge them.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { dailyGoals, dailySessions, streakFreezes } from '@/server/db/schema';
import type { HeatmapDay } from '@/lib/streak/heatmap-day';
import { type LocalDate, localDateRange, previousLocalDate } from './day';
import { targetOn } from './goals';
import { evaluateDayCompletion } from './rules';

export const HEATMAP_DAYS = 365;

/*
 * Re-exported from `lib/` rather than declared here: `components/` may not
 * import from `server/` (deny-by-default, F0.1), and this type is a contract
 * between the query below and the component that renders it.
 */
export type { HeatmapDay, HeatmapDayKind } from '@/lib/streak/heatmap-day';

/**
 * Exactly `HEATMAP_DAYS` cells ending on `today`, including days with no row.
 *
 * Always the full length — a heatmap that renders only days with data has
 * holes where the user's eye expects a grid, and the acceptance criterion asks
 * for 365 cells.
 */
export async function buildHeatmap(
  db: Database,
  userId: string,
  today: LocalDate,
): Promise<HeatmapDay[]> {
  const start = previousLocalDate(today, HEATMAP_DAYS - 1);

  const [sessions, goals, freezes] = await Promise.all([
    db
      .select({
        localDate: dailySessions.localDate,
        solvedCount: dailySessions.solvedCount,
        revisionCount: dailySessions.revisionCount,
      })
      .from(dailySessions)
      .where(and(eq(dailySessions.userId, userId), gte(dailySessions.localDate, start))),
    db
      .select({
        effectiveFrom: dailyGoals.effectiveFrom,
        targetProblems: dailyGoals.targetProblems,
      })
      .from(dailyGoals)
      .where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.active, true)))
      .orderBy(dailyGoals.effectiveFrom),
    db
      .select({ coveredLocalDate: streakFreezes.coveredLocalDate })
      .from(streakFreezes)
      .where(and(eq(streakFreezes.userId, userId), gte(streakFreezes.coveredLocalDate, start))),
  ]);

  const byDate = new Map(sessions.map((session) => [session.localDate, session]));
  const frozen = new Set(freezes.map((row) => row.coveredLocalDate));

  return localDateRange(start, today).map((date) => {
    const session = byDate.get(date);
    const solvedCount = session?.solvedCount ?? 0;
    const revisionCount = session?.revisionCount ?? 0;

    /*
     * Frozen is checked FIRST. A day can only be frozen if it was not
     * completed, so the two cannot both apply — but ordering the check this way
     * means a future change to that invariant surfaces as a frozen day showing
     * as frozen, rather than a freeze silently disappearing behind a green
     * cell.
     */
    if (frozen.has(date)) {
      return { date, solvedCount, revisionCount, kind: 'frozen' as const };
    }

    // The goal in force on that day, through the same function the recompute
    // calls. Two copies of this walk is how a heatmap starts disagreeing with
    // the streak drawn above it.
    const target = targetOn(goals, date);

    const { completed } = evaluateDayCompletion({
      solvedCount,
      revisionCount,
      targetProblems: target,
    });
    if (completed) return { date, solvedCount, revisionCount, kind: 'solved' as const };
    if (solvedCount > 0 || revisionCount > 0) {
      return { date, solvedCount, revisionCount, kind: 'partial' as const };
    }
    return { date, solvedCount, revisionCount, kind: 'empty' as const };
  });
}
