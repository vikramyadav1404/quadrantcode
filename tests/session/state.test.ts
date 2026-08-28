/**
 * F1.4 · the state machine, as a table.
 *
 * The ticket requires illegal transitions to return a typed error rather than a
 * no-op, and the reason is the failure a no-op produces: the caller believes
 * the pause landed, the timer keeps running, and nothing says otherwise until
 * the user notices their elapsed time is wrong.
 *
 * Every pair is asserted, not just the interesting ones — an omitted pair is
 * how a machine acquires a transition nobody decided on.
 */
import { describe, expect, it } from 'vitest';
import { IllegalTransitionError } from '@/server/services/session/errors';
import {
  LIVE_STATUSES,
  type SessionStatus,
  TERMINAL_STATUSES,
  assertTransition,
  canTransition,
  isLive,
  isTerminal,
} from '@/server/services/session/state';

const ALL: SessionStatus[] = ['active', 'paused', 'solved', 'stuck', 'abandoned'];

/** The specification, written out separately from the implementation. */
const ALLOWED: ReadonlyArray<[SessionStatus, SessionStatus]> = [
  ['active', 'paused'],
  ['active', 'solved'],
  ['active', 'stuck'],
  ['active', 'abandoned'],
  ['paused', 'active'],
  ['paused', 'solved'],
  ['paused', 'stuck'],
  ['paused', 'abandoned'],
];

const isAllowed = (from: SessionStatus, to: SessionStatus) =>
  ALLOWED.some(([a, b]) => a === from && b === to);

describe('F1.4 · every transition pair', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const verb = isAllowed(from, to) ? 'allows' : 'refuses';

      it(`${verb} ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(isAllowed(from, to));
      });
    }
  }
});

describe('F1.4 · assertTransition', () => {
  it('throws a typed error carrying both states', () => {
    try {
      assertTransition('solved', 'active');
      expect.unreachable('a solved session must not reopen');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const illegal = error as IllegalTransitionError;
      expect(illegal.from).toBe('solved');
      expect(illegal.to).toBe('active');
      expect(illegal.status).toBe(409);
    }
  });

  it('refuses to pause an already paused session', () => {
    /*
     * Not harmless, which is why it is not a no-op: it would append a second
     * `paused` event. The duration arithmetic survives that by design, but the
     * log is a record of what happened and a pause that did not happen does
     * not belong in it.
     */
    expect(() => assertTransition('paused', 'paused')).toThrow(IllegalTransitionError);
  });

  it('refuses to resume a running session', () => {
    expect(() => assertTransition('active', 'active')).toThrow(IllegalTransitionError);
  });

  it('lets a live session finish from either state', () => {
    expect(() => assertTransition('active', 'solved')).not.toThrow();
    expect(() => assertTransition('paused', 'solved')).not.toThrow();
  });

  it('NEVER lets a terminal session move again', () => {
    // The invariant behind the partial unique index: once terminal, a session
    // stops competing for the user's single live slot, permanently.
    for (const terminal of TERMINAL_STATUSES) {
      for (const to of ALL) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });
});

describe('F1.4 · isLive / isTerminal', () => {
  it('splits the statuses with no overlap and nothing left over', () => {
    expect(LIVE_STATUSES.filter((status) => isTerminal(status))).toEqual([]);
    expect(TERMINAL_STATUSES.filter((status) => isLive(status))).toEqual([]);
    expect([...LIVE_STATUSES, ...TERMINAL_STATUSES].sort()).toEqual([...ALL].sort());
  });

  it('counts a PAUSED session as live', () => {
    // The whole reason the partial unique index covers two statuses: a paused
    // session is still the user's session.
    expect(isLive('paused')).toBe(true);
  });
});
