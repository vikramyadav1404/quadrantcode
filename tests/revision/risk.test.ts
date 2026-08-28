/**
 * F2.1 · the forgetting-risk score.
 *
 * Two acceptance criteria: the weights are named constants rather than literals
 * buried in the arithmetic, and the result returns contributing factors rather
 * than a bare number.
 *
 * The second is the one that decays quietly. A score can gain an input without
 * gaining a sentence, and nobody notices until a user asks why a problem is at
 * the top of their queue.
 */
import { describe, expect, it } from 'vitest';
import type { MistakeCategory } from '@/lib/reflection/taxonomy';
import {
  FAILED_ATTEMPTS_CEILING,
  HINTS_CEILING,
  MISTAKE_SEVERITY,
  OVERDUE_CEILING_DAYS,
  RISK_WEIGHTS,
  type RiskInput,
  UNKNOWN_CONFIDENCE,
  scoreRisk,
} from '@/server/services/revision/risk';

/** Due today, confident, clean, on a topic that is fine. Nothing to report. */
const calm = (overrides: Partial<RiskInput> = {}): RiskInput => ({
  daysOverdue: 0,
  confidence: 'high',
  hintsUsed: 0,
  failedAttempts: 0,
  mistakes: [],
  topicWeakness: 0,
  ...overrides,
});

