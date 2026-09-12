/**
 * The weekly focus plan, and the reason beside every line of it.
 *
 * ## The explainability rule is the whole design
 *
 * The ticket puts it plainly: *"If you cannot state the reason in one sentence,
 * the rule is wrong."* So a recommendation is not a number with a label bolted
 * on — the reason is produced by the same function that produced the
 * recommendation, from the same inputs, and there is no path that emits one
 * without the other. A test asserts every recommendation has one.
 *
 * That is not decoration. A plan a user cannot check is a plan they follow on
 * faith, and the first week it is wrong they stop following it at all.
 *
 * ## No AI, and nothing that reads a clock
 *
 * Rule-based throughout. `today` is a parameter (D18).
 */
import type { MistakeTrend } from './trend';
import { severityOf } from './trend';

/** How many problems a week the plan will ever ask for. */
export const WEEKLY_TARGET = 5;

/** How many distinct focus areas. Beyond this a plan stops being a focus. */
export const MAX_FOCUS_AREAS = 3;

export type PatternInput = {
  category: string;
  topic: string | null;
  occurrences: number;
  confirmedStuckCount: number;
  trend: MistakeTrend;
  lastSeenOn: Date;
};

export type Recommendation = {
  topic: string | null;
  category: string;
  /** How many problems this week. */
  count: number;
  /** One sentence. Never absent — see the file header. */
  reason: string;
};

export type WeeklyPlan = {
  recommendations: Recommendation[];
  /** Said out loud when there is nothing to recommend, rather than an empty list. */
  note: string | null;
};

/** Readable form of a category slug: `off_by_one` → `off by one`. */
function readable(category: string): string {
  return category.replace(/_/g, ' ');
}

/**
 * How stale a pattern is, 0–1, where 1 is "today".
 *
 * A mistake from four months ago is worth less attention than the same mistake
 * from last week, however many times it happened. Without this the plan would
 * keep recommending something the user has already stopped doing.
 */
function recency(lastSeenOn: Date, today: Date): number {
  const days = (today.getTime() - lastSeenOn.getTime()) / (24 * 60 * 60 * 1000);
  if (days <= 7) return 1;
  if (days >= 90) return 0;
  return 1 - (days - 7) / 83;
}

/**
 * Build the week's plan.
 *
 * Deterministic: the sort has an explicit tiebreak chain, so the same patterns
 * always produce the same plan in the same order. A plan that reshuffles
 * between page loads is one nobody trusts.
 */
export function buildWeeklyPlan(patterns: readonly PatternInput[], today: Date): WeeklyPlan {
  if (patterns.length === 0) {
    return {
      recommendations: [],
      note: 'Nothing has come up often enough to focus on yet. Keep solving and reflecting.',
    };
  }

  const scored = patterns
    .map((pattern) => ({
      pattern,
      score: severityOf(pattern) * recency(pattern.lastSeenOn, today),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.pattern.occurrences - left.pattern.occurrences ||
        left.pattern.category.localeCompare(right.pattern.category),
    )
    .slice(0, MAX_FOCUS_AREAS);

  if (scored.length === 0) {
    return {
      recommendations: [],
      note: 'Your recent mistakes have not repeated. Nothing to single out this week.',
    };
  }

  /*
   * Share the week out in proportion to score, with everybody getting at least
   * one. A plan that assigns four problems to the top area and zero to the
   * others is a plan with one item pretending to be three.
   */
  const total = scored.reduce((sum, entry) => sum + entry.score, 0);
  let remaining = WEEKLY_TARGET;

  const recommendations: Recommendation[] = scored.map((entry, index) => {
    const isLast = index === scored.length - 1;
    const share = isLast
      ? remaining
      : Math.max(
          1,
          Math.min(
            remaining - (scored.length - index - 1),
            Math.round((entry.score / total) * WEEKLY_TARGET),
          ),
        );

    remaining -= share;

    return {
      topic: entry.pattern.topic,
      category: entry.pattern.category,
      count: share,
      reason: reasonFor(entry.pattern, today),
    };
  });

  return { recommendations, note: null };
}

/**
 * One sentence saying why this is on the list.
 *
 * Names the thing that actually drove it — recurrence, direction, or a recent
 * cluster of struggle — rather than a generic "this is a weak area". A reason
 * that would fit any recommendation is not a reason.
 */
export function reasonFor(pattern: PatternInput, today: Date): string {
  const where = pattern.topic ? ` in ${pattern.topic}` : '';
  const what = readable(pattern.category);
  const days = Math.round(
    (today.getTime() - pattern.lastSeenOn.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (pattern.trend === 'worsening') {
    return `${what}${where} has come up ${pattern.occurrences} times and more often lately.`;
  }

  if (pattern.confirmedStuckCount >= 3) {
    return `${what}${where} has come up ${pattern.occurrences} times, and you confirmed ${pattern.confirmedStuckCount} stuck points in that topic.`;
  }

  if (days <= 7) {
    return `${what}${where} has come up ${pattern.occurrences} times, most recently this week.`;
  }

  return `${what}${where} has come up ${pattern.occurrences} times.`;
}
