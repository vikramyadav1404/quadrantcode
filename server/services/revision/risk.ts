/**
 * Which of today's due problems to put first.
 *
 * Six things that already happened, normalised, weighted and added up. Same
 * inputs, same number — and the result carries the factors that produced it, so
 * a queue can say "graphs, 18 days overdue and you were unsure last time"
 * instead of "graphs, 74".
 *
 * **It ranks; it does not foretell.** The score says which problem has the most
 * evidence stacked against it right now, drawn entirely from the user's own
 * record. Nothing here models what will happen — the same discipline F1.6's
 * weak-topic score keeps, and the same reason: a number nobody can check is a
 * number nobody acts on.
 *
 * The prose version lives in `docs/scoring.md`.
 */
import type { MistakeCategory } from '@/lib/reflection/taxonomy';
import type { Confidence } from './ladder';

/**
 * ## The formula
 *
 * ```
 * risk = 100 × ( OVERDUE          × overdue
 *              + CONFIDENCE       × lowConfidence
 *              + FAILED_ATTEMPTS  × failedAttempts
 *              + MISTAKE_SEVERITY × mistakeSeverity
 *              + TOPIC_WEAKNESS   × topicWeakness
 *              + HINTS            × hints )
 * ```
 *
 * The weights sum to 1, so each is exactly the share of the score its component
 * can contribute, and the result is a 0–100 scale rather than an arbitrary
 * total.
 *
 * **Why this order.**
 *
 * `OVERDUE` leads because it is the only component that grows on its own, and
 * because being overdue is the one thing the queue exists to act on. Everything
 * else describes how a solve went; this describes how long ago it was.
 *
 * `CONFIDENCE` and `FAILED_ATTEMPTS` are joint second: one is the user's own
 * verdict on whether it stuck, the other is the record of how hard it was to get
 * there. They are the strongest evidence about the problem itself.
 *
 * `MISTAKE_SEVERITY` is below them because it is derived from a reflection the
 * user could skip, so it is present for some problems and absent for others.
 * `TOPIC_WEAKNESS` is lower still because it is a fact about the SUBJECT rather
 * than this problem — useful for breaking ties, wrong as a main driver.
 *
 * `HINTS` is last and smallest, because nothing in the target build produces a
 * hint (F3.4 is cut). It is weighted honestly for the day something does, rather
 * than left out and bolted on later to a scheduler people already trust.
 */
export const RISK_WEIGHTS = {
  OVERDUE: 0.3,
  CONFIDENCE: 0.2,
  FAILED_ATTEMPTS: 0.2,
  MISTAKE_SEVERITY: 0.15,
  TOPIC_WEAKNESS: 0.1,
  HINTS: 0.05,
} as const;

/** Days overdue at which that component is full. Two weeks. */
export const OVERDUE_CEILING_DAYS = 14;

/** Failed attempts at which that component is full. */
export const FAILED_ATTEMPTS_CEILING = 3;

/** Hints at which that component is full. */
export const HINTS_CEILING = 3;

/**
 * What an unanswered confidence question contributes: nothing either way.
 *
 * The same decision F1.6 records, for the same reason — F1.5 makes the
 * reflection skippable, so silence must not be read as either an admission or a
 * boast.
 */
export const UNKNOWN_CONFIDENCE = 0.5;

const CONFIDENCE_VALUES: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

/**
 * How much a mistake says about whether the problem will need work again.
 *
 * **Structural** — the approach itself was wrong. The user did not have the
 * shape of the solution, and that is the thing most likely to be missing next
 * time.
 *
 * **Conceptual** — the approach was right and a case was missed. Real, and
 * narrower: the idea survived, one branch of it did not.
 *
 * **Mechanical** — it ran wrong. A typo or a timeout says something about the
 * sitting rather than about whether the concept is held.
 *
 * `none` is 0 and is not the same as no reflection at all: one is "I solved it
 * cleanly", the other is a question never answered (F1.5, D21).
 */
export const MISTAKE_SEVERITY: Record<MistakeCategory, number> = {
  wrong_logic: 1,
  wrong_data_structure: 1,

  missed_edge_case: 0.6,
  boundary_condition: 0.6,
  off_by_one: 0.6,
  recursion_base_case: 0.6,

  syntax_runtime: 0.3,
  tle: 0.3,

  none: 0,
};

