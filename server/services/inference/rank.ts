/**
 * Turning signal hits into a ranked, merged list of regions.
 *
 * Two things happen here, and both are about not showing the user noise:
 *
 * 1. **Overlapping regions merge.** Churn and locality frequently find the same
 *    stretch of code, and presenting them as two findings would double-count one
 *    struggle. A merged region carries the evidence from both, which is more
 *    convincing than either alone rather than twice as loud.
 *
 * 2. **User markers always rank first**, and never merge into anything. What the
 *    user said is not a stronger version of what we inferred; it is a different
 *    kind of statement, and burying it under a "high confidence" inference would
 *    be this feature telling someone they were wrong about themselves.
 */
import { confidenceRank, type StuckConfidence } from '@/lib/inference/confidence';
import { REGION_MAX_SPAN, REGION_RADIUS } from './signals';
import type { InferenceInput, SignalHit, SignalName, StuckRegion } from './types';

/** Most regions a session will show. Beyond this it stops being a signal. */
export const MAX_REGIONS = 6;

/**
 * Two hits describe the same place when their ranges are within a radius **and**
 * merging them would not produce something too wide to be a region.
 *
 * The span check is not belt-and-braces. Without it, merging is transitive by
 * accident: 1–7 overlaps 8–14 overlaps 15–21, and a chain of adjacent regions
 * collapses into one finding covering the whole file — which is exactly what
 * the "typed continuously" adversarial case produced, even after the signals
 * themselves were bounded.
 */
function overlaps(a: SignalHit, b: SignalHit): boolean {
  const adjacent =
    a.lineStart - REGION_RADIUS <= b.lineEnd && b.lineStart - REGION_RADIUS <= a.lineEnd;
  if (!adjacent) return false;

  const width = Math.max(a.lineEnd, b.lineEnd) - Math.min(a.lineStart, b.lineStart);
  return width < REGION_MAX_SPAN;
}

/**
 * The stronger of two confidences.
 *
 * Merging raises confidence to the best contributor rather than averaging: two
 * independent signals agreeing is more evidence, not less, and averaging would
 * let a weak signal drag down a strong one it happens to sit beside.
 */
function stronger(a: StuckConfidence, b: StuckConfidence): StuckConfidence {
  return confidenceRank(a) <= confidenceRank(b) ? a : b;
}

/** The lines a region covers, from the reconstructed source. */
function excerpt(input: InferenceInput, lineStart: number, lineEnd: number): string {
  const latest = input.snapshots.at(-1);
  if (!latest || lineStart < 1) return '';

  const lines = latest.source.split('\n');
  return lines.slice(lineStart - 1, lineEnd).join('\n');
}

/**
 * Rank and merge.
 *
 * Deterministic throughout: the sort has an explicit tiebreak chain and no two
 * regions can compare equal, so the same session always produces the same list
 * in the same order — which the UI needs, because a list that reshuffles between
 * loads is one nobody trusts.
 */
export function rankRegions(input: InferenceInput, hits: readonly SignalHit[]): StuckRegion[] {
  const markers = hits.filter((hit) => hit.signal === 'user_marker');
  const inferred = hits.filter((hit) => hit.signal !== 'user_marker');

  const merged: {
    hit: SignalHit;
    signals: SignalName[];
    evidence: string[];
    confidence: StuckConfidence;
  }[] = [];

  for (const hit of inferred) {
    const existing = merged.find((candidate) => overlaps(candidate.hit, hit));

    if (!existing) {
      merged.push({
        hit,
        signals: [hit.signal],
        evidence: [...hit.evidence],
        confidence: hit.confidence,
      });
      continue;
    }

    existing.hit = {
      ...existing.hit,
      lineStart: Math.min(existing.hit.lineStart, hit.lineStart),
      lineEnd: Math.max(existing.hit.lineEnd, hit.lineEnd),
      startedSeconds: Math.min(existing.hit.startedSeconds, hit.startedSeconds),
      endedSeconds: Math.max(existing.hit.endedSeconds, hit.endedSeconds),
    };
    existing.hit.durationSeconds = existing.hit.endedSeconds - existing.hit.startedSeconds;
    if (!existing.signals.includes(hit.signal)) existing.signals.push(hit.signal);
    existing.evidence.push(...hit.evidence);
    existing.confidence = stronger(existing.confidence, hit.confidence);
  }

  const regions: StuckRegion[] = [
    ...markers.map((hit) => ({
      lineStart: hit.lineStart,
      lineEnd: hit.lineEnd,
      startedSeconds: hit.startedSeconds,
      endedSeconds: hit.endedSeconds,
      durationSeconds: hit.durationSeconds,
      confidence: hit.confidence,
      evidence: [...hit.evidence],
      codeSnippet: '',
      signals: ['user_marker' as SignalName],
    })),
    ...merged.map((entry) => ({
      lineStart: entry.hit.lineStart,
      lineEnd: entry.hit.lineEnd,
      startedSeconds: entry.hit.startedSeconds,
      endedSeconds: entry.hit.endedSeconds,
      durationSeconds: entry.hit.durationSeconds,
      confidence: entry.confidence,
      evidence: entry.evidence,
      codeSnippet: excerpt(input, entry.hit.lineStart, entry.hit.lineEnd),
      signals: entry.signals,
    })),
  ];

  return regions
    .sort(
      (a, b) =>
        // What the user said, then how sure, then how long, then position —
        // four keys so nothing is left to the sort's stability.
        confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
        b.durationSeconds - a.durationSeconds ||
        a.startedSeconds - b.startedSeconds ||
        a.lineStart - b.lineStart,
    )
    .slice(0, MAX_REGIONS);
}
