/**
 * FSRS — the opt-in alternative to the fixed ladder.
 *
 * FSRS-4.5 with its published default parameters, at a target retention of
 * 90%. Each problem carries two numbers: STABILITY (days until recall drops to
 * 90%) and DIFFICULTY (1–10). Every solve or revision is a review graded
 * Again · Hard · Good · Easy, and the next interval is the new stability.
 *
 * Pure: no clock, no database, like `ladder.ts`.
 *
 * Opt-in per user (`user_profiles.revision_scheduler = 'fsrs'`). Switching never
 * rewrites a date already set: a ladder row picks up FSRS state the next time it
 * is solved or revised, starting from its current interval.
 */
import type { RevisionOutcome, SolveSignals } from './ladder';

/** FSRS-4.5 default parameters (w0…w16). */
export const FSRS_WEIGHTS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461,
  2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
] as const;

const DECAY = -0.5;
const FACTOR = 19 / 81;
/** Longest interval FSRS may set. Keeps a due date inside a year. */
export const FSRS_MAX_INTERVAL_DAYS = 365;

export type FsrsGrade = 1 | 2 | 3 | 4; // Again · Hard · Good · Easy
export type FsrsState = { stability: number; difficulty: number };

const w = FSRS_WEIGHTS;
const clampDifficulty = (value: number) => Math.min(10, Math.max(1, value));

/** Probability of recall after `elapsedDays` with this stability. */
export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

function initialDifficulty(grade: FsrsGrade): number {
  return clampDifficulty(w[4] - (grade - 3) * w[5]);
}

/** The state after a FIRST review (no prior state). */
export function initialState(grade: FsrsGrade): FsrsState {
  return { stability: w[grade - 1]!, difficulty: initialDifficulty(grade) };
}

/** The state after a review of a problem that already has state. */
export function nextState(state: FsrsState, grade: FsrsGrade, elapsedDays: number): FsrsState {
  const r = retrievability(elapsedDays, state.stability);
  const shifted = state.difficulty - w[6] * (grade - 3);
  const difficulty = clampDifficulty(w[7] * initialDifficulty(3) + (1 - w[7]) * shifted);

  if (grade === 1) {
    const forgotten =
      w[11] *
      Math.pow(state.difficulty, -w[12]) *
      (Math.pow(state.stability + 1, w[13]) - 1) *
      Math.exp(w[14] * (1 - r));
    return { stability: Math.min(forgotten, state.stability), difficulty };
  }

  const hardPenalty = grade === 2 ? w[15] : 1;
  const easyBonus = grade === 4 ? w[16] : 1;
  const recalled =
    state.stability *
    (Math.exp(w[8]) *
      (11 - state.difficulty) *
      Math.pow(state.stability, -w[9]) *
      (Math.exp(w[10] * (1 - r)) - 1) *
      hardPenalty *
      easyBonus +
      1);
  return { stability: recalled, difficulty };
}

/** At 90% target retention the interval equals the stability, rounded, 1…365 days. */
export function intervalFor(state: FsrsState): number {
  return Math.min(FSRS_MAX_INTERVAL_DAYS, Math.max(1, Math.round(state.stability)));
}

/** A revision's outcome as an FSRS grade. */
export function gradeForOutcome(outcome: RevisionOutcome): FsrsGrade {
  if (outcome === 'failed') return 1;
  if (outcome === 'struggled') return 2;
  return 3;
}

/**
 * A solve as an FSRS grade, read from the same signals the ladder uses:
 * any doubt (low confidence, a hint, repeated failed sittings, a slow solve)
 * is Hard; sure, unaided and inside the estimate is Easy; otherwise Good.
 */
export function gradeForSolve(signals: SolveSignals): FsrsGrade {
  const slow =
    signals.estimatedSeconds > 0 && signals.activeSeconds > signals.estimatedSeconds * 1.5;
  if (
    signals.confidence === 'low' ||
    signals.hintsUsed > 0 ||
    signals.failedAttempts >= 2 ||
    slow
  )
    return 2;
  if (
    signals.confidence === 'high' &&
    signals.estimatedSeconds > 0 &&
    signals.activeSeconds <= signals.estimatedSeconds
  )
    return 4;
  return 3;
}

/**
 * State for a row that has none yet: a ladder row switching to FSRS keeps its
 * current interval as its stability, at middling difficulty.
 */
export function stateFromLadder(intervalDays: number): FsrsState {
  return { stability: Math.max(1, intervalDays), difficulty: initialDifficulty(3) };
}
