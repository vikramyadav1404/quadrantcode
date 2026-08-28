/**
 * The weak-topic score.
 *
 * **This is arithmetic, not a guess about the future.** It reads four things the
 * user has already done and adds them up with fixed weights. The same inputs
 * always give the same number, anyone can check it by hand, and every row on the
 * page carries the sentence that explains its own score.
 *
 * That constraint is the ticket's, and it is worth restating as a design rule:
 * a number a user cannot argue with is a number they will ignore. "Graphs, 71"
 * means nothing; "graphs — not practised in 18 days, and 1 in 3 attempts ended
 * stuck" is something they can agree or disagree with.
 *
 * The prose version of everything below lives in `docs/scoring.md`.
 */
import type { LocalDate } from '@/server/services/streak';

/**
 * ## The formula
 *
 * ```
 * score = 100 × ( STALENESS      × staleness
 *               + FAILURE_RATE   × failureRate
 *               + LOW_CONFIDENCE × lowConfidence
 *               + SLOWNESS       × slowness )
 * ```
 *
 * Each component is normalised to 0..1 first, so a weight is exactly the share
 * of the score that component can contribute. They sum to 1, which is what makes
 * the result a 0..100 scale rather than an arbitrary total.
 *
 * **Why this order of importance.**
 *
 * `STALENESS` leads because it is the only component that grows without the user
 * doing anything, and it is the one a weekly plan can act on: revisiting a topic
 * is always available advice. `FAILURE_RATE` is next because a stuck outcome is
 * the user's own verdict that they could not finish, which is stronger evidence
 * than either signal below it.
 *
 * `LOW_CONFIDENCE` is weighted below both because it is self-reported and
 * optional, so it is the noisiest input here. `SLOWNESS` is last because the
 * estimate it compares against is a property of the PROBLEM, not of the user —
 * a generous or stingy estimate moves this component for reasons that have
 * nothing to do with how the solve went.
 */
export const WEAK_TOPIC_WEIGHTS = {
  STALENESS: 0.35,
  FAILURE_RATE: 0.3,
  LOW_CONFIDENCE: 0.2,
  SLOWNESS: 0.15,
} as const;

/**
 * Days without practice at which staleness is considered total.
 *
 * Three weeks. Past this the component is 1 and stops growing, so a topic
 * untouched for a year does not drown out every other signal — by then the
 * advice is the same as it was at three weeks, and the rest of the score still
 * has to decide the order.
 */
export const STALENESS_CEILING_DAYS = 21;

/**
 * Taking this multiple of the estimate counts as fully slow.
 *
 * Double. Under it the component scales linearly; at or above it the component
 * is 1.
 */
export const SLOWNESS_CEILING_RATIO = 2;

/**
 * A topic needs this many finished sessions before it can be ranked.
 *
 * One bad session is not a weakness, and a ratio over a denominator of one is
 * either 0 or 1 — which would put a topic tried once and abandoned at the top of
 * the list, above one the user has genuinely struggled with for months.
 */
export const MINIMUM_SESSIONS = 3;

/**
 * What an unanswered confidence question contributes.
 *
 * Neutral, deliberately. Scoring silence as low confidence would punish users
 * who skip the reflection — which F1.5 goes out of its way to make skippable —
 * and scoring it as high would reward them. Neither is a claim the data
 * supports, so it contributes exactly nothing either way.
 */
export const UNKNOWN_CONFIDENCE = 0.5;

/** Confidence as a number, so it can be averaged. */
export const CONFIDENCE_VALUES = { low: 1, medium: 2, high: 3 } as const;

/** One topic's totals over the scoring window, summed from the daily rollup. */
export type TopicSummary = {
  topic: string;
  solvedCount: number;
  stuckCount: number;
  sessionCount: number;
  activeSeconds: number;
  estimatedSeconds: number;
  confidenceSum: number;
  confidenceCount: number;
  lastPractisedDate: LocalDate | null;
};

/** The four components, kept on the result so a row can explain itself. */
export type ScoreComponents = {
  staleness: number;
  failureRate: number;
  lowConfidence: number;
  slowness: number;
};

export type WeakTopic = {
  topic: string;
  /** 0..100, rounded. Higher means more in need of attention. */
  score: number;
  components: ScoreComponents;
  /** Plain sentences, strongest contributor first. Never empty. */
  reasons: string[];
  daysSincePractice: number;
  failureRate: number;
  averageConfidence: number | null;
};

/**
 * Score one topic. Pure: `today` is a parameter, like every other date in this
 * codebase (D18).
 */
