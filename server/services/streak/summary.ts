/**
 * The numbers the application shell shows: the streak badge and the daily-goal
 * ring.
 *
 * F0.4 built both as pure presentation over props and left the layout passing
 * constants, with the standing note that F1.3 would supply the real values.
 * This is that function. One call, so the shell still never queries — the rule
 * that let this land without changing the components' shape.
 */
import { and, desc, eq, lte } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { dailyGoals, dailySessions } from '@/server/db/schema';
import type { LocalDate } from './day';
import { DEFAULT_TARGET_PROBLEMS } from './goals';
import { recomputeStreak } from './recompute';
import { evaluateDayCompletion } from './rules';

export type ShellStreak = {
  /** `user_streaks.current_streak`, as of `today`. */
  streakDays: number;
  /** The streak is live and today has not counted yet. */
  streakAtRisk: boolean;
  /** Problems solved today. The true count, never rounded up to the target. */
  goalCompleted: number;
  /** `daily_goals.target_problems` in force today. */
  goalTarget: number;
  /**
   * Today counts toward the streak.
   *
   * Not the same as `goalCompleted >= goalTarget`: the revision arm of the rule
   * completes a day at one solve. The ring needs both facts — the honest count
   * and whether the day is done — or it draws 1 of 2 beside a badge that has
   * already counted the day, and the two contradict each other on the same bar.
   */
  goalMet: boolean;
};

/**
 * Everything the top bar needs, for `today` in the user's timezone.
 *
 * `today` is a parameter, not a clock read, for the reason the whole module
 * gives: a caller that cannot control the date cannot be tested across the
 * boundaries that break streak engines.
 */
export async function summariseForShell(
  db: Database,
  userId: string,
  today: LocalDate,
): Promise<ShellStreak> {
  /*
   * The recompute runs on read, here as on the goals page, because F2.3 is cut
   * and nothing will run it on a schedule (D17).
   *
   * The cheaper alternative — trust whatever is stored in `user_streaks` — is
   * wrong at exactly the moment that matters. The stored number ages overnight:
   * a user who missed yesterday still carries last night's count, and whether a
   * freeze covers that day is decided BY the recompute, not by the reader. The
   * badge would show a streak that has already broken, on the most-visited
   * surface in the product, until something else happened to rebuild it.
   *
   * The cost is one indexed read of at most a year of narrow rows, and
   * `recomputeStreak` compares before it writes — an unchanged state is a pure
   * read, which is the common case on a page load.
   */
  const [state, [session], [goal]] = await Promise.all([
    recomputeStreak(db, userId, today),

    db
      .select({
        solvedCount: dailySessions.solvedCount,
        revisionCount: dailySessions.revisionCount,
      })
      .from(dailySessions)
      .where(and(eq(dailySessions.userId, userId), eq(dailySessions.localDate, today)))
      .limit(1),

    /*
     * "Which goal applied on date D" — the query `daily_goals_user_effective_idx`
     * was built for. `effective_from <= today` matters even though the settings
     * action only ever writes today's date: a zone change can move the user's
     * today backwards, and a row saved as tomorrow must not govern tonight.
     */
    db
      .select({ targetProblems: dailyGoals.targetProblems })
      .from(dailyGoals)
      .where(
        and(
          eq(dailyGoals.userId, userId),
          eq(dailyGoals.active, true),
          lte(dailyGoals.effectiveFrom, today),
        ),
      )
      .orderBy(desc(dailyGoals.effectiveFrom))
      .limit(1),
  ]);

  const goalTarget = goal?.targetProblems ?? DEFAULT_TARGET_PROBLEMS;
  const solvedCount = session?.solvedCount ?? 0;
  const revisionCount = session?.revisionCount ?? 0;

  // Through `evaluateDayCompletion`, never a comparison written here — the one
  // rule rules.ts exists to keep in one place.
  const { completed } = evaluateDayCompletion({
    solvedCount,
    revisionCount,
    targetProblems: goalTarget,
  });

  return {
    streakDays: state.currentStreak,

    /*
     * At risk only when there is something to lose. `atRisk` turns the badge
     * warning-coloured, and on a zero streak that is an alarm about nothing —
     * which is how users learn to stop reading a colour.
     */
    streakAtRisk: state.currentStreak > 0 && !completed,

    goalCompleted: solvedCount,
    goalTarget,
    goalMet: completed,
  };
}
