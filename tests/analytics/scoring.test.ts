/**
 * F1.6 · the weak-topic score.
 *
 * Two acceptance criteria live here: the formula is documented with named
 * weights, and every row surfaces a human-readable reason. Both are checkable,
 * and the second is the one that would rot quietly — a row can gain a score
 * without gaining an explanation, and nobody notices until a user asks why.
 *
 * The tests below isolate each component at its maximum, so a weight that is
 * changed without updating the arithmetic fails here rather than shifting every
 * topic on the page by a few points.
 */
import { describe, expect, it } from 'vitest';
import {
  MINIMUM_SESSIONS,
  SLOWNESS_CEILING_RATIO,
  STALENESS_CEILING_DAYS,
  type TopicSummary,
  UNKNOWN_CONFIDENCE,
  WEAK_TOPIC_WEIGHTS,
  rankWeakTopics,
  scoreTopic,
} from '@/server/services/analytics/scoring';

const TODAY = '2026-03-30';

/**
 * A topic with nothing wrong with it: practised today, never stuck, confident,
 * and inside its estimate. Every test below starts here and breaks one thing.
 */
const healthy = (overrides: Partial<TopicSummary> = {}): TopicSummary => ({
  topic: 'arrays',
  solvedCount: 10,
  stuckCount: 0,
  sessionCount: 10,
  activeSeconds: 6_000,
  estimatedSeconds: 6_000,
  confidenceSum: 30, // ten sessions at 'high'
  confidenceCount: 10,
  lastPractisedDate: TODAY,
  ...overrides,
});

