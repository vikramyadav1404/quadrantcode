/**
 * F3.5 · the trend vocabulary, declared once.
 *
 * `server/services/mistakes/trend.ts` imports these values and the `pgEnum` is
 * built from them, the same arrangement as the reflection taxonomy (**D21**),
 * the execution languages and the timeline events.
 *
 * It lives in `lib/` because the panel needs the labels and `components/` may
 * not import from `server/` (F0.1). The first draft of this file re-declared
 * the array with a comment explaining why that was acceptable — it was not, and
 * a second copy is exactly what D21 exists to prevent.
 */
export const MISTAKE_TRENDS = ['improving', 'flat', 'worsening'] as const;

export type MistakeTrend = (typeof MISTAKE_TRENDS)[number];

/** Plain, and never congratulatory — the panel reports, it does not cheer. */
export const TREND_LABELS: Record<MistakeTrend, string> = {
  improving: 'less often lately',
  flat: 'about the same',
  worsening: 'more often lately',
};
