/**
 * Typed errors for reflection capture, in the shape F1.4 established.
 *
 * Ownership failures are NOT here on purpose: they reuse
 * `SessionNotFoundError` from the session service, so "that session is not
 * yours" produces one error with one message everywhere. A second not-found
 * error would eventually differ from the first, and the difference is what an
 * IDOR probe reads.
 */

/**
 * A stuck marker was dropped on a session that has already finished.
 *
 * "I'm stuck here" is a statement about the present — it captures elapsed time
 * at the moment it is pressed. On a finished session there is no present to
 * capture, and accepting one would put a marker at an elapsed time that never
 * happened.
 */
export class SessionNotLiveError extends Error {
  readonly code = 'SESSION_NOT_LIVE' as const;
  readonly status = 409 as const;

  constructor() {
    super('That session has already finished, so there is nothing to mark.');
    this.name = 'SessionNotLiveError';
  }
}

/**
 * A reflection was submitted for a session that is still running, or for one
 * that was abandoned.
 *
 * Abandonment is excluded for the same reason it does not count as an attempt
 * (D20): the user made no claim about how it went, and the sweep abandons
 * sessions on their behalf. A reflection attached to one would be a considered
 * account of a solve that never concluded.
 */
export class SessionNotReflectableError extends Error {
  readonly code = 'SESSION_NOT_REFLECTABLE' as const;
  readonly status = 409 as const;

  constructor(readonly status_: string) {
    super(
      status_ === 'abandoned'
        ? 'An abandoned session has no outcome to reflect on.'
        : 'Finish the session before reflecting on it.',
    );
    this.name = 'SessionNotReflectableError';
  }
}