describe('F1.6 · the weights', () => {
  it('sum to exactly 1, which is what makes the score a 0..100 scale', () => {
    const total = Object.values(WEAK_TOPIC_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('are named constants, not literals buried in the arithmetic', () => {
    // The criterion, asserted structurally: every weight is reachable by name.
    expect(Object.keys(WEAK_TOPIC_WEIGHTS).sort()).toEqual([
      'FAILURE_RATE',
      'LOW_CONFIDENCE',
      'SLOWNESS',
      'STALENESS',
    ]);
  });
});

describe('F1.6 · each component at its maximum', () => {
  it('a healthy topic scores near zero', () => {
    // The floor is not 0: an unanswered confidence question would lift it, and
    // this topic answered every one.
    expect(scoreTopic(healthy(), TODAY).score).toBe(0);
  });

  it('staleness alone contributes exactly its weight', () => {
    const stale = healthy({ lastPractisedDate: '2026-03-01' }); // 29 days, past the ceiling
    const result = scoreTopic(stale, TODAY);

    expect(result.components.staleness).toBe(1);
    expect(result.score).toBe(Math.round(100 * WEAK_TOPIC_WEIGHTS.STALENESS));
  });

  it('failure rate alone contributes exactly its weight', () => {
    const failing = healthy({ solvedCount: 0, stuckCount: 10 });
    const result = scoreTopic(failing, TODAY);

    expect(result.components.failureRate).toBe(1);
    expect(result.score).toBe(Math.round(100 * WEAK_TOPIC_WEIGHTS.FAILURE_RATE));
  });

  it('low confidence alone contributes exactly its weight', () => {
    const unsure = healthy({ confidenceSum: 10, confidenceCount: 10 }); // all 'low'
    const result = scoreTopic(unsure, TODAY);

    expect(result.components.lowConfidence).toBe(1);
    expect(result.score).toBe(Math.round(100 * WEAK_TOPIC_WEIGHTS.LOW_CONFIDENCE));
  });

  it('slowness alone contributes exactly its weight', () => {
    const slow = healthy({ activeSeconds: 6_000 * SLOWNESS_CEILING_RATIO });
    const result = scoreTopic(slow, TODAY);

    expect(result.components.slowness).toBe(1);
    expect(result.score).toBe(Math.round(100 * WEAK_TOPIC_WEIGHTS.SLOWNESS));
  });

  it('all four at once is 100', () => {
    const worst = scoreTopic(
      healthy({
        lastPractisedDate: '2026-01-01',
        solvedCount: 0,
        stuckCount: 10,
        confidenceSum: 10,
        confidenceCount: 10,
        activeSeconds: 60_000,
      }),
      TODAY,
    );

    expect(worst.score).toBe(100);
  });
});

describe('F1.6 · the ceilings', () => {
  it('staleness stops growing past the ceiling', () => {
    const atCeiling = scoreTopic(healthy({ lastPractisedDate: '2026-03-09' }), TODAY);
    const wayPast = scoreTopic(healthy({ lastPractisedDate: '2025-03-09' }), TODAY);

    /*
     * A year untouched and three weeks untouched give the same advice, and
     * letting the older one grow without bound would let staleness drown out
     * every other signal in the ranking.
     */
    expect(atCeiling.components.staleness).toBe(1);
    expect(wayPast.components.staleness).toBe(1);
    expect(wayPast.score).toBe(atCeiling.score);
  });

  it('the ceiling is where the constant says it is', () => {
    const justUnder = scoreTopic(
      healthy({ lastPractisedDate: daysBefore(TODAY, STALENESS_CEILING_DAYS - 1) }),
      TODAY,
    );
    expect(justUnder.components.staleness).toBeLessThan(1);
    expect(justUnder.components.staleness).toBeGreaterThan(0.9);
  });

  it('slowness stops growing past double the estimate', () => {
    const double = scoreTopic(healthy({ activeSeconds: 12_000 }), TODAY);
    const quadruple = scoreTopic(healthy({ activeSeconds: 24_000 }), TODAY);

    expect(double.components.slowness).toBe(1);
    expect(quadruple.components.slowness).toBe(1);
  });

  it('finishing faster than the estimate is not negative', () => {
    const fast = scoreTopic(healthy({ activeSeconds: 1_000 }), TODAY);
    expect(fast.components.slowness).toBe(0);
  });
});

describe('F1.6 · an unanswered confidence question', () => {
  it('IS NEUTRAL — it neither rewards nor punishes skipping the reflection', () => {
    /*
     * F1.5 goes out of its way to make the reflection skippable. Scoring silence
     * as low confidence would punish exactly the users who took that at face
     * value; scoring it as high would reward them. Neither is supported by the
     * data, so it sits in the middle.
     */
    const silent = scoreTopic(healthy({ confidenceSum: 0, confidenceCount: 0 }), TODAY);
    expect(silent.components.lowConfidence).toBe(UNKNOWN_CONFIDENCE);
    expect(silent.averageConfidence).toBeNull();
  });

  it('sits between the two answers it could have been', () => {
    // The positive control: neutral means nothing unless the ends differ from it.
    const low = scoreTopic(healthy({ confidenceSum: 10, confidenceCount: 10 }), TODAY);
    const silent = scoreTopic(healthy({ confidenceSum: 0, confidenceCount: 0 }), TODAY);
    const high = scoreTopic(healthy(), TODAY);

    expect(high.score).toBeLessThan(silent.score);
    expect(silent.score).toBeLessThan(low.score);
  });
});

describe('F1.6 · every row explains itself', () => {
  it('NEVER RETURNS A SCORE WITHOUT A REASON', () => {
    // The acceptance criterion. A number with no account of itself is a number
    // the user cannot argue with, and will therefore ignore.
    const summaries = [
      healthy(),
      healthy({
        topic: 'graphs',
        lastPractisedDate: '2026-03-12',
        stuckCount: 4,
        solvedCount: 6,
      }),
      healthy({ topic: 'dp', confidenceSum: 12, confidenceCount: 10 }),
      healthy({ topic: 'trees', activeSeconds: 11_000 }),
    ];

    for (const weak of rankWeakTopics(summaries, TODAY, 10)) {
      expect(weak.reasons.length).toBeGreaterThan(0);
      for (const reason of weak.reasons) expect(reason.trim()).not.toBe('');
    }
  });

  it('names the numbers the reason came from', () => {
    const weak = scoreTopic(
      healthy({
        topic: 'graphs',
        lastPractisedDate: '2026-03-12',
        solvedCount: 6,
        stuckCount: 4,
      }),
      TODAY,
    );

    expect(weak.reasons.join(' ')).toContain('18 days');
    expect(weak.reasons.join(' ')).toContain('4 of 10 attempts');
  });

  it('puts the biggest contributor first', () => {
    /*
     * Ordering is the difference between a reason and a list. The user should
     * read the thing that actually drove the score, not the first rule that
     * happened to match.
     */
    const weak = scoreTopic(
      healthy({
        topic: 'graphs',
        lastPractisedDate: '2026-01-01', // staleness maxed: weight 0.35
        solvedCount: 9,
        stuckCount: 1, // failure rate 0.1: weight 0.30 × 0.1
      }),
      TODAY,
    );

    expect(weak.reasons[0]).toContain('not practised');
  });

  it('says something even when nothing crossed a threshold', () => {
    // A topic can score modestly from four mild signals and no single one
    // clearing its own bar. It still has to account for itself.
    const mild = scoreTopic(
      healthy({ topic: 'greedy', lastPractisedDate: daysBefore(TODAY, 3) }),
      TODAY,
    );

    expect(mild.reasons.length).toBeGreaterThan(0);
    expect(mild.reasons[0]).toContain('3 days');
  });
});

describe('F1.6 · ranking', () => {
  it('ignores topics with too little history to judge', () => {
    /*
     * One bad session is not a weakness. A ratio over a denominator of one is
     * either 0 or 1, which would put a topic tried once at the top of the list,
     * above one the user has genuinely struggled with for months.
     */
    const barely = healthy({
      topic: 'bit-manipulation',
      solvedCount: 0,
      stuckCount: MINIMUM_SESSIONS - 1,
      sessionCount: MINIMUM_SESSIONS - 1,
      lastPractisedDate: '2026-01-01',
    });

    expect(rankWeakTopics([barely], TODAY)).toEqual([]);
  });

  it('orders by score, and breaks ties by name so the list does not reshuffle', () => {
    const first = healthy({ topic: 'zebra', lastPractisedDate: '2026-01-01' });
    const second = healthy({ topic: 'alpha', lastPractisedDate: '2026-01-01' });

    const ranked = rankWeakTopics([first, second], TODAY);
    expect(ranked.map((topic) => topic.topic)).toEqual(['alpha', 'zebra']);
  });

  it('is a pure function of its inputs', () => {
    const summaries = [healthy(), healthy({ topic: 'graphs', stuckCount: 5, solvedCount: 5 })];

    expect(rankWeakTopics(summaries, TODAY)).toEqual(rankWeakTopics(summaries, TODAY));
  });

  it('returns at most the limit asked for', () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      healthy({ topic: `topic-${index}`, lastPractisedDate: '2026-01-01' }),
    );

    expect(rankWeakTopics(many, TODAY)).toHaveLength(5);
    expect(rankWeakTopics(many, TODAY, 3)).toHaveLength(3);
  });
});

/** `YYYY-MM-DD`, `days` before the given date. */
function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
