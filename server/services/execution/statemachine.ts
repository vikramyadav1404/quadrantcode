/**
 * Where an execution is, written out rather than implied.
 *
 *   queued → running → completed
 *   queued → failed          (the provider was never reached)
 *   running → failed         (it was reached and then something broke)
 *   completed, failed → nothing
 *
 * The ticket asks for the machine to be explicit and for illegal transitions to
 * be rejected server-side. The reason is the one F1.4 gives for sessions: a
 * no-op looks like success to the caller, and here that means a job reported
 * "completed" that never ran.
 *
 * **`queued → completed` is refused deliberately.** Every completion passes
 * through `running`, so "how long did it actually take" always has a start to
 * measure from — and a result that skipped the running state is a result
 * nothing produced.
 *
 * Pure: no clock, no database.
 */

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed';

export const LIVE_STATUSES = ['queued', 'running'] as const;
export const TERMINAL_STATUSES = ['completed', 'failed'] as const;

const TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  queued: ['running', 'failed'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export class IllegalExecutionTransitionError extends Error {
  readonly code = 'ILLEGAL_EXECUTION_TRANSITION' as const;
  readonly status = 409 as const;

  constructor(
    readonly from: ExecutionStatus,
    readonly to: ExecutionStatus,
  ) {
    super(`An execution that is ${from} cannot become ${to}.`);
    this.name = 'IllegalExecutionTransitionError';
  }
}

export function isLive(status: ExecutionStatus): boolean {
  return (LIVE_STATUSES as readonly ExecutionStatus[]).includes(status);
}

export function isTerminal(status: ExecutionStatus): boolean {
  return (TERMINAL_STATUSES as readonly ExecutionStatus[]).includes(status);
}

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!canTransition(from, to)) throw new IllegalExecutionTransitionError(from, to);
}
