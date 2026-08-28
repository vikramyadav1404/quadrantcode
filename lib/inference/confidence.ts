/**
 * F3.3 · how sure we are, and what that is worth downstream.
 *
 * Declared once and built into `pgEnum` from here (**D21**), like the reflection
 * taxonomy and the execution languages before it.
 *
 * ## The wording rules live here because they are not style
 *
 * **C4**: this project never says it detected anything. A stuck point that has
 * been INFERRED is a guess from timing and edits — the user may have been
 * reading, thinking, or getting coffee. Every label below hedges, and a test
 * greps the whole module and its UI for the words that would not.
 */

/**
 * Ordered most certain first, which is also the order they rank in.
 *
 * `user_marked` is not a confidence level so much as the absence of guessing:
 * the user pressed a button and said so. It exists in the same enum because the
 * UI sorts one list and the alternative is a second field meaning "but this one
 * is real".
 */
export const STUCK_CONFIDENCE = ['user_marked', 'high', 'medium', 'low'] as const;

export type StuckConfidence = (typeof STUCK_CONFIDENCE)[number];

/**
 * What the user has done about an inferred point.
 *
 * Distinct from `source` (F1.5's column, `user` | `inferred`), and both are
 * needed. `source` records who proposed it; `status` records whether the user
 * agreed. An inferred point the user confirmed stays `inferred` in origin and
 * becomes `confirmed` in standing — and it is the standing that decides weight.
 */
export const STUCK_STATUS = ['inferred', 'confirmed', 'dismissed'] as const;

export type StuckStatus = (typeof STUCK_STATUS)[number];

/**
 * How much an unconfirmed inference counts, against a confirmed one at 1.0.
 *
 * The ticket requires this number to be documented rather than buried, so:
 * **0.4**. An inferred point is evidence that something happened, not evidence
 * about what — the user was in one place for four minutes, and "stuck" is our
 * reading of that, not theirs.
 *
 * Chosen so that two unconfirmed inferences still weigh less than one thing the
 * user actually said (0.8 < 1.0). Nothing derived should be able to outvote the
 * person, however much of it accumulates.
 *
 * A dismissed point is 0 and not a small number: the user said it was wrong,
 * and continuing to count it a little is disagreeing with them quietly.
 */
export const INFERRED_WEIGHT = 0.4;
export const CONFIRMED_WEIGHT = 1.0;
export const DISMISSED_WEIGHT = 0;

export function weightFor(status: StuckStatus): number {
  if (status === 'confirmed') return CONFIRMED_WEIGHT;
  if (status === 'dismissed') return DISMISSED_WEIGHT;
  return INFERRED_WEIGHT;
}

/**
 * How a confidence is described to the user.
 *
 * Every one hedges. "Likely", "may have", "possibly" — never "you were stuck",
 * never "detected", never a line number stated as fact.
 */
export const CONFIDENCE_LABELS: Record<StuckConfidence, string> = {
  user_marked: 'You marked this',
  high: 'Likely a stuck point',
  medium: 'Possibly a stuck point',
  low: 'Might be a stuck point',
};

/**
 * The heading for a region, in the wording C4 requires.
 *
 * "likely stuck around lines 16–20", never "you got stuck at line 18". The
 * range is always a range, even when the signal found a single line, because a
 * single line stated precisely is a claim about attention we cannot make.
 */
export function describeRegion(lineStart: number, lineEnd: number): string {
  return lineStart === lineEnd
    ? `around line ${lineStart}`
    : `around lines ${lineStart}–${lineEnd}`;
}

/** Ranking order: what the user said first, then how sure we are. */
export function confidenceRank(confidence: StuckConfidence): number {
  return STUCK_CONFIDENCE.indexOf(confidence);
}
