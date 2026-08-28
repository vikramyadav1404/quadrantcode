/**
 * F3.5 · the trend rule.
 *
 * Criterion 1: "Trend calculation is test-covered for improving, flat, and
 * worsening series." All three are here, and so is every boundary — a
 * threshold with no test either side of it is a number nobody has checked.
 *
 * The case worth reading is the last describe block: a user who stopped
 * practising looks statistically identical to one who improved, and the rule
 * refuses to congratulate them.
 */
import { describe, expect, it } from 'vitest';
import {
  NEEDS_ACTIVITY,
  TREND_LABELS,
  TREND_MARGIN,
  classifyTrend,
  severityOf,
} from '@/server/services/mistakes/trend';

/** Enough recent work that the activity guard is not what is being tested. */
const ACTIVE = { recentSolves: 10 };

describe('F3.5 · improving', () => {
  it('a halved rate is improving', () => {
    expect(classifyTrend({ recent: 2, earlier: 6, ...ACTIVE })).toBe('improving');
  });

  it('stopping the mistake entirely is improving', () => {
    expect(classifyTrend({ recent: 0, earlier: 5, ...ACTIVE })).toBe('improving');
  });
});

describe('F3.5 · worsening', () => {
  it('a doubled rate is worsening', () => {
    expect(classifyTrend({ recent: 8, earlier: 3, ...ACTIVE })).toBe('worsening');
  });

  it('a new pattern is NOT worsening', () => {
    /*
     * There is no earlier rate for it to have risen from, and any ratio against
     * zero is a division nobody should trust. A mistake first made this month
     * is new, not deteriorating.
     */
    expect(classifyTrend({ recent: 4, earlier: 0, ...ACTIVE })).toBe('flat');
  });
});

describe('F3.5 · flat, and the margin that keeps it flat', () => {
  it('an unchanged rate is flat', () => {
    expect(classifyTrend({ recent: 4, earlier: 4, ...ACTIVE })).toBe('flat');
  });

  it('ONE OCCURRENCE EITHER WAY DOES NOT FLIP A SMALL PATTERN', () => {
    /*
     * This failed on the first run, and the rule was wrong rather than the
     * test. A percentage margin alone does not protect small patterns: 20% of
     * four is 0.8, so a single occurrence clears it. `TREND_FLOOR` is the fix.
     */
    expect(classifyTrend({ recent: 3, earlier: 4, ...ACTIVE })).toBe('flat');
    expect(classifyTrend({ recent: 5, earlier: 4, ...ACTIVE })).toBe('flat');
  });

  it('needs BOTH thresholds, not either', () => {
    // Proportionally large but only one occurrence: 1 vs 2 is a 50% drop.
    expect(classifyTrend({ recent: 1, earlier: 2, ...ACTIVE })).toBe('flat');
    // Absolutely large but proportionally small: 20 vs 22 is under 20%.
    expect(classifyTrend({ recent: 20, earlier: 22, ...ACTIVE })).toBe('flat');
  });

  it('sits exactly on the boundary and stays flat', () => {
    // earlier=10, margin 20% → improving needs < 8, worsening needs > 12.
    expect(TREND_MARGIN).toBe(0.2);
    expect(classifyTrend({ recent: 8, earlier: 10, ...ACTIVE })).toBe('flat');
    expect(classifyTrend({ recent: 12, earlier: 10, ...ACTIVE })).toBe('flat');
  });

  it('and moves the moment the boundary is crossed', () => {
    // The positive control for the two assertions above: a threshold nothing
    // can cross is a threshold that is not doing anything.
    expect(classifyTrend({ recent: 7, earlier: 10, ...ACTIVE })).toBe('improving');
    expect(classifyTrend({ recent: 13, earlier: 10, ...ACTIVE })).toBe('worsening');
  });

  it('two empty windows are flat, not improving', () => {
    expect(classifyTrend({ recent: 0, earlier: 0, ...ACTIVE })).toBe('flat');
  });
});

describe('F3.5 · A USER WHO STOPPED PRACTISING HAS NOT IMPROVED', () => {
  it('refuses to call inactivity progress', () => {
    /*
     * Statistically identical to real improvement — no recent occurrences — and
     * the difference is whether they were solving at all. Counting mistakes
     * rather than mistakes-per-attempt has this blind spot, and the activity
     * guard is where it is admitted rather than hidden.
     */
    expect(classifyTrend({ recent: 0, earlier: 6, recentSolves: 0 })).toBe('flat');
    expect(classifyTrend({ recent: 0, earlier: 6, recentSolves: NEEDS_ACTIVITY - 1 })).toBe(
      'flat',
    );
  });

  it('POSITIVE CONTROL · the same numbers WITH activity do read as improving', () => {
    // Without this, the guard could be rejecting everything and the assertions
    // above would still pass.
    expect(classifyTrend({ recent: 0, earlier: 6, recentSolves: NEEDS_ACTIVITY })).toBe(
      'improving',
    );
  });

  it('does not let inactivity hide a worsening pattern either', () => {
    // The guard suppresses both directions. Reporting "worsening" off two
    // sessions would be just as much of an overstatement.
    expect(classifyTrend({ recent: 9, earlier: 2, recentSolves: 1 })).toBe('flat');
  });
});

describe('F3.5 · severity, which F2.1 consumes', () => {
  it('rises with recurrence and stops at one', () => {
    expect(severityOf({ occurrences: 1, trend: 'flat' })).toBeCloseTo(0.2);
    expect(severityOf({ occurrences: 5, trend: 'flat' })).toBe(1);
    expect(severityOf({ occurrences: 50, trend: 'flat' })).toBe(1);
  });

  it('WEIGHS A WORSENING MISTAKE ABOVE AN IMPROVING ONE at the same count', () => {
    /*
     * The risk score answers "how likely is this to go wrong again". A mistake
     * you are still making predicts that better than one you made often and
     * have since fixed.
     */
    const worse = severityOf({ occurrences: 3, trend: 'worsening' });
    const better = severityOf({ occurrences: 3, trend: 'improving' });

    expect(worse).toBeGreaterThan(better);
  });

  it('never leaves 0–1, so the risk weights stay comparable', () => {
    for (const occurrences of [0, 1, 3, 5, 20]) {
      for (const trend of ['improving', 'flat', 'worsening'] as const) {
        const value = severityOf({ occurrences, trend });
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('F3.5 · the labels', () => {
  it('describe direction without praising or scolding', () => {
    // "less often lately", not "great progress!" — the panel reports, it does
    // not coach at the user.
    expect(TREND_LABELS.improving).toBe('less often lately');
    expect(TREND_LABELS.worsening).toBe('more often lately');

    for (const label of Object.values(TREND_LABELS)) {
      expect(label).not.toMatch(/great|well done|keep it up|bad|poor/i);
    }
  });
});
