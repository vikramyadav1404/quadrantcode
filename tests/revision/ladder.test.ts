/**
 * F2.1 · the ladder.
 *
 * Three acceptance criteria live here: every compression signal isolated **and**
 * combined, the one-day floor holding when all of them fire at once, and all
 * three outcome transitions.
 *
 * Each signal gets its own test because a combined test alone cannot tell you
 * WHICH rule is broken — four signals stacking to the right answer for the wrong
 * reasons is a passing test over a scheduler that has quietly stopped reading
 * one of its inputs.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_LADDER,
  COMPRESSED_LADDER,
  FAILED_ATTEMPTS_THRESHOLD,
  INTERVAL_FLOOR_DAYS,
  SLOW_SOLVE_RATIO,
  type SolveSignals,
  applyOutcome,
  dueDateFor,
  scheduleAfterSolve,
} from '@/server/services/revision/ladder';

/** A solve with nothing remarkable about it: no hints, no failures, on time. */
const plain = (overrides: Partial<SolveSignals> = {}): SolveSignals => ({
  confidence: 'medium',
  hintsUsed: 0,
  failedAttempts: 0,
  activeSeconds: 1_200,
  estimatedSeconds: 1_800,
  ...overrides,
});

describe('F2.1 · the ladders themselves', () => {
  it('are the intervals the spec names', () => {
    expect([...BASE_LADDER]).toEqual([1, 3, 7, 14, 30]);
    expect([...COMPRESSED_LADDER]).toEqual([1, 2, 5, 10, 21]);
  });

  it('are the same length, so a rung means the same thing on both', () => {
    /*
     * The reason confidence picks a ladder rather than an offset: `ladder_index`
     * stays comparable across problems, and the outcome rules need no special
     * case for a shorter ladder.
     */
    expect(COMPRESSED_LADDER.length).toBe(BASE_LADDER.length);
  });

  it('both start at the floor', () => {
    expect(BASE_LADDER[0]).toBe(INTERVAL_FLOOR_DAYS);
    expect(COMPRESSED_LADDER[0]).toBe(INTERVAL_FLOOR_DAYS);
  });
});

describe('F2.1 · each signal on its own', () => {
  it('a plain solve stays where it is', () => {
    const step = scheduleAfterSolve(plain(), 2);

    expect(step.kind).toBe('standard');
    expect(step.index).toBe(2);
    expect(step.intervalDays).toBe(7);
    expect(step.applied).toEqual([]);
  });

  it('LOW CONFIDENCE switches the ladder, not the rung', () => {
    /*
     * Low confidence is a statement about the whole solve rather than about one
     * interval, so it shortens every gap that follows instead of knocking off a
     * step and then behaving normally.
     */
    const step = scheduleAfterSolve(plain({ confidence: 'low' }), 2);

    expect(step.kind).toBe('compressed');
    expect(step.index).toBe(2);
    expect(step.intervalDays).toBe(5); // compressed rung 2, not standard's 7
    expect(step.applied).toContain('low-confidence-ladder');
  });

  it('HINTS USED compresses one step', () => {
    const step = scheduleAfterSolve(plain({ hintsUsed: 1 }), 3);

    expect(step.index).toBe(2);
    expect(step.intervalDays).toBe(7);
    expect(step.applied).toContain('hints-used');
  });

  it('FAILED ATTEMPTS compresses one step, at the threshold', () => {
    const below = scheduleAfterSolve(
      plain({ failedAttempts: FAILED_ATTEMPTS_THRESHOLD - 1 }),
      3,
    );
    const at = scheduleAfterSolve(plain({ failedAttempts: FAILED_ATTEMPTS_THRESHOLD }), 3);

    expect(below.index).toBe(3);
    expect(below.applied).not.toContain('failed-attempts');
    expect(at.index).toBe(2);
    expect(at.applied).toContain('failed-attempts');
  });

  it('A SLOW SOLVE compresses one step, strictly past the ratio', () => {
    const estimatedSeconds = 1_800;

    const exactly = scheduleAfterSolve(
      plain({ estimatedSeconds, activeSeconds: estimatedSeconds * SLOW_SOLVE_RATIO }),
      3,
    );
    const past = scheduleAfterSolve(
      plain({ estimatedSeconds, activeSeconds: estimatedSeconds * SLOW_SOLVE_RATIO + 1 }),
      3,
    );

    // The boundary is not slow: 1.5× is the line, and the rule says "more than".
    expect(exactly.index).toBe(3);
    expect(past.index).toBe(2);
    expect(past.applied).toContain('slow-solve');
  });

  it('A CLEAN QUICK SOLVE stretches one step', () => {
    const step = scheduleAfterSolve(
      plain({ confidence: 'high', hintsUsed: 0, activeSeconds: 900, estimatedSeconds: 1_800 }),
      1,
    );

    expect(step.index).toBe(2);
    expect(step.intervalDays).toBe(7);
    expect(step.applied).toContain('clean-and-quick');
  });

  it('the stretch demands all three conditions', () => {
    /*
     * Any single doubt is enough not to stretch. A scheduler that stretches
     * eagerly loses the problem, and being wrong in that direction costs far
     * more than repeating a revision the user did not need.
     */
    const notConfident = scheduleAfterSolve(plain({ confidence: 'medium' }), 1);
    const tookAHint = scheduleAfterSolve(plain({ confidence: 'high', hintsUsed: 1 }), 1);
    const overEstimate = scheduleAfterSolve(
      plain({ confidence: 'high', activeSeconds: 2_000, estimatedSeconds: 1_800 }),
      1,
    );

    expect(notConfident.applied).not.toContain('clean-and-quick');
    expect(tookAHint.applied).not.toContain('clean-and-quick');
    expect(overEstimate.applied).not.toContain('clean-and-quick');
  });
});