export type RiskInput = {
  daysOverdue: number;
  confidence: Confidence | null;
  hintsUsed: number;
  failedAttempts: number;
  /** Every mistake recorded against this problem, across attempts. */
  mistakes: readonly MistakeCategory[];
  /** F1.6's weak-topic score for this problem's topics, 0–100. Null when untagged. */
  topicWeakness: number | null;
};

export type RiskFactor = {
  key: 'overdue' | 'confidence' | 'failedAttempts' | 'mistakes' | 'topic' | 'hints';
  /** Plain language, naming the number it came from. */
  label: string;
  /** Points of the final score this factor contributed. */
  contribution: number;
};

export type RiskScore = {
  /** 0–100, rounded. */
  score: number;
  /** Strongest first, and only the ones that actually contributed. */
  factors: RiskFactor[];
};

/**
 * Score one due problem.
 *
 * Returns the factors alongside the number because the queue has to explain its
 * own order. A list sorted by an unexplained score is a list the user either
 * trusts blindly or ignores, and neither is the point.
 */
export function scoreRisk(input: RiskInput): RiskScore {
  const overdue = clamp01(input.daysOverdue / OVERDUE_CEILING_DAYS);

  const lowConfidence =
    input.confidence === null
      ? UNKNOWN_CONFIDENCE
      : clamp01((CONFIDENCE_VALUES.high - CONFIDENCE_VALUES[input.confidence]) / 2);

  const failedAttempts = clamp01(input.failedAttempts / FAILED_ATTEMPTS_CEILING);
  const hints = clamp01(input.hintsUsed / HINTS_CEILING);

  /*
   * The WORST mistake, not the sum of them.
   *
   * A wrong data structure plus a typo is a wrong data structure — adding the
   * typo's severity would rank it above a second problem with the same
   * structural error and no typo, which says nothing useful about either.
   */
  const mistakeSeverity = input.mistakes.reduce(
    (worst, mistake) => Math.max(worst, MISTAKE_SEVERITY[mistake]),
    0,
  );

  const topicWeakness = clamp01((input.topicWeakness ?? 0) / 100);

  const parts: { key: RiskFactor['key']; weight: number; value: number; label: string }[] = [
    {
      key: 'overdue',
      weight: RISK_WEIGHTS.OVERDUE,
      value: overdue,
      label:
        input.daysOverdue > 0
          ? `${input.daysOverdue} ${input.daysOverdue === 1 ? 'day' : 'days'} overdue`
          : 'due today',
    },
    {
      key: 'confidence',
      weight: RISK_WEIGHTS.CONFIDENCE,
      value: lowConfidence,
      label:
        input.confidence === null
          ? 'you did not say how confident you felt'
          : `you felt ${input.confidence} about it last time`,
    },
    {
      key: 'failedAttempts',
      weight: RISK_WEIGHTS.FAILED_ATTEMPTS,
      value: failedAttempts,
      label: `${input.failedAttempts} earlier ${
        input.failedAttempts === 1 ? 'attempt' : 'attempts'
      } ended stuck`,
    },
    {
      key: 'mistakes',
      weight: RISK_WEIGHTS.MISTAKE_SEVERITY,
      value: mistakeSeverity,
      label: describeMistakes(input.mistakes),
    },
    {
      key: 'topic',
      weight: RISK_WEIGHTS.TOPIC_WEAKNESS,
      value: topicWeakness,
      label: 'its topic is one of your weaker ones',
    },
    {
      key: 'hints',
      weight: RISK_WEIGHTS.HINTS,
      value: hints,
      label: `${input.hintsUsed} ${input.hintsUsed === 1 ? 'hint' : 'hints'} taken`,
    },
  ];

  const score = Math.round(
    100 * parts.reduce((total, part) => total + part.weight * part.value, 0),
  );

  const factors = parts
    .filter((part) => part.value > 0)
    .map((part) => ({
      key: part.key,
      label: part.label,
      contribution: Math.round(100 * part.weight * part.value),
    }))
    .sort((left, right) => right.contribution - left.contribution);

  return { score, factors };
}

/** The worst mistake, named. Empty when nothing was recorded. */
function describeMistakes(mistakes: readonly MistakeCategory[]): string {
  if (mistakes.length === 0) return 'no mistakes recorded';

  const worst = [...mistakes].sort(
    (left, right) => MISTAKE_SEVERITY[right] - MISTAKE_SEVERITY[left],
  )[0]!;

  return `you last recorded ${worst.replace(/_/g, ' ')}`;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
