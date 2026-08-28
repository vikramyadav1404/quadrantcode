/**
 * What the signals read, and what they produce.
 *
 * Kept apart from the signals themselves so the synthetic streams in the tests
 * can be built against a type rather than against a database.
 */
import type { SessionEventType } from '@/lib/timeline/events';
import type { StuckConfidence } from '@/lib/inference/confidence';

/** One event, reduced to what any signal actually needs. */
export type InferenceEvent = {
  type: SessionEventType;
  /** Active seconds from the start of the session — F3.2's derived elapsed. */
  elapsedSeconds: number;
};

/** One snapshot, with the lines it changed relative to the version before it. */
export type InferenceSnapshot = {
  sequence: number;
  elapsedSeconds: number;
  /** 1-based, inclusive. Empty when the snapshot changed nothing. */
  touchedLines: number[];
  /** The reconstructed source, for the excerpt a region carries. */
  source: string;
};

/** One run, and whether it worked. */
export type InferenceRun = {
  elapsedSeconds: number;
  passed: boolean;
};

/** A marker the user dropped themselves. Always outranks anything inferred. */
export type InferenceMarker = {
  elapsedSeconds: number;
  category: string;
};

export type InferenceInput = {
  events: readonly InferenceEvent[];
  snapshots: readonly InferenceSnapshot[];
  runs: readonly InferenceRun[];
  markers: readonly InferenceMarker[];
  /** Total active seconds, used to clamp an open-ended region. */
  totalSeconds: number;
};

/**
 * A region a signal thinks is worth showing the user.
 *
 * `evidence` is a list of sentences, not a score. The ticket's presentation
 * rule is that every inferred point is editable, and a user cannot sensibly
 * agree or disagree with a number.
 */
export type StuckRegion = {
  lineStart: number;
  lineEnd: number;
  startedSeconds: number;
  endedSeconds: number;
  durationSeconds: number;
  confidence: StuckConfidence;
  evidence: string[];
  /** The lines themselves, for the panel. Empty when nothing was captured. */
  codeSnippet: string;
  /** Which signals contributed. Used for ranking, and to merge overlaps. */
  signals: SignalName[];
};

export const SIGNAL_NAMES = [
  'user_marker',
  'edit_locality',
  'edit_churn',
  'failure_cluster',
  'idle_after_failure',
] as const;

export type SignalName = (typeof SIGNAL_NAMES)[number];

/** What one signal returns before ranking and merging. */
export type SignalHit = Omit<StuckRegion, 'confidence' | 'codeSnippet' | 'signals'> & {
  signal: SignalName;
  confidence: StuckConfidence;
};
