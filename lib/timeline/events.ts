/**
 * F3.2 · the solve-timeline taxonomy, declared once.
 *
 * The `pgEnum` in `server/db/schema/enums.ts` is built from this array, the
 * timeline renders from these labels, and nothing re-types either list — the
 * same arrangement as `lib/reflection/taxonomy.ts` (**D21**) and
 * `lib/execution/languages.ts`. A second hand-written copy eventually differs
 * from this one, and the symptom is an event type the UI knows about and
 * Postgres rejects.
 *
 * It lives in `lib/` because the timeline UI needs the labels and `components/`
 * may not import from `server/` (F0.1).
 */

/**
 * Every event that can appear in a session's log.
 *
 * The first seven are F1.4's and F1.5's, unchanged. F3.2 adds the rest, which
 * is why the enum was written as "designed to be extended, not replaced" —
 * these are new values, not renames of rows that already exist.
 *
 * ## `hint_requested` is deliberately absent
 *
 * F3.2's spec names it. It belongs to F3.4 (`ai-gateway`), which is **cut**, so
 * nothing in this build can ever write one. An enum value no code path can
 * reach is the "dead code that looks handled" this project has refused before:
 * it makes the taxonomy read as though hints are captured and merely unused,
 * when in fact hints do not exist. It goes in when something asks for one.
 */
export const SESSION_EVENT_TYPES = [
  'session_started',
  'paused',
  'resumed',
  'idle_autopause',
  'session_completed',
  'session_abandoned',
  'stuck_marked',
  /** The problem was put in front of the user — for an external problem, the page carrying the link (C1). */
  'statement_viewed',
  /** The first edit of the session. Fires once; the gap before it is a signal F3.3 reads. */
  'first_keystroke',
  'code_snapshot',
  'run_attempted',
  'run_failed',
  'run_passed',
  /**
   * A gap in activity the user did not declare.
   *
   * Distinct from `idle_autopause`, which is the SERVER deciding a session had
   * been abandoned long enough to pause. An idle period is observed and
   * recorded; an autopause changes the session's state. Collapsing them would
   * lose which one happened, and F3.3's "idle after a failed run" signal reads
   * the first while the duration arithmetic reads the second.
   */
  'idle_started',
  'idle_ended',
] as const;

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

/** What the timeline prints for each. Sentence case, no jargon, no invented certainty. */
export const SESSION_EVENT_LABELS: Record<SessionEventType, string> = {
  session_started: 'Started',
  paused: 'Paused',
  resumed: 'Resumed',
  idle_autopause: 'Paused automatically — no activity',
  session_completed: 'Completed',
  session_abandoned: 'Abandoned',
  stuck_marked: 'Marked stuck',
  statement_viewed: 'Opened the problem',
  first_keystroke: 'First code written',
  code_snapshot: 'Code changed',
  run_attempted: 'Ran the code',
  run_failed: 'Run failed',
  run_passed: 'Run passed',
  idle_started: 'Went quiet',
  idle_ended: 'Came back',
};

/**
 * Why a snapshot was taken.
 *
 * Stored rather than inferred because F3.3 weighs them differently: a snapshot
 * taken because the user pressed "I'm stuck" is evidence about that moment,
 * while one taken because sixty seconds elapsed is evidence of nothing in
 * particular.
 */
export const SNAPSHOT_TRIGGERS = ['run_attempt', 'stuck_marker', 'interval'] as const;

export type SnapshotTrigger = (typeof SNAPSHOT_TRIGGERS)[number];

/** Snapshots are taken at most this often when nothing else forces one. */
export const SNAPSHOT_INTERVAL_MS = 60_000;

/** How long a snapshot is kept. The privacy copy states this number (F3.2b). */
export const SNAPSHOT_RETENTION_DAYS = 90;

export function isSessionEventType(value: string): value is SessionEventType {
  return (SESSION_EVENT_TYPES as readonly string[]).includes(value);
}
