/**
 * F2.2 · the pure parts of revision modes: the speed target, hit/miss, and what
 * the mode comparison is allowed to claim.
 */
import { describe, expect, it } from 'vitest';
import { MODE_COMPARISON_MINIMUM } from '@/lib/revision/modes';
import {
  compareModes,
  measureRevisions,
  speedTargetMet,
  speedTargetSeconds,
} from '@/server/services/revision/modes';

describe('speed target = min(previous best, estimate)', () => {
  it('takes the best when it is under the estimate', () => {
    expect(speedTargetSeconds({ bestTimeSeconds: 600, estimatedMinutes: 30 })).toBe(600);
  });

  it('takes the estimate when the best is slower', () => {
    expect(speedTargetSeconds({ bestTimeSeconds: 2_400, estimatedMinutes: 30 })).toBe(1_800);
  });

  it('falls back to the estimate when there is no best', () => {
    expect(speedTargetSeconds({ bestTimeSeconds: null, estimatedMinutes: 20 })).toBe(1_200);
  });
});

describe('speed hit or miss', () => {
  it('is a hit only when solved within the target', () => {
    expect(speedTargetMet({ outcome: 'solved', activeSeconds: 600, targetSeconds: 600 })).toBe(
      true,
    );
    expect(speedTargetMet({ outcome: 'solved', activeSeconds: 601, targetSeconds: 600 })).toBe(
      false,
    );
  });

  it('is a miss when the sitting ended stuck, however fast', () => {
    expect(speedTargetMet({ outcome: 'stuck', activeSeconds: 10, targetSeconds: 600 })).toBe(
      false,
    );
  });
});

describe('mode comparison', () => {
  const many = (mode: 'blind' | 'speed', retained: number, total: number) =>
    Array.from({ length: total }, (_, index) => ({ mode, retained: index < retained }));

  it('says "not enough data" under the minimum, and gives no rate', () => {
    const result = compareModes(many('blind', 9, MODE_COMPARISON_MINIMUM - 1));
    expect(result).toEqual({
      enough: false,
      measured: MODE_COMPARISON_MINIMUM - 1,
      minimum: MODE_COMPARISON_MINIMUM,
    });
  });

  it('at the minimum, reports every mode with its own sample size and names the best', () => {
    const result = compareModes([...many('blind', 2, 5), ...many('speed', 4, 5)]);
    expect(result.enough).toBe(true);
    if (!result.enough) return;
    expect(result.measured).toBe(10);
    expect(result.modes.find((stat) => stat.mode === 'blind')).toEqual({
      mode: 'blind',
      measured: 5,
      retained: 2,
    });
    expect(result.modes.find((stat) => stat.mode === 'pattern')).toEqual({
      mode: 'pattern',
      measured: 0,
      retained: 0,
    });
    expect(result.best).toBe('speed');
  });

  it('names no winner on a tie', () => {
    const result = compareModes([...many('blind', 3, 5), ...many('speed', 3, 5)]);
    expect(result.enough && result.best).toBeNull();
  });
});

describe('measuring a revision by the attempt after it', () => {
  const t = (day: number) => new Date(Date.UTC(2026, 8, day));

  it('pairs each revision sitting with the NEXT sitting on the same problem', () => {
    const measured = measureRevisions([
      { problemId: 'a', startedAt: t(1), status: 'solved', revisionMode: null },
      { problemId: 'a', startedAt: t(5), status: 'solved', revisionMode: 'blind' },
      { problemId: 'a', startedAt: t(9), status: 'stuck', revisionMode: null },
      { problemId: 'a', startedAt: t(12), status: 'solved', revisionMode: 'speed' },
      { problemId: 'a', startedAt: t(20), status: 'solved', revisionMode: null },
    ]);
    expect(measured).toEqual([
      { mode: 'blind', retained: false },
      { mode: 'speed', retained: true },
    ]);
  });

  it('leaves a revision with no later attempt unmeasured rather than counting it', () => {
    expect(
      measureRevisions([
        { problemId: 'a', startedAt: t(1), status: 'solved', revisionMode: null },
        { problemId: 'a', startedAt: t(5), status: 'solved', revisionMode: 'pattern' },
      ]),
    ).toEqual([]);
  });

  it('never pairs across problems, whatever the order it is handed', () => {
    expect(
      measureRevisions([
        { problemId: 'b', startedAt: t(6), status: 'solved', revisionMode: null },
        { problemId: 'a', startedAt: t(5), status: 'solved', revisionMode: 'blind' },
      ]),
    ).toEqual([]);
  });
});
