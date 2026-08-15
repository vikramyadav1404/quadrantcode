/**
 * The recompute: rebuild a user's streak from their days.
 *
 * Everything in `user_streaks` and `streak_freezes` is derived, so this is the
 * only writer and it is safe to run any number of times. That is the spec's
 * central requirement, and it is stronger than it sounds — see the note on
 * `updated_at` below.
 *
 * ## Why the whole window, not an increment
 *
 * A backfill can land on any past day, and a day landing in the middle of a gap
 * changes everything after it: the streak length, which days needed freezing,
 * and therefore the freeze balance for the rest of the month. An incremental
 * "extend by one" would be right for the common case and quietly wrong for the
 * case the spec explicitly asks for. Recomputing the window is cheap — it is
 * one indexed read of at most a year of rows — and it cannot drift.
 */
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { dailyGoals, dailySessions, streakFreezes, userStreaks } from '@/server/db/schema';
import { type LocalDate, localDateRange, previousLocalDate } from './day';
import { type FreezeCoverage, coverageFor } from './freezes';
import { evaluateDayCompletion } from './rules';

/**
 * How far back a recompute looks.
 *
 * A streak longer than this would be truncated, which is a real limit rather
 * than an arbitrary one: `daily_sessions_user_date_idx` makes the read cheap,
 * but unbounded history would make the cost grow with account age forever. 400
 * days covers a full year plus the slack a backfill needs.
 */
export const RECOMPUTE_WINDOW_DAYS = 400;

export type StreakState = {
  currentStreak: number;
  longestStreak: number;
  lastCompletedLocalDate: LocalDate | null;
};

export type DaySnapshot = {
  date: LocalDate;
  solvedCount: number;
  revisionCount: number;
  completed: boolean;
};

/**
 * Walk the days forward and produce the streak state plus the freeze coverage
 * it implies. Pure — this is the whole engine, and it never touches a database.
 *
 * `today` is passed in rather than read from a clock so the caller controls it
 * and every test is deterministic. A streak service that reads `new Date()`
 * internally cannot be tested across a DST boundary without changing the
 * machine's clock.
 */
export function computeStreak(
  days: readonly DaySnapshot[],
  today: LocalDate,
): { state: StreakState; coverage: FreezeCoverage[] } {
  if (days.length === 0) {
    return {
      state: { currentStreak: 0, longestStreak: 0, lastCompletedLocalDate: null },
      coverage: [],
    };
  }

  const completion = new Map(days.map((day) => [day.date, day.completed]));
  const first = days[0]!.date;

  /*
   * Every calendar day from the first record to today, including days with no
   * row at all — a missing day is a MISSED day, and iterating only over stored
   * rows would silently treat a gap as if it never happened. That is the
   * difference between "you have a 5-day streak" and "you had 5 days, spread
   * over three weeks".
   */
  const calendar = localDateRange(first, today).map((date) => ({
    date,
    completed: completion.get(date) ?? false,
  }));

  /*
   * Coverage is decided over days STRICTLY BEFORE today.
   *
   * Today is not a missed day — the user has the rest of it to solve. Offering
   * today to `coverageFor` spends a freeze on it the moment a recompute runs,
   * which drains the monthly allowance in two days and hands out protection
   * nobody asked for. Found by the "today does not break the streak" test
   * returning 6 for a five-day run: the sixth day was today, frozen.
   *
   * A frozen day otherwise counts toward the chain exactly as a completed one.
   */
  const settled = calendar.filter((day) => day.date < today);
  const coverage = coverageFor(settled);
  const frozen = new Set(coverage.map((row) => row.coveredLocalDate));

  let current = 0;
  let longest = 0;
  let lastCounted: LocalDate | null = null;

  for (const day of calendar) {
    const counts = day.completed || frozen.has(day.date);

    if (counts) {
      current += 1;
      longest = Math.max(longest, current);
      lastCounted = day.date;
    } else {
      current = 0;
    }
  }

  /*
   * TODAY IS NOT YET A MISS.
   *
   * The loop above resets `current` to 0 on any day that does not count, and
   * today usually does not — the user has not solved yet. Without this, every
   * streak in the product would read zero every morning and repair itself in
   * the evening, which is precisely the "streak breaks daily" failure the
   * ticket warns about.
   *
   * So if today is incomplete and unfrozen, the answer is the streak as it
   * stood at the end of yesterday.
   */
  const todayCounts = (completion.get(today) ?? false) || frozen.has(today);
  if (!todayCounts) {
    let asOfYesterday = 0;
    for (const day of calendar) {
      if (day.date === today) break;
      asOfYesterday = day.completed || frozen.has(day.date) ? asOfYesterday + 1 : 0;
    }
    current = asOfYesterday;
  }

  return {
    state: {
      currentStreak: current,
      longestStreak: longest,
      lastCompletedLocalDate: lastCounted,
    },
    coverage,
  };
}

