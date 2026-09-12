/**
 * Typed errors for the solve-session lifecycle.
 *
 * The ticket's requirement is explicit: an illegal transition returns a typed
 * error, **not a no-op**. A no-op is the failure mode worth naming — the caller
 * believes the pause landed, the timer keeps running, and nothing anywhere says
 * otherwise until the user notices their elapsed time is wrong.
 *
 * Each error carries a `status`, the same shape the catalog's errors use, so a
 * route adapter maps it without a switch on message text.
 */
import type { SessionStatus } from './state';

/**
 * A second session was started while one was still live.
 *
 * Carries the existing session so the UI can offer the choice the ticket
 * requires — finish it or abandon it — rather than a dead end. **Never
 * silently reassign**: the running session is work the user chose to start.
 */
export class ActiveSessionExistsError extends Error {
  readonly code = 'ACTIVE_SESSION_EXISTS' as const;
  readonly status = 409 as const;

  constructor(readonly existing: { id: string; problemId: string; status: SessionStatus }) {
    super(
      'You already have a session in progress. Finish or abandon it before starting another.',
    );
    this.name = 'ActiveSessionExistsError';
  }
}

/** A transition the state machine does not allow. */
export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION' as const;
  readonly status = 409 as const;

  constructor(
    readonly from: SessionStatus,
    readonly to: SessionStatus,
  ) {
    super(`A ${from} session cannot become ${to}.`);
    this.name = 'IllegalTransitionError';
  }
}

/**
 * No such session for this user.
 *
 * Deliberately the same error whether the id does not exist or belongs to
 * someone else: distinguishing them would confirm that an id is real to a user
 * who has no business knowing (the IDOR check F4.8 makes explicit).
 */
export class SessionNotFoundError extends Error {
  readonly code = 'SESSION_NOT_FOUND' as const;
  readonly status = 404 as const;

  constructor() {
    super('That session no longer exists.');
    this.name = 'SessionNotFoundError';
  }
}
