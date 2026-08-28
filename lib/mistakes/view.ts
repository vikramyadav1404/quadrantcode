/**
 * What the mistakes panel and the monthly report render.
 *
 * `components/` may not import from `server/` (F0.1).
 */
import type { MistakeTrend } from './trends';

export type PatternView = {
  category: string;
  topic: string | null;
  occurrences: number;
  confirmedStuckCount: number;
  trend: MistakeTrend;
  lastSeenOn: Date;
};

export type RecommendationView = {
  topic: string | null;
  category: string;
  count: number;
  /** One sentence. Never absent — the explainability rule (F3.5). */
  reason: string;
};

/** `off_by_one` → `Off by one`. */
export function readableCategory(category: string): string {
  const words = category.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `4 Aug`, in the reader's own reading rather than an ISO string. */
export function formatSeen(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