export function scoreTopic(summary: TopicSummary, today: LocalDate): WeakTopic {
  const daysSincePractice = summary.lastPractisedDate
    ? daysBetweenDates(summary.lastPractisedDate, today)
    : STALENESS_CEILING_DAYS;

  const staleness = clamp01(daysSincePractice / STALENESS_CEILING_DAYS);

  const failureRate =
    summary.sessionCount > 0 ? clamp01(summary.stuckCount / summary.sessionCount) : 0;

  const averageConfidence =
    summary.confidenceCount > 0 ? summary.confidenceSum / summary.confidenceCount : null;

  /*
   * 1 → low, 0 → high. The divisor is 2 because the scale runs 1..3, so the
   * distance between the extremes is 2 and this maps onto 0..1 exactly.
   */
  const lowConfidence =
    averageConfidence === null
      ? UNKNOWN_CONFIDENCE
      : clamp01((CONFIDENCE_VALUES.high - averageConfidence) / 2);

  const ratio =
    summary.estimatedSeconds > 0 ? summary.activeSeconds / summary.estimatedSeconds : 1;
  const slowness = clamp01((ratio - 1) / (SLOWNESS_CEILING_RATIO - 1));

  const components: ScoreComponents = { staleness, failureRate, lowConfidence, slowness };

  const score = Math.round(
    100 *
      (WEAK_TOPIC_WEIGHTS.STALENESS * staleness +
        WEAK_TOPIC_WEIGHTS.FAILURE_RATE * failureRate +
        WEAK_TOPIC_WEIGHTS.LOW_CONFIDENCE * lowConfidence +
        WEAK_TOPIC_WEIGHTS.SLOWNESS * slowness),
  );

  return {
    topic: summary.topic,
    score,
    components,
    reasons: explain({ components, daysSincePractice, summary, ratio, averageConfidence }),
    daysSincePractice,
    failureRate,
    averageConfidence,
  };
}

/**
 * Rank the topics that have enough history to be ranked.
 *
 * Ties break on topic name so the order is stable across reloads — a list that
 * reshuffles on refresh reads as noise, whatever the numbers say.
 */
export function rankWeakTopics(
  summaries: readonly TopicSummary[],
  today: LocalDate,
  limit = 5,
): WeakTopic[] {
  return summaries
    .filter((summary) => summary.sessionCount >= MINIMUM_SESSIONS)
    .map((summary) => scoreTopic(summary, today))
    .sort((left, right) => right.score - left.score || left.topic.localeCompare(right.topic))
    .slice(0, limit);
}

/**
 * Turn the components into sentences, strongest first.
 *
 * Every reason names the number it came from. "You are weak at graphs" is an
 * assertion; "not practised in 18 days" is a fact the user can check against
 * their own memory — and disagree with, which is the point.
 *
 * A row always gets at least one sentence: a topic that scored high for four
 * mild reasons rather than one strong one still has to say something.
 */
function explain(input: {
  components: ScoreComponents;
  daysSincePractice: number;
  summary: TopicSummary;
  ratio: number;
  averageConfidence: number | null;
}): string[] {
  const { components, daysSincePractice, summary, ratio, averageConfidence } = input;

  const candidates: { weightShare: number; text: string }[] = [];

  if (daysSincePractice >= 7) {
    candidates.push({
      weightShare: WEAK_TOPIC_WEIGHTS.STALENESS * components.staleness,
      text: `not practised in ${daysSincePractice} days`,
    });
  }

  if (summary.stuckCount > 0) {
    candidates.push({
      weightShare: WEAK_TOPIC_WEIGHTS.FAILURE_RATE * components.failureRate,
      text: `${summary.stuckCount} of ${summary.sessionCount} attempts ended stuck`,
    });
  }

  if (averageConfidence !== null && averageConfidence < CONFIDENCE_VALUES.medium) {
    candidates.push({
      weightShare: WEAK_TOPIC_WEIGHTS.LOW_CONFIDENCE * components.lowConfidence,
      text: 'you usually rate your confidence low afterwards',
    });
  }

  if (ratio >= 1.25 && summary.estimatedSeconds > 0) {
    candidates.push({
      weightShare: WEAK_TOPIC_WEIGHTS.SLOWNESS * components.slowness,
      text: `taking ${ratio.toFixed(1)}× the estimated time`,
    });
  }

  const reasons = candidates
    .sort((left, right) => right.weightShare - left.weightShare)
    .map((candidate) => candidate.text);

  if (reasons.length > 0) return reasons;

  /*
   * Nothing crossed a threshold on its own. The score is still whatever it is,
   * so the row says what actually drove it rather than showing a number with no
   * account of itself.
   */
  return [
    daysSincePractice > 0
      ? `last practised ${daysSincePractice} days ago, across ${summary.sessionCount} attempts`
      : `${summary.sessionCount} attempts so far`,
  ];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Whole days between two `YYYY-MM-DD` dates. Both are already local dates. */
function daysBetweenDates(from: LocalDate, to: LocalDate): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}
