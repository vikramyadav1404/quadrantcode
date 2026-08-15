/**
 * Day completion, behind ONE function.
 *
 * The spec asks for a single `evaluateDayCompletion(input)` specifically so the
 * rule can become per-user later without every caller learning what "complete"
 * means. Nothing outside this file may re-implement the comparison — the moment
 * two places decide what a complete day is, they drift, and the symptom is a
 * streak that disagrees with the heatmap sitting next to it.
 *
 * Pure: no clock, no database, no timezone. The day it is given has already
 * been resolved by `day.ts`.
 */

export type DayCompletionInput = {
  /** Problems solved on this local date. */
  solvedCount: number;
  /** Revisions completed on this local date. */
  revisionCount: number;
  /** `daily_goals.target_problems` in force for this date. */
  targetProblems: number;
};

export type DayCompletionResult = {
  completed: boolean;
  /** Which arm of the rule fired, for the UI and for the tests. */
  reason: 'target-met' | 'revision-path' | 'incomplete';
};

/**
 * From the ticket, verbatim:
 *
 *   solved_count >= target_problems
 *   OR (revision_count >= 2 AND solved_count >= 1)
 *
 * The second arm is what stops a revision-heavy day counting as nothing. It
 * still requires a solve, so a day of pure revision does not complete a goal
 * about solving.
 *
 * `daily_goals.min_medium` is deliberately NOT consulted. The rule above is the
 * whole specification; wiring in a column because it exists would be inventing
 * product behaviour. It is captured at the goals page and unused here — stated
 * so it reads as a decision rather than an oversight.
 */
export function evaluateDayCompletion(input: DayCompletionInput): DayCompletionResult {
  const { solvedCount, revisionCount, targetProblems } = input;

  if (solvedCount < 0 || revisionCount < 0) {
    throw new Error('evaluateDayCompletion: counts cannot be negative');
  }
  if (targetProblems <= 0) {
    // `daily_goals_target_positive` enforces this in the database. Reaching
    // here with zero would make every empty day "complete", which is the kind
    // of wrong that inflates every streak in the system at once.
    throw new Error('evaluateDayCompletion: targetProblems must be positive');
  }

  if (solvedCount >= targetProblems) return { completed: true, reason: 'target-met' };
  if (revisionCount >= 2 && solvedCount >= 1) {
    return { completed: true, reason: 'revision-path' };
  }
  return { completed: false, reason: 'incomplete' };
}
