/**
 * Running the inference over one real session.
 *
 * The bridge between F3.2's stored telemetry and the pure signals: it loads,
 * shapes, and hands over. Everything that decides anything lives in
 * `signals.ts` and `rank.ts`, which is why they can be tested against invented
 * streams instead of fixtures.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { runAttempts, solveSessions, stuckPoints } from '@/server/db/schema';
import { diffLines, splitLines } from '@/server/services/timeline/diff';
import { loadTimeline } from '@/server/services/timeline/events';
import { reconstructSession } from '@/server/services/timeline/reconstruct';
import { rankRegions } from './rank';
import { runSignals } from './signals';
import type { InferenceInput, InferenceSnapshot, StuckRegion } from './types';

/**
 * Which lines a snapshot changed, relative to the version before it.
 *
 * Derived from the diff rather than stored: `code_snapshots` keeps the diff
 * itself, and the touched lines fall out of walking it. Storing them too would
 * be a second copy of one fact, and D25's argument applies unchanged.
 */
function touchedLines(before: string, after: string): number[] {
  const lines: number[] = [];
  let cursor = 1;

  for (const step of diffLines(before, after)) {
    if (step.op === 'keep') {
      cursor += step.count;
      continue;
    }
    if (step.op === 'remove') {
      for (let offset = 0; offset < step.count; offset += 1) lines.push(cursor + offset);
      cursor += step.count;
      continue;
    }
    // An addition lands at the cursor without consuming the original.
    for (let offset = 0; offset < step.lines.length; offset += 1) lines.push(cursor + offset);
  }

  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * Infer stuck regions for one session.
 *
 * Returns them ranked. Writing is a separate call — a caller that only wants to
 * show the user what we would say should not have to write it first.
 */
export async function inferForSession(
  db: Database,
  input: { userId: string; sessionId: string; now: Date },
): Promise<StuckRegion[]> {
  const [session] = await db
    .select({
      id: solveSessions.id,
      startedAt: solveSessions.startedAt,
      endedAt: solveSessions.endedAt,
    })
    .from(solveSessions)
    .where(and(eq(solveSessions.id, input.sessionId), eq(solveSessions.userId, input.userId)))
    .limit(1);

  if (!session) return [];

  const [events, sources, runs, markers] = await Promise.all([
    loadTimeline(db, {
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      now: input.now,
    }),
    reconstructSession(db, { userId: input.userId, sessionId: session.id }),
    db
      .select({ verdict: runAttempts.verdict, createdAt: runAttempts.createdAt })
      .from(runAttempts)
      .where(eq(runAttempts.sessionId, session.id))
      .orderBy(asc(runAttempts.createdAt)),
    db
      .select({
        elapsedSeconds: stuckPoints.elapsedSeconds,
        category: stuckPoints.category,
      })
      .from(stuckPoints)
      .where(and(eq(stuckPoints.sessionId, session.id), eq(stuckPoints.source, 'user')))
      .orderBy(asc(stuckPoints.elapsedSeconds)),
  ]);

  /*
   * Snapshots carry no elapsed of their own, so they borrow the `code_snapshot`
   * events' — which are derived from the same paused-time arithmetic as
   * everything else (D25). Matched by order, the assumption `detail.ts` already
   * documents.
   */
  const snapshotEvents = events.filter((event) => event.type === 'code_snapshot');

  const snapshots: InferenceSnapshot[] = sources.map((entry, index) => {
    const previous = index > 0 ? sources[index - 1]!.source : '';

    return {
      sequence: entry.sequence,
      elapsedSeconds: Math.round(
        (snapshotEvents[index]?.elapsedMs ??
          entry.occurredAt.getTime() - session.startedAt.getTime()) / 1000,
      ),
      // The first snapshot has nothing before it, so nothing was "changed".
      touchedLines: index === 0 ? [] : touchedLines(previous, entry.source),
      source: entry.source,
    };
  });

  const startedMs = session.startedAt.getTime();

  const shaped: InferenceInput = {
    events: events.map((event) => ({
      type: event.type,
      elapsedSeconds: Math.round(event.elapsedMs / 1000),
    })),
    snapshots,
    runs: runs.map((attempt) => ({
      elapsedSeconds: Math.round((attempt.createdAt.getTime() - startedMs) / 1000),
      passed: attempt.verdict === 'accepted',
    })),
    markers: markers.map((marker) => ({
      elapsedSeconds: marker.elapsedSeconds,
      category: marker.category ?? 'unknown',
    })),
    totalSeconds: Math.round(((session.endedAt ?? input.now).getTime() - startedMs) / 1000),
  };

  return rankRegions(shaped, runSignals(shaped));
}

export { splitLines };
