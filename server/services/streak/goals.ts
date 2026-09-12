/**
 * Which daily goal applied on a given day.
 *
 * `daily_goals` rows are effective-dated rather than mutated, so a target
 * raised today must not retroactively un-complete last month — D18's
 * immutability principle, applied to the goal instead of the timezone.
 *
 * The recompute, the heatmap and the shell all need the same answer. Before
 * this file each carried its own copy of the walk and its own literal `2`, so
 * "which target applied" had three implementations that could drift. The
 * symptom of that drift is the one `rules.ts` warns about in its own terms: a
 * streak that disagrees with the heatmap sitting next to it.
 */
import type { LocalDate } from './day';

/**
 * The target for a user who has never saved a goal.
 *
 * Mirrors the schema default on `daily_goals.target_problems`. It is why a new
 * user's very first day can complete at all — with no row and no default there
 * would be nothing to compare against.
 */
export const DEFAULT_TARGET_PROBLEMS = 2;

/** The columns of a goal row that decide a target; the rest are irrelevant here. */
export type EffectiveGoal = {
  effectiveFrom: string;
  targetProblems: number;
};

/**
 * The goal in force on `date`.
 *
 * `goals` must be ordered by `effectiveFrom` ASCENDING — the walk stops at the
 * first row that starts after the date, which is only sound in that order.
 */
export function targetOn(goals: readonly EffectiveGoal[], date: LocalDate): number {
  let target = DEFAULT_TARGET_PROBLEMS;

  for (const goal of goals) {
    if (goal.effectiveFrom <= date) target = goal.targetProblems;
    else break; // ordered ascending, so nothing later can apply
  }

  return target;
}