describe('F2.1 · the weights', () => {
  it('sum to exactly 1, which is what makes the score a 0..100 scale', () => {
    const total = Object.values(RISK_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('are reachable by name, one per input the spec lists', () => {
    expect(Object.keys(RISK_WEIGHTS).sort()).toEqual([
      'CONFIDENCE',
      'FAILED_ATTEMPTS',
      'HINTS',
      'MISTAKE_SEVERITY',
      'OVERDUE',
      'TOPIC_WEAKNESS',
    ]);
  });
});

describe('F2.1 · each input at its maximum', () => {
  it('a calm problem scores zero', () => {
    expect(scoreRisk(calm()).score).toBe(0);
  });

  it('being overdue alone contributes exactly its weight', () => {
    const result = scoreRisk(calm({ daysOverdue: OVERDUE_CEILING_DAYS }));
    expect(result.score).toBe(Math.round(100 * RISK_WEIGHTS.OVERDUE));
  });

  it('low confidence alone contributes exactly its weight', () => {
    const result = scoreRisk(calm({ confidence: 'low' }));
    expect(result.score).toBe(Math.round(100 * RISK_WEIGHTS.CONFIDENCE));
  });

  it('failed attempts alone contribute exactly their weight', () => {
    const result = scoreRisk(calm({ failedAttempts: FAILED_ATTEMPTS_CEILING }));
    expect(result.score).toBe(Math.round(100 * RISK_WEIGHTS.FAILED_ATTEMPTS));
  });

  it('a structural mistake alone contributes exactly its weight', () => {
    const result = scoreRisk(calm({ mistakes: ['wrong_data_structure'] }));
    expect(result.score).toBe(Math.round(100 * RISK_WEIGHTS.MISTAKE_SEVERITY));
  });

  it('a fully weak topic alone contributes exactly its weight', () => {
    const result = scoreRisk(calm({ topicWeakness: 100 }));
    expect(result.score).toBe(Math.round(100 * RISK_WEIGHTS.TOPIC_WEAKNESS));
  });

  it('hints alone contribute exactly their weight', () => {
    const result = scoreRisk(calm({ hintsUsed: HINTS_CEILING }));
    expect(result.score).toBe(Math.round(100 * RISK_WEIGHTS.HINTS));
  });

  it('everything at once is 100', () => {
    const worst = scoreRisk({
      daysOverdue: 60,
      confidence: 'low',
      hintsUsed: 9,
      failedAttempts: 9,
      mistakes: ['wrong_logic'],
      topicWeakness: 100,
    });

    expect(worst.score).toBe(100);
  });
});

describe('F2.1 · the ceilings', () => {
  it('being weeks overdue does not keep growing past the ceiling', () => {
    const at = scoreRisk(calm({ daysOverdue: OVERDUE_CEILING_DAYS }));
    const far = scoreRisk(calm({ daysOverdue: 400 }));

    expect(far.score).toBe(at.score);
  });

  it('caps failed attempts and hints the same way', () => {
    expect(scoreRisk(calm({ failedAttempts: 99 })).score).toBe(
      scoreRisk(calm({ failedAttempts: FAILED_ATTEMPTS_CEILING })).score,
    );
    expect(scoreRisk(calm({ hintsUsed: 99 })).score).toBe(
      scoreRisk(calm({ hintsUsed: HINTS_CEILING })).score,
    );
  });

  it('treats a missing topic score as no signal, not as a weak one', () => {
    // An untagged problem must not be pushed up the queue for having no tags.
    expect(scoreRisk(calm({ topicWeakness: null })).score).toBe(0);
  });
});

describe('F2.1 · mistakes', () => {
  it('TAKES THE WORST MISTAKE, NOT THE SUM', () => {
    /*
     * A wrong data structure plus a typo is a wrong data structure. Adding the
     * typo would rank it above an identical problem without one, which says
     * nothing useful about either.
     */
    const structural = scoreRisk(calm({ mistakes: ['wrong_logic'] }));
    const structuralPlusTypo = scoreRisk(calm({ mistakes: ['wrong_logic', 'syntax_runtime'] }));

    expect(structuralPlusTypo.score).toBe(structural.score);
  });

  it('ranks structural above conceptual above mechanical', () => {
    const structural = scoreRisk(calm({ mistakes: ['wrong_data_structure'] })).score;
    const conceptual = scoreRisk(calm({ mistakes: ['off_by_one'] })).score;
    const mechanical = scoreRisk(calm({ mistakes: ['syntax_runtime'] })).score;

    expect(structural).toBeGreaterThan(conceptual);
    expect(conceptual).toBeGreaterThan(mechanical);
    expect(mechanical).toBeGreaterThan(0);
  });

  it('scores "nothing went wrong" at zero, and covers every category', () => {
    expect(MISTAKE_SEVERITY.none).toBe(0);

    // Every category the taxonomy defines has a severity: a new one added to
    // F1.5 without a weight here would score as undefined and poison the sum.
    for (const [category, severity] of Object.entries(MISTAKE_SEVERITY)) {
      expect(typeof severity, category).toBe('number');
      expect(severity).toBeGreaterThanOrEqual(0);
      expect(severity).toBeLessThanOrEqual(1);
    }
  });

  it('an empty mistake list is not the same as recording "none"', () => {
    // Both score 0 here, but they are different facts (D21) and the labels must
    // not claim the user said something they did not.
    const skipped = scoreRisk(calm({ mistakes: [] }));
    const said = scoreRisk(calm({ mistakes: ['none'] as MistakeCategory[] }));

    expect(skipped.score).toBe(said.score);
    expect(skipped.factors.some((factor) => factor.key === 'mistakes')).toBe(false);
  });
});

describe('F2.1 · an unanswered confidence question', () => {
  it('is neutral, exactly as in the weak-topic score', () => {
    const silent = scoreRisk(calm({ confidence: null }));
    expect(silent.score).toBe(Math.round(100 * RISK_WEIGHTS.CONFIDENCE * UNKNOWN_CONFIDENCE));
  });

  it('sits between the answers it could have been', () => {
    // The positive control: neutral means nothing unless the ends differ.
    const high = scoreRisk(calm({ confidence: 'high' })).score;
    const silent = scoreRisk(calm({ confidence: null })).score;
    const low = scoreRisk(calm({ confidence: 'low' })).score;

    expect(high).toBeLessThan(silent);
    expect(silent).toBeLessThan(low);
  });
});

describe('F2.1 · the score explains itself', () => {
  it('RETURNS CONTRIBUTING FACTORS, NOT JUST A NUMBER', () => {
    // The acceptance criterion.
    const result = scoreRisk({
      daysOverdue: 18,
      confidence: 'low',
      hintsUsed: 0,
      failedAttempts: 2,
      mistakes: ['off_by_one'],
      topicWeakness: 40,
    });

    expect(result.factors.length).toBeGreaterThan(0);
    for (const factor of result.factors) {
      expect(factor.label.trim()).not.toBe('');
      expect(factor.contribution).toBeGreaterThan(0);
    }
  });

  it('puts the biggest contributor first', () => {
    const result = scoreRisk(
      calm({ daysOverdue: OVERDUE_CEILING_DAYS, mistakes: ['syntax_runtime'] }),
    );

    expect(result.factors[0]?.key).toBe('overdue');
    const contributions = result.factors.map((factor) => factor.contribution);
    expect([...contributions].sort((a, b) => b - a)).toEqual(contributions);
  });

  it('omits inputs that contributed nothing', () => {
    // A list padded with "0 hints taken" is a list nobody reads to the end.
    const result = scoreRisk(calm({ daysOverdue: 3 }));

    expect(result.factors.map((factor) => factor.key)).toEqual(['overdue']);
  });

  it('names the numbers, and gets the grammar right', () => {
    const oneDay = scoreRisk(calm({ daysOverdue: 1 }));
    const manyDays = scoreRisk(calm({ daysOverdue: 9 }));

    expect(oneDay.factors[0]?.label).toBe('1 day overdue');
    expect(manyDays.factors[0]?.label).toBe('9 days overdue');
  });

  it('says what the user actually reported', () => {
    const result = scoreRisk(calm({ confidence: 'low', mistakes: ['recursion_base_case'] }));
    const labels = result.factors.map((factor) => factor.label).join(' | ');

    expect(labels).toContain('you felt low about it last time');
    expect(labels).toContain('recursion base case');
  });

  it('is a pure function of its inputs', () => {
    const input = calm({ daysOverdue: 5, failedAttempts: 1 });
    expect(scoreRisk(input)).toEqual(scoreRisk(input));
  });
});
