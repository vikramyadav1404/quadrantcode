/**
 * The solve-session state machine, written out rather than implied.
 *
 *   active ⇄ paused
 *   active → solved | stuck | abandoned
 *   paused → solved | stuck | abandoned
 *   solved, stuck, abandoned → nothing
 *
 * The ticket asks for it to be modelled explicitly, and the reason is that the
 * alternative — an `if` in each handler — makes the whole machine unreadable in
 * one place and lets two handlers disagree about the same rule. Here the table
 * IS the specification, and every handler asks it the same question.
 *
 * Pure: no database, no clock.
 */
import { IllegalTransitionError } from './errors';

export type SessionStatus = 'active' | 'paused' | 'solved' | 'stuck' | 'abandoned';

/** The states a session can still leave. One live session per user means one of these. */
export const LIVE_STATUSES = ['active', 'paused'] as const;

/** The states a session never leaves. A user has as many of these as they have attempts. */
export const TERMINAL_STATUSES = ['solved', 'stuck', 'abandoned'] as const;

/**
 * How a session ends.
 *
 * `abandoned` is here but is not something a user picks lightly — it is also
 * what the sweep writes for a session nobody came back to.
 */
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  /*
   * A pause is not required before finishing. Users press "solved" from a
   * running timer far more often than they pause first, and forcing the extra
   * step would only produce handlers that pause internally to satisfy a rule
   * nobody asked for.
   */
  active: ['paused', 'solved', 'stuck', 'abandoned'],

  /*
   * A paused session can finish directly too: coming back only to press resume
   * and then finish would add a pause interval of a few milliseconds to
   * everyone's history for no reason.
   */
  paused: ['active', 'solved', 'stuck', 'abandoned'],

  solved: [],
  stuck: [],
  abandoned: [],
};

export function isLive(status: SessionStatus): boolean {
  return (LIVE_STATUSES as readonly SessionStatus[]).includes(status);
}

export function isTerminal(status: SessionStatus): boolean {
  return (TERMINAL_STATUSES as readonly SessionStatus[]).includes(status);
}

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Throws unless the transition is allowed.
 *
 * Note that `paused → paused` and `active → active` are both refused. A repeat
 * pause is not harmless: it would append a second `paused` event, and while the
 * duration arithmetic survives that by design, the event log is a record of
 * what happened and a pause that did not happen does not belong in it.
 */
export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
