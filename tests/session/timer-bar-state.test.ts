/**
 * C2 · `seedElapsed`, moved unchanged out of TimerBar so the v2 session strip
 * seeds its display with the same arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { type TimerBarState, formatElapsed, seedElapsed } from '@/lib/session/timer-bar-state';

const AS_OF = '2026-10-05T10:00:00.000Z';
const state = (overrides: Partial<TimerBarState> = {}): TimerBarState => ({
  sessionId: 's',
  problemId: 'p',
  problemTitle: 'T',
  problemSlug: 't',
  status: 'active',
  activeDurationSeconds: 100,
  asOf: AS_OF,
  ...overrides,
});
const after = (seconds: number) => new Date(AS_OF).getTime() + seconds * 1000;

describe('C2 · seedElapsed', () => {
  it('an ACTIVE session adds the whole seconds since the server computed it', () => {
    expect(seedElapsed(state(), after(42.9))).toBe(142);
  });

  it('a PAUSED session takes the server number as-is, whatever the clock did', () => {
    expect(seedElapsed(state({ status: 'paused' }), after(3600))).toBe(100);
  });

  it('a clock BEHIND asOf never subtracts time', () => {
    expect(seedElapsed(state(), after(-30))).toBe(100);
  });
});

describe('formatElapsed', () => {
  it('is MM:SS under an hour and H:MM:SS above', () => {
    expect(formatElapsed(754)).toBe('12:34');
    expect(formatElapsed(3600 + 61)).toBe('1:01:01');
  });
});
