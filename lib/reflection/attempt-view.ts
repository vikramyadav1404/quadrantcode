/**
 * One row of attempt history, in the client-safe layer.
 *
 * `components/` may not import from `server/` (deny-by-default, F0.1), and the
 * timeline is a component — so the contract between the query and the thing
 * that draws it lives here, exactly as `lib/streak/heatmap-day.ts` and
 * `lib/session/timer-bar-state.ts` do.
 */
import type { MistakeCategory, StuckCategory } from './taxonomy';

export type AttemptOutcome = 'solved' | 'stuck' | 'abandoned';

export type AttemptView = {
  sessionId: string;
  /**
   * 1-based from the oldest, and **null for an abandoned sitting**.
   *
   * `user_problems.total_attempts` excludes abandonment (D20), so numbering one
   * here would put "Attempt 4 of 3" on the page. The row still appears — it
   * happened — it simply is not counted as an attempt.
   */
  attemptNumber: number | null;
  outcome: AttemptOutcome;
  startedAt: Date;
  endedAt: Date;
  activeDurationSeconds: number;
  confidence: 'low' | 'medium' | 'high' | null;
  stuckMarkers: { category: StuckCategory; elapsedSeconds: number; note: string | null }[];
  mistakes: MistakeCategory[];
  approach: string | null;
  achievedComplexity: string | null;
  /** False when the reflection was skipped — not the same as an empty one. */
  hasReflection: boolean;
};

/** How an outcome reads to a user. `stuck` is not a failure and does not say so. */
export const OUTCOME_LABELS: Record<AttemptOutcome, string> = {
  solved: 'Solved',
  stuck: 'Stuck',
  abandoned: 'Abandoned',
};
