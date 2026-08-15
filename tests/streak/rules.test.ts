/**
 * F1.3 · day completion and freeze arithmetic. Both pure, no database.
 */
import { describe, expect, it } from 'vitest';
import { evaluateDayCompletion } from '@/server/services/streak/rules';
import {
  MONTHLY_FREEZE_ALLOWANCE,
  canFreeze,
  coverageFor,
  freezeBalanceFor,
} from '@/server/services/streak/freezes';

describe('F1.3 · evaluateDayCompletion', () => {
  const base = { solvedCount: 0, revisionCount: 0, targetProblems: 2 };

  it.each([
    ['target met exactly', { solvedCount: 2 }, true, 'target-met'],
    ['target exceeded', { solvedCount: 5 }, true, 'target-met'],
    ['one short of target', { solvedCount: 1 }, false, 'incomplete'],
    ['nothing at all', {}, false, 'incomplete'],
    [
      'revision path: 2 revisions + 1 solve',
      { solvedCount: 1, revisionCount: 2 },
      true,
      'revision-path',
    ],
    [
      'revision path: 5 revisions + 1 solve',
      { solvedCount: 1, revisionCount: 5 },
      true,
      'revision-path',
    ],
    ['2 revisions but NO solve', { revisionCount: 2 }, false, 'incomplete'],
    [
      '1 revision + 1 solve is not enough',
      { solvedCount: 1, revisionCount: 1 },
      false,
      'incomplete',
    ],
    ['9 revisions, no solve', { revisionCount: 9 }, false, 'incomplete'],
  ])('%s', (_label, overrides, completed, reason) => {
    const result = evaluateDayCompletion({ ...base, ...overrides });
    expect(result.completed).toBe(completed);
    expect(result.reason).toBe(reason);
  });

  it('respects a per-user target', () => {
    // The reason this is one function: the rule is meant to become per-user.
    expect(
      evaluateDayCompletion({ ...base, solvedCount: 3, targetProblems: 5 }).completed,
    ).toBe(false);
    expect(
      evaluateDayCompletion({ ...base, solvedCount: 3, targetProblems: 3 }).completed,
    ).toBe(true);
  });

  it('prefers target-met over revision-path when both hold', () => {
    // Not cosmetic: the reason is shown to the user, and "you hit your target"
    // is the true statement when they hit their target.
    const result = evaluateDayCompletion({
      solvedCount: 4,
      revisionCount: 4,
      targetProblems: 2,
    });
    expect(result.reason).toBe('target-met');
  });

  it('refuses a non-positive target rather than completing every empty day', () => {
    /*
     * With targetProblems = 0, `solvedCount >= targetProblems` is true for a day
     * with nothing in it — every empty day complete, every streak in the system
     * inflated at once. The database CHECK forbids it; this is the second line.
     */
    expect(() => evaluateDayCompletion({ ...base, targetProblems: 0 })).toThrow();
    expect(() => evaluateDayCompletion({ ...base, targetProblems: -1 })).toThrow();
  });

  it('refuses negative counts', () => {
    expect(() => evaluateDayCompletion({ ...base, solvedCount: -1 })).toThrow();
    expect(() => evaluateDayCompletion({ ...base, revisionCount: -1 })).toThrow();
  });
});

describe('F1.3 · freeze allowance', () => {
  it('starts at the monthly allowance', () => {
    expect(freezeBalanceFor('2026-03-08', [])).toBe(MONTHLY_FREEZE_ALLOWANCE);
  });

  it('decrements per freeze used in that month', () => {
    const coverage = [{ coveredLocalDate: '2026-03-02' }];
    expect(freezeBalanceFor('2026-03-08', coverage)).toBe(1);

    coverage.push({ coveredLocalDate: '2026-03-05' });
    expect(freezeBalanceFor('2026-03-08', coverage)).toBe(0);
  });

  it('REFILLS at the month boundary without anything scheduling it', () => {
    /*
     * The point of deriving rather than storing (D18): F2.3 is cut, so no job
     * exists to refill a counter. Two freezes spent in March leave April at
     * full allowance because the balance is a function of the month being
     * asked about.
     */
    const marchSpent = [{ coveredLocalDate: '2026-03-02' }, { coveredLocalDate: '2026-03-05' }];

    expect(freezeBalanceFor('2026-03-31', marchSpent)).toBe(0);
    expect(freezeBalanceFor('2026-04-01', marchSpent)).toBe(MONTHLY_FREEZE_ALLOWANCE);
  });

  it('does not leak across a year boundary', () => {
    const decemberSpent = [
      { coveredLocalDate: '2025-12-30' },
      { coveredLocalDate: '2025-12-31' },
    ];
    expect(freezeBalanceFor('2025-12-31', decemberSpent)).toBe(0);
    expect(freezeBalanceFor('2026-01-01', decemberSpent)).toBe(MONTHLY_FREEZE_ALLOWANCE);
  });

  it('never goes negative', () => {
    const overSpent = ['2026-03-01', '2026-03-02', '2026-03-03'].map((coveredLocalDate) => ({
      coveredLocalDate,
    }));
    expect(freezeBalanceFor('2026-03-08', overSpent)).toBe(0);
  });
});

