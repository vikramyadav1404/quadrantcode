/**
 * F1.3 · which goal applied on a day.
 *
 * Pure, and worth its own file: `targetOn` is now the single answer the
 * recompute, the heatmap and the shell all read. When those three carried their
 * own copies, nothing failed if one of them drifted.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGET_PROBLEMS, targetOn } from '@/server/services/streak/goals';

describe('F1.3 · targetOn', () => {
  it('falls back to the schema default when the user has never set a goal', () => {
    expect(targetOn([], '2026-03-01')).toBe(DEFAULT_TARGET_PROBLEMS);
  });

  it('uses the row in force, not the most recent one', () => {
    /*
     * The reason the rows are effective-dated at all. Raising the target today
     * must not reach back and un-complete a day that met the old one — D18's
     * immutability principle applied to the goal.
     */
    const goals = [
      { effectiveFrom: '2026-03-01', targetProblems: 2 },
      { effectiveFrom: '2026-03-10', targetProblems: 5 },
    ];

    expect(targetOn(goals, '2026-03-05')).toBe(2);
    expect(targetOn(goals, '2026-03-10')).toBe(5); // effective FROM, inclusive
    expect(targetOn(goals, '2026-03-11')).toBe(5);
  });

  it('ignores a goal that starts after the day asked about', () => {
    // A timezone change can move the user's today backwards, so a row saved
    // as "today" in the old zone can be in the future in the new one.
    const goals = [{ effectiveFrom: '2026-03-10', targetProblems: 5 }];
    expect(targetOn(goals, '2026-03-09')).toBe(DEFAULT_TARGET_PROBLEMS);
  });

  it('holds the last applicable row across a gap of months', () => {
    const goals = [{ effectiveFrom: '2026-01-01', targetProblems: 4 }];
    expect(targetOn(goals, '2026-06-30')).toBe(4);
  });
});
