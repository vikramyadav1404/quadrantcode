/**
 * What the stuck-regions panel renders.
 *
 * `components/` may not import from `server/` (F0.1), so the shapes and the
 * wording live here — beside `confidence.ts`, which holds the labels that keep
 * every sentence hedged (**C4**).
 */
import type { StuckConfidence, StuckStatus } from './confidence';

export type StuckRegionView = {
  id: string;
  /** 'user' when the person marked it themselves, 'inferred' when we guessed. */
  source: 'user' | 'inferred';
  status: StuckStatus;
  confidence: StuckConfidence;
  /** Null for a user marker — F1.5 records one without asking where. */
  lineStart: number | null;
  lineEnd: number | null;
  startedSeconds: number;
  durationSeconds: number;
  /** The sentences behind the label. Never a bare score. */
  evidence: string[];
  /** The user's own words, when they left any. */
  note: string | null;
  /** Their own category, when they chose one. */
  category: string | null;
};

/** `4m20s`, matching the evidence sentences the signals write. */
export function formatSpan(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m${String(rest).padStart(2, '0')}s`;
}
