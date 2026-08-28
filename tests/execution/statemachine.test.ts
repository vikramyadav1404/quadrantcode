/**
 * F3.1 · the execution state machine.
 *
 * The criterion is that illegal transitions are rejected server-side. The
 * failure that matters is a job reported `completed` that never ran — a no-op
 * looks like success to whoever asked, and here "success" means a result.
 *
 * Every pair is asserted rather than the interesting ones: an omitted pair is
 * how a machine acquires a transition nobody decided on.
 */
import { describe, expect, it } from 'vitest';
import {
  type ExecutionStatus,
  IllegalExecutionTransitionError,
  LIVE_STATUSES,
  TERMINAL_STATUSES,
  assertTransition,
  canTransition,
  isLive,
  isTerminal,
} from '@/server/services/execution/statemachine';

const ALL: ExecutionStatus[] = ['queued', 'running', 'completed', 'failed'];

/** The specification, written out separately from the implementation. */
const ALLOWED: ReadonlyArray<[ExecutionStatus, ExecutionStatus]> = [
  ['queued', 'running'],
  ['queued', 'failed'],
  ['running', 'completed'],
  ['running', 'failed'],
];

const isAllowed = (from: ExecutionStatus, to: ExecutionStatus) =>
  ALLOWED.some(([a, b]) => a === from && b === to);

describe('F3.1 · every transition pair', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const verb = isAllowed(from, to) ? 'allows' : 'refuses';

      it(`${verb} ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(isAllowed(from, to));
      });
    }
  }
});

describe('F3.1 · the transitions that matter', () => {
  it('REFUSES queued → completed', () => {
    /*
     * Every completion passes through `running`, so "how long did it take"
     * always has a start to measure from — and a result that skipped the
     * running state is a result nothing produced.
     */
    expect(() => assertTransition('queued', 'completed')).toThrow(
      IllegalExecutionTransitionError,
    );
  });

  it('allows a job to fail before it ever started', () => {
    // The provider was unreachable at submission time. That is a real path and
    // it must not require pretending the code ran first.
    expect(() => assertTransition('queued', 'failed')).not.toThrow();
  });

  it('NEVER lets a finished job move again', () => {
    for (const terminal of TERMINAL_STATUSES) {
      for (const to of ALL) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it('throws a typed error carrying both states', () => {
    try {
      assertTransition('completed', 'running');
      expect.unreachable('a completed execution must not restart');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalExecutionTransitionError);
      const illegal = error as IllegalExecutionTransitionError;
      expect(illegal.from).toBe('completed');
      expect(illegal.to).toBe('running');
      expect(illegal.status).toBe(409);
    }
  });
});

describe('F3.1 · live and terminal', () => {
  it('splits the statuses with no overlap and nothing left over', () => {
    expect(LIVE_STATUSES.filter((status) => isTerminal(status))).toEqual([]);
    expect(TERMINAL_STATUSES.filter((status) => isLive(status))).toEqual([]);
    expect([...LIVE_STATUSES, ...TERMINAL_STATUSES].sort()).toEqual([...ALL].sort());
  });

  it('counts a queued job as live, which is what the concurrency cap needs', () => {
    // A job waiting to start still occupies one of the user's five slots.
    expect(isLive('queued')).toBe(true);
  });
});
