/**
 * C4 · which of the user's recurring mistakes belongs on THIS problem's screen.
 *
 * Pure, so the rule is tested without a database. The page feeds it the rows
 * from `readPatterns` (read-only) and the problem's topic tags, both already
 * fetched; nothing here reads or writes anything.
 *
 * ## The match is the pre-solve warning's, without the warning's write
 *
 * `warningFor` (F3.5) matches a user's patterns to a problem by topic, and it
 * inserts into `mistake_warnings_shown` every time it runs. The v2 plan forbids
 * that write, so the matching rule is restated here: a pattern belongs when its
 * topic is one of the problem's topics. A pattern with no topic matches no
 * problem, exactly as `inArray(topic, …)` never matches NULL there.
 *
 * ## "Recurring" means more than once
 *
 * `rebuildPatterns` stores a pattern from its first occurrence. A chip that
 * says "recurring for you" about something that happened once would be false,
 * so a single occurrence never shows.
 */
import type { MistakeTrend } from '@/lib/mistakes/trends';

/** Fewer occurrences than this is not a pattern yet. */
export const RECURRING_MIN_OCCURRENCES = 2;

export type RecurringPatternInput = {
  category: string;
  topic: string | null;
  occurrences: number;
  trend: MistakeTrend;
};

export type RecurringChipData = {
  category: string;
  /** Always one of the problem's own topics. */
  topic: string;
  occurrences: number;
  trend: MistakeTrend;
};

/**
 * The worst matching pattern, or null.
 *
 * Ties keep input order: `readPatterns` already sorts worst first, then by
 * category, so the chip shows the same pattern the mistakes page lists first.
 */
export function matchRecurring(
  patterns: readonly RecurringPatternInput[],
  topics: readonly string[],
): RecurringChipData | null {
  const wanted = new Set(topics);
  let worst: RecurringChipData | null = null;

  for (const pattern of patterns) {
    if (pattern.topic === null || !wanted.has(pattern.topic)) continue;
    if (pattern.occurrences < RECURRING_MIN_OCCURRENCES) continue;
    if (worst && pattern.occurrences <= worst.occurrences) continue;

    worst = {
      category: pattern.category,
      topic: pattern.topic,
      occurrences: pattern.occurrences,
      trend: pattern.trend,
    };
  }

  return worst;
}