describe('F1.3 · canFreeze', () => {
  it('refuses a day that was already complete', () => {
    // The spec calls this out: burning a freeze on a completed day is the
    // difference between a safety net and a tax.
    expect(canFreeze('2026-03-08', true, [])).toBe(false);
  });

  it('allows an incomplete day while allowance remains', () => {
    expect(canFreeze('2026-03-08', false, [])).toBe(true);
  });

  it('refuses once the month is exhausted', () => {
    const spent = [{ coveredLocalDate: '2026-03-01' }, { coveredLocalDate: '2026-03-02' }];
    expect(canFreeze('2026-03-08', false, spent)).toBe(false);
    // …but next month is fine.
    expect(canFreeze('2026-04-01', false, spent)).toBe(true);
  });
});

describe('F1.3 · coverageFor — the backfill question', () => {
  it('covers the first eligible gaps, in order', () => {
    const coverage = coverageFor([
      { date: '2026-03-01', completed: true },
      { date: '2026-03-02', completed: false },
      { date: '2026-03-03', completed: true },
      { date: '2026-03-04', completed: false },
    ]);
    expect(coverage.map((row) => row.coveredLocalDate)).toEqual(['2026-03-02', '2026-03-04']);
  });

  it('stops at the monthly allowance and leaves later gaps uncovered', () => {
    const coverage = coverageFor(
      ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'].map((date) => ({
        date,
        completed: false,
      })),
    );
    expect(coverage).toHaveLength(MONTHLY_FREEZE_ALLOWANCE);
    expect(coverage.map((row) => row.coveredLocalDate)).toEqual(['2026-03-01', '2026-03-02']);
  });

  it('A BACKFILL RELEASES A FREEZE — coverage is re-derived, not transacted', () => {
    /*
     * The question: a freeze covered missed day D; the user later logs a
     * session for D; the freeze was spent on a day that turned out not to need
     * it. Does it come back?
     *
     * It comes back, and NOT as a refund mechanic — it falls out of coverage
     * being a pure function of the days. Recomputing the same sequence with D
     * now complete simply produces a coverage set without D in it.
     *
     * The alternative (consumed is permanent) would make recompute depend on
     * the ORDER things were logged: two users with byte-identical session
     * histories would hold different balances because one logged late. That
     * contradicts the idempotency the whole ticket rests on.
     */
    const before = coverageFor([
      { date: '2026-03-01', completed: true },
      { date: '2026-03-02', completed: false }, // missed, frozen
      { date: '2026-03-03', completed: true },
    ]);
    expect(before.map((row) => row.coveredLocalDate)).toEqual(['2026-03-02']);
    expect(freezeBalanceFor('2026-03-03', before)).toBe(1);

    // The user backfills 2026-03-02.
    const after = coverageFor([
      { date: '2026-03-01', completed: true },
      { date: '2026-03-02', completed: true }, // now genuinely complete
      { date: '2026-03-03', completed: true },
    ]);

    expect(after).toEqual([]);
    expect(freezeBalanceFor('2026-03-03', after)).toBe(MONTHLY_FREEZE_ALLOWANCE);
  });

  it('a released freeze becomes available for a LATER gap', () => {
    // The consequence that makes the release meaningful rather than cosmetic:
    // the returned allowance actually protects a subsequent day.
    const coverage = coverageFor([
      { date: '2026-03-01', completed: true }, // was missed, now backfilled
      { date: '2026-03-02', completed: false },
      { date: '2026-03-03', completed: false },
      { date: '2026-03-04', completed: false }, // only reachable if 03-01 released
    ]);
    expect(coverage.map((row) => row.coveredLocalDate)).toEqual(['2026-03-02', '2026-03-03']);
  });

  it('is deterministic — the same sequence always yields the same coverage', () => {
    // The property everything above rests on. Order-independence of the OUTPUT
    // given the same input is what makes recompute idempotent.
    const days = [
      { date: '2026-03-01', completed: false },
      { date: '2026-03-02', completed: true },
      { date: '2026-03-03', completed: false },
      { date: '2026-03-04', completed: false },
    ];
    expect(coverageFor(days)).toEqual(coverageFor(days));
    expect(coverageFor(days)).toEqual(coverageFor([...days]));
  });

  it('does not cover completed days even when allowance is free', () => {
    const coverage = coverageFor([
      { date: '2026-03-01', completed: true },
      { date: '2026-03-02', completed: true },
    ]);
    expect(coverage).toEqual([]);
  });
});
