/**
 * Is a mistake getting rarer, or not?
 *
 * ## The rule, written down rather than hand-waved
 *
 * The ticket asks for this explicitly, so: compare the RATE over the last
 * thirty days against the rate over the thirty before that.
 *
 *   recent  = occurrences in days   0–30 before `today`
 *   earlier = occurrences in days  30–60 before `today`
 *
 *   improving  · recent < earlier × (1 − MARGIN)  AND  earlier − recent >= FLOOR
 *   worsening  · recent > earlier × (1 + MARGIN)  AND  recent − earlier >= FLOOR
 *   flat       · everything else, including both windows empty
 *
 * ## Why a rate and not a total
 *
 * A running total only ever goes up, so every pattern would read "worsening"
 * forever and the word would stop meaning anything. What a user wants to know
 * is whether they are still making the mistake, and that is a comparison
 * between two windows of equal length.
 *
 * ## Why there are TWO thresholds
 *
 * Four occurrences becoming three is noise, not progress. A percentage margin
 * alone does not stop that: 20% of four is 0.8, so a single occurrence clears
 * it and the small patterns — which is most of them — flip label on one event.
 * **The test caught exactly that**, and the absolute floor is the fix.
 *
 * So a change must be both proportionally large (**20%**) and at least
 * **2 occurrences**. Together they mean a big pattern needs a real shift and a
 * small one needs more than a single week's luck.
 *
 * ## The case this gets wrong on purpose
 *
 * A user who stops practising entirely looks like they are improving: no recent
 * occurrences, so `recent < earlier`. That is a real limitation of counting
 * mistakes rather than mistakes-per-attempt, and `NEEDS_ACTIVITY` is the guard
 * — a window with no solves at all reports `flat`, because nothing was
 * observed and "improving" would be a compliment nobody earned.
 */

export const TREND_WINDOW_DAYS = 30;

/** How much a rate must move, proportionally, before the label changes. */
export const TREND_MARGIN = 0.2;

/**
 * And how much it must move in absolute terms.
 *
 * Without this, one occurrence moves any pattern with four or fewer — which is
 * most of them, and precisely the noise the margin was supposed to absorb.
 */
export const TREND_FLOOR = 2;

/** Below this many solves in the recent window, no trend is claimed. */
export const NEEDS_ACTIVITY = 3;

/**
 * The values and the labels live in `lib/mistakes/trends.ts` — the panel needs
 * them and `components/` may not reach into `server/` (F0.1). Re-exported here
 * so this module reads as one thing, but declared once (**D21**).
 */
import { type MistakeTrend } from '@/lib/mistakes/trends';

export { MISTAKE_TRENDS, TREND_LABELS, type MistakeTrend } from '@/lib/mistakes/trends';

export type TrendInput = {
  /** Occurrences in the last `TREND_WINDOW_DAYS`. */
  recent: number;
  /** Occurrences in the window before that, of the same length. */
  earlier: number;
  /** Sessions the user completed in the recent window. */
  recentSolves: number;
};

export function classifyTrend(input: TrendInput): MistakeTrend {
  /*
   * Not enough recent work to say anything. A user who took a fortnight off has
   * not improved; they have been away, and telling them otherwise is the kind
   * of flattery that makes the rest of the panel untrustworthy.
   */
  if (input.recentSolves < NEEDS_ACTIVITY) return 'flat';

  /*
   * Nothing before to compare against. A pattern first seen this month is not
   * worsening — there is no earlier rate for it to have risen from, and any
   * ratio against zero is a division nobody should trust.
   */
  if (input.earlier === 0) return 'flat';

  const delta = input.recent - input.earlier;

  if (input.recent < input.earlier * (1 - TREND_MARGIN) && -delta >= TREND_FLOOR) {
    return 'improving';
  }
  if (input.recent > input.earlier * (1 + TREND_MARGIN) && delta >= TREND_FLOOR) {
    return 'worsening';
  }

  return 'flat';
}

/**
 * How much a pattern should weigh, from its recurrence and its direction.
 *
 * Feeds F2.1's `MISTAKE_SEVERITY`, which has had a slot for it since that
 * ticket. Bounded to 0–1 so the risk weights stay comparable.
 *
 * Worsening counts for more than improving at the same count, because the
 * question the risk score answers is "how likely is this to go wrong again",
 * and a mistake you are still making is a better predictor than one you made
 * often and have since fixed.
 */
export function severityOf(input: { occurrences: number; trend: MistakeTrend }): number {
  // Five occurrences is where recurrence stops telling you more.
  const base = Math.min(1, input.occurrences / 5);

  const direction = input.trend === 'worsening' ? 1.2 : input.trend === 'improving' ? 0.6 : 1;

  return Math.min(1, base * direction);
}
