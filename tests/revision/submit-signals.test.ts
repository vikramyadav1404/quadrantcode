/**
 * The signals an accepted Submit hands the revision ladder.
 *
 * `applyVerifiedSubmissionEffectsTx` used to pass `failedAttempts: 0` and
 * `activeSeconds = estimatedSeconds`. Read against `scheduleAfterSolve`, that
 * combination is not merely approximate — it is inert:
 *
 *   confidence null   → not 'low', so no compressed ladder
 *                     → not 'high', so `clean-and-quick` cannot fire
 *   hintsUsed 0       → no `hints-used`
 *   failedAttempts 0  → never reaches FAILED_ATTEMPTS_THRESHOLD (2)
 *   active == est     → never exceeds est * SLOW_SOLVE_RATIO (1.5)
 *
 * Every rule gated off, so `steps` was exactly 0 on every accepted submit.
 *
 * ## Why these assertions need a non-zero starting rung
 *
 * `stepTo` clamps with `Math.max(0, rawIndex)`. On a FIRST solve `fromIndex` is
 * 0, so a compression of -1 floors right back to 0 and the bug is invisible —
 * which is exactly why production data looked fine. The difference only shows
 * on a re-solve, so these tests start from a rung above the floor.
 */
import { describe, expect, it } from 'vitest';
import {
  FAILED_ATTEMPTS_THRESHOLD,
  SLOW_SOLVE_RATIO,
  scheduleAfterSolve,
} from '@/server/services/revision';

const ESTIMATED = 20 * 60;
const START_RUNG = 3;

/** What the old code passed, whatever the solve was actually like. */
const PLACEHOLDER_SIGNALS = {
  confidence: null,
  hintsUsed: 0,
  failedAttempts: 0,
  activeSeconds: ESTIMATED,
  estimatedSeconds: ESTIMATED,
} as const;

describe('the placeholder signals could not move the ladder', () => {
  it('steps by exactly zero, from any rung', () => {
    // The regression this file exists for. If someone reinstates the
    // placeholders, the `applied` list goes empty and this fails.
    for (const rung of [0, 1, 3, 5]) {
      const step = scheduleAfterSolve(PLACEHOLDER_SIGNALS, rung);
      expect(step.applied, `rung ${rung}`).toEqual([]);
    }
    expect(scheduleAfterSolve(PLACEHOLDER_SIGNALS, START_RUNG).index).toBe(START_RUNG);
  });
});

describe('real signals CAN move the ladder', () => {
  it('a slow solve compresses — the case the estimate-twice placeholder hid', () => {
    const step = scheduleAfterSolve(
      {
        ...PLACEHOLDER_SIGNALS,
        // Just past the ratio, so the test pins the rule and not a round number.
        activeSeconds: Math.ceil(ESTIMATED * SLOW_SOLVE_RATIO) + 1,
      },
      START_RUNG,
    );
    expect(step.applied).toContain('slow-solve');
    expect(step.index).toBeLessThan(START_RUNG);
  });

  it('repeated stuck sittings compress — the case failedAttempts:0 hid', () => {
    const step = scheduleAfterSolve(
      { ...PLACEHOLDER_SIGNALS, failedAttempts: FAILED_ATTEMPTS_THRESHOLD },
      START_RUNG,
    );
    expect(step.applied).toContain('failed-attempts');
    expect(step.index).toBeLessThan(START_RUNG);
  });

  it('both together compress further than either alone', () => {
    const slow = Math.ceil(ESTIMATED * SLOW_SOLVE_RATIO) + 1;
    const one = scheduleAfterSolve({ ...PLACEHOLDER_SIGNALS, activeSeconds: slow }, START_RUNG);
    const both = scheduleAfterSolve(
      {
        ...PLACEHOLDER_SIGNALS,
        activeSeconds: slow,
        failedAttempts: FAILED_ATTEMPTS_THRESHOLD,
      },
      START_RUNG,
    );
    expect(both.index).toBeLessThan(one.index);
  });
});

describe('the positive control: a clean fast solve must NOT compress', () => {
  /*
   * Without this, every assertion above would pass against an implementation
   * that simply compressed unconditionally — "the ladder moved" is only
   * meaningful if something also leaves it alone, and something else lengthens
   * it. This is the pair that distinguishes "reads the signals" from "always
   * steps down".
   */
  it('inside the estimate, unaided and confident, lengthens instead', () => {
    const step = scheduleAfterSolve(
      {
        confidence: 'high',
        hintsUsed: 0,
        failedAttempts: 0,
        activeSeconds: Math.floor(ESTIMATED / 4),
        estimatedSeconds: ESTIMATED,
      },
      START_RUNG,
    );
    expect(step.applied).toContain('clean-and-quick');
    expect(step.index).toBeGreaterThan(START_RUNG);
  });

  it('a solve just inside the slow ratio does not compress', () => {
    // Boundary: `>` not `>=`, so exactly the ratio is not slow.
    const step = scheduleAfterSolve(
      { ...PLACEHOLDER_SIGNALS, activeSeconds: ESTIMATED * SLOW_SOLVE_RATIO },
      START_RUNG,
    );
    expect(step.applied).not.toContain('slow-solve');
    expect(step.index).toBe(START_RUNG);
  });

  it('one stuck sitting is below the threshold and does not compress', () => {
    const step = scheduleAfterSolve(
      { ...PLACEHOLDER_SIGNALS, failedAttempts: FAILED_ATTEMPTS_THRESHOLD - 1 },
      START_RUNG,
    );
    expect(step.applied).not.toContain('failed-attempts');
    expect(step.index).toBe(START_RUNG);
  });
});

describe('why a missing session must not default to zero seconds', () => {
  it('activeSeconds 0 would read as the FASTEST possible solve', () => {
    // `activeSecondsForSession` returns null outside a timed sitting, and
    // `submission-effects` falls back to the estimate rather than to 0. This is
    // what that choice is avoiding: zero satisfies `<= estimatedSeconds`, so a
    // confident untimed submit would be rewarded with a longer gap.
    const step = scheduleAfterSolve(
      {
        confidence: 'high',
        hintsUsed: 0,
        failedAttempts: 0,
        activeSeconds: 0,
        estimatedSeconds: ESTIMATED,
      },
      START_RUNG,
    );
    expect(step.applied).toContain('clean-and-quick');
    expect(step.index).toBeGreaterThan(START_RUNG);
  });
});
