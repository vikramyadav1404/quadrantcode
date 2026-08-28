/**
 * When a solved problem comes back.
 *
 * Two ladders of five rungs. A solve puts the problem on one of them, four
 * signals can move it up or down a rung, and how the revision itself goes
 * decides where it sits next time.
 *
 * Pure: no clock, no database. `today` arrives as a parameter like every other
 * date in this codebase (D18), which is what lets a ninety-day simulation run
 * in milliseconds instead of ninety days.
 */
import { type LocalDate, nextLocalDate } from '@/server/services/streak';

/**
 * The ladders, in days.
 *
 * Standard is the spec's 1 · 3 · 7 · 14 · 30. Compressed is 1 · 2 · 5 · 10 · 21
 * — the same shape, roughly 70% of the gaps, for a user who said the solve left
 * them unsure.
 *
 * They are the same LENGTH on purpose. A user's ladder can be chosen by their
 * confidence without changing what "rung 3" means, so `ladder_index` stays
 * comparable across problems and the outcome rules do not need a special case.
 */
export const BASE_LADDER = [1, 3, 7, 14, 30] as const;
export const COMPRESSED_LADDER = [1, 2, 5, 10, 21] as const;

/** The spec's hard floor: an interval is never shorter than this, ever. */
export const INTERVAL_FLOOR_DAYS = 1;

/** Solving in more than this multiple of the estimate compresses a step. */
export const SLOW_SOLVE_RATIO = 1.5;

/** This many failed attempts on a problem compresses a step. */
export const FAILED_ATTEMPTS_THRESHOLD = 2;

export type LadderKind = 'standard' | 'compressed';
export type RevisionOutcome = 'clean' | 'struggled' | 'failed';
export type Confidence = 'low' | 'medium' | 'high';

/** What the solve looked like. Everything here is already known when it ends. */
export type SolveSignals = {
  confidence: Confidence | null;
  /**
   * Hints taken during the solve.
   *
   * **Nothing sets this above zero today.** Hints come from F3.4 `ai-gateway`,
   * which is cut from the target scope, so the signal is implemented, tested and
   * inert. It is here rather than omitted because the ladder rule is specified
   * and testable, and because a signal added later to a scheduler that has been
   * running for months changes everyone's intervals at once.
   */
  hintsUsed: number;
  /** Sittings on this problem that ended `stuck` (F1.4's outcome, not a guess). */
  failedAttempts: number;
  activeSeconds: number;
  estimatedSeconds: number;
};

/** Which rules moved the step, named so a test and a record can both read them. */
export type LadderSignal =
  'low-confidence-ladder' | 'hints-used' | 'failed-attempts' | 'slow-solve' | 'clean-and-quick';

export type LadderStep = {
  kind: LadderKind;
  index: number;
  intervalDays: number;
  /** Every rule that fired, in the order they are evaluated. */
  applied: LadderSignal[];
};

export function ladderFor(kind: LadderKind): readonly number[] {
  return kind === 'compressed' ? COMPRESSED_LADDER : BASE_LADDER;
}

/**
 * Where a problem sits after it has been solved.
 *
 * `fromIndex` is where it already was — 0 for a first solve, or the current rung
 * when an old problem is solved again.
 *
 * ## Why signals move a STEP rather than scale the interval
 *
 * Multiplying would produce intervals that are not on the ladder — 4.5 days, 21
 * days on the standard ladder — and then "which rung are you on" stops meaning
 * anything, which is the question the outcome rules are written in terms of. A
 * step keeps every interval a value the user could have been given anyway.
 */
export function scheduleAfterSolve(signals: SolveSignals, fromIndex = 0): LadderStep {
  const applied: LadderSignal[] = [];

  /*
   * Confidence picks the LADDER, not the rung.
   *
   * Low confidence is a statement about the whole solve, not about one interval,
   * so it shortens every gap that follows rather than knocking off one step and
   * then behaving normally.
   */
  const kind: LadderKind = signals.confidence === 'low' ? 'compressed' : 'standard';
  if (kind === 'compressed') applied.push('low-confidence-ladder');

  let steps = 0;

  if (signals.hintsUsed > 0) {
    steps -= 1;
    applied.push('hints-used');
  }

  if (signals.failedAttempts >= FAILED_ATTEMPTS_THRESHOLD) {
    steps -= 1;
    applied.push('failed-attempts');
  }

  if (
    signals.estimatedSeconds > 0 &&
    signals.activeSeconds > signals.estimatedSeconds * SLOW_SOLVE_RATIO
  ) {
    steps -= 1;
    applied.push('slow-solve');
  }

  /*
   * The one rule that lengthens a gap, and it demands all three at once: sure of
   * themselves, unaided, and inside the estimate. Any single doubt is enough not
   * to stretch — a scheduler that stretches too eagerly loses the problem, and
   * the cost of being wrong in that direction is much higher than repeating a
   * revision the user did not need.
   *
   * It can still be cancelled by a compression: two failed attempts and a clean
   * quick solve is a wash, which is the correct reading of both facts.
   */
  if (
    signals.confidence === 'high' &&
    signals.hintsUsed === 0 &&
    signals.estimatedSeconds > 0 &&
    signals.activeSeconds <= signals.estimatedSeconds
  ) {
    steps += 1;
    applied.push('clean-and-quick');
  }

  return stepTo(kind, fromIndex + steps, applied);
}

/**
 * Where a problem sits after a revision.
 *
 * Three outcomes, three rules, and they are the spec's:
 *
 *   clean      → advance a rung; the gap grows
 *   struggled  → stay; the same gap again
 *   failed     → back to rung 0, which is one day
 *
 * `struggled` exists so a user who is barely holding on is not pushed to a
 * longer gap by a system that only knows pass and fail. Collapsing it into
 * `clean` would do exactly that.
 */
export function applyOutcome(
  current: { kind: LadderKind; index: number },
  outcome: RevisionOutcome,
): LadderStep {
  if (outcome === 'failed') return stepTo(current.kind, 0, []);
  if (outcome === 'struggled') return stepTo(current.kind, current.index, []);

  return stepTo(current.kind, current.index + 1, []);
}

/** The local date an interval lands on, counted from the day it was set. */
export function dueDateFor(from: LocalDate, intervalDays: number): LocalDate {
  return nextLocalDate(from, Math.max(INTERVAL_FLOOR_DAYS, intervalDays));
}

/**
 * Clamp to the ladder and take the interval.
 *
 * The floor is applied twice over: the index cannot go below 0, and the value
 * is floored again. The second is redundant while rung 0 is one day, and it
 * stays because the spec's rule is about the INTERVAL, not the index — a future
 * ladder starting at something other than 1 must not be able to break it
 * quietly.
 */
function stepTo(kind: LadderKind, rawIndex: number, applied: LadderSignal[]): LadderStep {
  const ladder = ladderFor(kind);
  const index = Math.min(ladder.length - 1, Math.max(0, rawIndex));

  return {
    kind,
    index,
    intervalDays: Math.max(INTERVAL_FLOOR_DAYS, ladder[index]!),
    applied,
  };
}