describe('F2.1 · signals stacking', () => {
  it('THREE COMPRESSIONS AT ONCE MOVE THREE STEPS', () => {
    // The combined test the criterion asks for, alongside the isolated ones.
    const step = scheduleAfterSolve(
      plain({
        hintsUsed: 2,
        failedAttempts: 3,
        activeSeconds: 5_400,
        estimatedSeconds: 1_800,
      }),
      4,
    );

    expect(step.index).toBe(1);
    expect(step.intervalDays).toBe(3);
    expect(step.applied).toEqual(['hints-used', 'failed-attempts', 'slow-solve']);
  });

  it('a stretch and a compression cancel out', () => {
    // Two failed attempts and an otherwise flawless solve is a wash — which is
    // the correct reading of both facts, not a bug in the arithmetic.
    const step = scheduleAfterSolve(
      plain({
        confidence: 'high',
        hintsUsed: 0,
        failedAttempts: 2,
        activeSeconds: 900,
        estimatedSeconds: 1_800,
      }),
      2,
    );

    expect(step.index).toBe(2);
    expect(step.applied).toEqual(['failed-attempts', 'clean-and-quick']);
  });

  it('THE ONE-DAY FLOOR HOLDS WHEN EVERY COMPRESSION FIRES AT ONCE', () => {
    /*
     * The acceptance criterion. Three compressions from rung 0 would land on
     * rung −3 without the clamp, and a negative index either throws or wraps —
     * both of which end with a user being asked to revise something at an
     * interval nobody chose.
     */
    const step = scheduleAfterSolve(
      plain({
        confidence: 'low',
        hintsUsed: 3,
        failedAttempts: 5,
        activeSeconds: 10_000,
        estimatedSeconds: 1_800,
      }),
      0,
    );

    expect(step.index).toBe(0);
    expect(step.intervalDays).toBe(INTERVAL_FLOOR_DAYS);
    expect(step.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it('the floor holds on the compressed ladder too', () => {
    const step = scheduleAfterSolve(
      plain({ confidence: 'low', hintsUsed: 1, failedAttempts: 2 }),
      1,
    );

    expect(step.kind).toBe('compressed');
    expect(step.intervalDays).toBeGreaterThanOrEqual(INTERVAL_FLOOR_DAYS);
  });

  it('stretching past the top rung stays on the top rung', () => {
    const step = scheduleAfterSolve(
      plain({ confidence: 'high', activeSeconds: 600, estimatedSeconds: 1_800 }),
      BASE_LADDER.length - 1,
    );

    expect(step.index).toBe(BASE_LADDER.length - 1);
    expect(step.intervalDays).toBe(30);
  });

  it('never returns an interval below the floor, whatever it is given', () => {
    // The property, over the whole input space that matters.
    for (let index = -3; index <= 8; index += 1) {
      for (const confidence of ['low', 'medium', 'high', null] as const) {
        for (const hintsUsed of [0, 5]) {
          const step = scheduleAfterSolve(plain({ confidence, hintsUsed }), index);
          expect(step.intervalDays).toBeGreaterThanOrEqual(INTERVAL_FLOOR_DAYS);
        }
      }
    }
  });
});

describe('F2.1 · what a revision outcome does', () => {
  it('CLEAN advances a rung', () => {
    const next = applyOutcome({ kind: 'standard', index: 1 }, 'clean');

    expect(next.index).toBe(2);
    expect(next.intervalDays).toBe(7);
  });

  it('STRUGGLED repeats the same interval', () => {
    /*
     * The outcome that exists so a user barely holding on is not pushed to a
     * longer gap. Collapsing it into `clean` would do exactly that.
     */
    const next = applyOutcome({ kind: 'standard', index: 3 }, 'struggled');

    expect(next.index).toBe(3);
    expect(next.intervalDays).toBe(14);
  });

  it('FAILED resets to day one', () => {
    const next = applyOutcome({ kind: 'standard', index: 4 }, 'failed');

    expect(next.index).toBe(0);
    expect(next.intervalDays).toBe(1);
  });

  it('keeps the ladder the user is on', () => {
    // A revision outcome moves the rung; it never moves someone between
    // ladders. Only the confidence at solve time chooses that.
    for (const outcome of ['clean', 'struggled', 'failed'] as const) {
      expect(applyOutcome({ kind: 'compressed', index: 2 }, outcome).kind).toBe('compressed');
    }
  });

  it('advancing from the top rung stays there', () => {
    const next = applyOutcome({ kind: 'standard', index: BASE_LADDER.length - 1 }, 'clean');
    expect(next.index).toBe(BASE_LADDER.length - 1);
  });
});

describe('F2.1 · due dates', () => {
  it('counts the interval forward from the day it was set', () => {
    expect(dueDateFor('2026-03-30', 1)).toBe('2026-03-31');
    expect(dueDateFor('2026-03-30', 7)).toBe('2026-04-06');
  });

  it('never schedules for today or the past, even given zero', () => {
    // The floor again, at the last place it could be lost.
    expect(dueDateFor('2026-03-30', 0)).toBe('2026-03-31');
    expect(dueDateFor('2026-03-30', -5)).toBe('2026-03-31');
  });

  it('crosses a month and a leap day without arithmetic of its own', () => {
    expect(dueDateFor('2026-02-27', 3)).toBe('2026-03-02'); // 2026 is not a leap year
    expect(dueDateFor('2024-02-27', 3)).toBe('2024-03-01'); // 2024 is
  });
});