/** Read the days, compute, and persist only if something actually changed. */
export async function recomputeStreak(
  db: Database,
  userId: string,
  today: LocalDate,
): Promise<StreakState> {
  const windowStart = previousLocalDate(today, RECOMPUTE_WINDOW_DAYS);

  const [sessions, goals, storedFreezes, [stored]] = await Promise.all([
    db
      .select({
        localDate: dailySessions.localDate,
        solvedCount: dailySessions.solvedCount,
        revisionCount: dailySessions.revisionCount,
      })
      .from(dailySessions)
      .where(and(eq(dailySessions.userId, userId), gte(dailySessions.localDate, windowStart)))
      .orderBy(dailySessions.localDate),
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
      .where(
        and(eq(streakFreezes.userId, userId), gte(streakFreezes.coveredLocalDate, windowStart)),
      ),
    db.select().from(userStreaks).where(eq(userStreaks.userId, userId)).limit(1),
  ]);

  const days: DaySnapshot[] = sessions.map((session) => {
    /*
     * The goal IN FORCE on that day, not the current one. A user who raised
     * their target last week must not have last month's completed days
     * retroactively un-completed — the same immutability principle as D18's
     * timezone rule, applied to the goal.
     */
    const target = targetOn(goals, session.localDate);
    const { completed } = evaluateDayCompletion({
      solvedCount: session.solvedCount,
      revisionCount: session.revisionCount,
      targetProblems: target,
    });
    return {
      date: session.localDate,
      solvedCount: session.solvedCount,
      revisionCount: session.revisionCount,
      completed,
    };
  });

  const { state, coverage } = computeStreak(days, today);

  await persistCoverage(db, userId, coverage, storedFreezes, windowStart);
  await persistState(db, userId, state, stored);

  return state;
}

/** The active goal covering `date`, falling back to the schema default. */
function targetOn(
  goals: readonly { effectiveFrom: string; targetProblems: number }[],
  date: LocalDate,
): number {
  let target = 2; // `daily_goals.target_problems` default
  for (const goal of goals) {
    if (goal.effectiveFrom <= date) target = goal.targetProblems;
    else break; // ordered ascending, so nothing later can apply
  }
  return target;
}

/**
 * Write the coverage difference.
 *
 * A difference, not a delete-and-reinsert. Rewriting identical rows would churn
 * `consumed_at` on every recompute, so a freeze's recorded consumption time
 * would drift forward forever and the log would stop meaning anything.
 */
async function persistCoverage(
  db: Database,
  userId: string,
  desired: readonly FreezeCoverage[],
  stored: readonly { coveredLocalDate: string }[],
  windowStart: LocalDate,
): Promise<void> {
  const desiredDates = new Set(desired.map((row) => row.coveredLocalDate));
  const storedDates = new Set(stored.map((row) => row.coveredLocalDate));

  const toInsert = [...desiredDates].filter((date) => !storedDates.has(date));
  // Released by a backfill — see D18. Scoped to the window so history outside
  // it is never touched by a recompute that could not have considered it.
  const toDelete = [...storedDates].filter(
    (date) => !desiredDates.has(date) && date >= windowStart,
  );

  if (toDelete.length > 0) {
    await db
      .delete(streakFreezes)
      .where(
        and(
          eq(streakFreezes.userId, userId),
          inArray(streakFreezes.coveredLocalDate, toDelete),
        ),
      );
  }

  if (toInsert.length > 0) {
    await db
      .insert(streakFreezes)
      .values(toInsert.map((coveredLocalDate) => ({ userId, coveredLocalDate })))
      // Targeted, per D16: the only conflict this absorbs is a concurrent
      // recompute inserting the same coverage.
      .onConflictDoNothing({
        target: [streakFreezes.userId, streakFreezes.coveredLocalDate],
      });
  }
}

/**
 * Write the streak state — **only if it differs**.
 *
 * The spec asks that a double recompute yield identical row versions. An
 * unconditional `UPDATE … SET …` satisfies every test that compares the
 * interesting columns and fails that requirement, because `updated_at` moves.
 * Comparing first is what makes the second run a genuine no-op.
 */
async function persistState(
  db: Database,
  userId: string,
  state: StreakState,
  stored:
    | { currentStreak: number; longestStreak: number; lastCompletedLocalDate: string | null }
    | undefined,
): Promise<void> {
  if (!stored) {
    await db
      .insert(userStreaks)
      .values({ userId, ...state })
      .onConflictDoNothing({ target: userStreaks.userId });
    return;
  }

  const unchanged =
    stored.currentStreak === state.currentStreak &&
    stored.longestStreak === state.longestStreak &&
    stored.lastCompletedLocalDate === state.lastCompletedLocalDate;

  if (unchanged) return;

  await db
    .update(userStreaks)
    .set({ ...state, updatedAt: new Date() })
    .where(eq(userStreaks.userId, userId));
}
