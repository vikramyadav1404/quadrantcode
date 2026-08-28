/**
 * What the timeline renders, in the client-safe layer.
 *
 * `components/` may not import from `server/` (F0.1) — the same arrangement as
 * every view contract before it.
 */
import type { SessionEventType } from './events';
import type { ExecutionLanguage, ExecutionVerdict } from '../execution/languages';

/** One row of the timeline. */
export type TimelineRowView = {
  id: string;
  type: SessionEventType;
  /** Active milliseconds from the session's start — derived, never stored (D25). */
  elapsedMs: number;
  /** The line the row prints under its label, when there is one worth printing. */
  detail: string | null;
  /** A run's outcome, when this row is a run. */
  run: TimelineRunView | null;
  /** The code as it stood here, and what changed to get to it. */
  snapshot: TimelineSnapshotView | null;
};

export type TimelineRunView = {
  verdict: ExecutionVerdict;
  runtimeMs: number | null;
  memoryKb: number | null;
  /**
   * Program output. **Rendered as a text node and never as markup** — the same
   * rule as `components/editor/RunOutput.tsx`, and for the same reason: these
   * are bytes a user's program wrote.
   */
  stdout: string | null;
  stderr: string | null;
};

export type TimelineSnapshotView = {
  snapshotId: string;
  language: ExecutionLanguage;
  /** The full source at this point, rebuilt from the chain. */
  source: string;
  /** Sentences describing what changed from the previous snapshot. */
  changes: string[];
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
};

export type TimelineView = {
  sessionId: string;
  problemTitle: string;
  problemSlug: string;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  rows: TimelineRowView[];
  /**
   * True when this session captured no snapshots because the user turned
   * capture off. Distinct from "captured none because nothing was run" — the
   * page says which, rather than showing the same emptiness for both.
   */
  captureDisabled: boolean;
};

/**
 * `05:20`, or `1:05:20` past an hour.
 *
 * Floors rather than rounds, matching `formatElapsed` in the timer bar: a
 * timeline that reads ahead of the elapsed time it came from is the kind of
 * discrepancy users notice and cannot explain.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** A short symbol per event. Never the only signal — the label is always words. */
export const EVENT_ICONS: Record<SessionEventType, string> = {
  session_started: '▶',
  paused: '⏸',
  resumed: '▶',
  idle_autopause: '⏸',
  session_completed: '✓',
  session_abandoned: '×',
  stuck_marked: '!',
  statement_viewed: '◇',
  first_keystroke: '⌨',
  code_snapshot: '◆',
  run_attempted: '▷',
  run_failed: '×',
  run_passed: '✓',
  idle_started: '·',
  idle_ended: '·',
};
