/**
 * Assembling one session's timeline.
 *
 * The read side: events, the runs that happened during them, and the code as it
 * stood at each snapshot — joined into the shape the page renders.
 *
 * ## Snapshots are reconstructed once, not per row
 *
 * `reconstructSession` walks the chain a single time and hands back every
 * version. Calling `reconstruct` per snapshot would replay the chain from the
 * base for each one, which is O(n²) on the exact page most likely to have a
 * long chain.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { problems, runAttempts, solveSessions } from '@/server/db/schema';
import type { TimelineRowView, TimelineView } from '@/lib/timeline/view';
import { snapshotCaptureEnabled } from '@/server/services/profile';
import { loadTimeline } from './events';
import { reconstructSession } from './reconstruct';
import { describeChange, summariseDiff } from './summarise';

/**
 * The whole timeline for one session, or null if it is not this user's.
 *
 * Null rather than a throw for a session that exists but belongs to someone
 * else — the page turns it into a 404, so an id is never confirmed to a
 * stranger.
 */
export async function getTimeline(
  db: Database,
  input: { userId: string; sessionId: string; now: Date },
): Promise<TimelineView | null> {
  const [session] = await db
    .select({
      id: solveSessions.id,
      status: solveSessions.status,
      startedAt: solveSessions.startedAt,
      endedAt: solveSessions.endedAt,
      problemTitle: problems.title,
      problemSlug: problems.slug,
    })
    .from(solveSessions)
    .innerJoin(problems, eq(problems.id, solveSessions.problemId))
    .where(and(eq(solveSessions.id, input.sessionId), eq(solveSessions.userId, input.userId)))
    .limit(1);

  if (!session) return null;

  const [events, snapshots, runs, captureEnabled] = await Promise.all([
    loadTimeline(db, {
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      now: input.now,
    }),
    reconstructSession(db, { userId: input.userId, sessionId: session.id }),
    db
      .select({
        verdict: runAttempts.verdict,
        runtimeMs: runAttempts.runtimeMs,
        memoryKb: runAttempts.memoryKb,
        stdout: runAttempts.stdout,
        stderr: runAttempts.stderr,
        createdAt: runAttempts.createdAt,
      })
      .from(runAttempts)
      .where(eq(runAttempts.sessionId, session.id))
      .orderBy(asc(runAttempts.createdAt)),
    snapshotCaptureEnabled(db, input.userId),
  ]);

  /*
   * Snapshots and runs are attached to events by ORDER, not by a foreign key.
   *
   * Neither `session_events` nor `run_attempts` carries a snapshot id — the
   * event log was F1.4's and predates both. Within one session the nth run
   * event is the nth run row, because both are appended by the same code path
   * in the same order.
   *
   * That is a real assumption and it is written here rather than left implicit.
   * It holds while runs are the only thing that triggers a snapshot from the
   * editor; F3.3, which will want to point at a specific snapshot, should add
   * the id to the event payload rather than lean on this.
   */
  let runIndex = 0;
  let snapshotIndex = 0;

  const rows: TimelineRowView[] = events.map((event) => {
    let run: TimelineRowView['run'] = null;
    let snapshot: TimelineRowView['snapshot'] = null;

    if (
      event.type === 'run_attempted' ||
      event.type === 'run_passed' ||
      event.type === 'run_failed'
    ) {
      const attempt = runs[runIndex];
      if (attempt) {
        run = {
          verdict: attempt.verdict,
          runtimeMs: attempt.runtimeMs,
          memoryKb: attempt.memoryKb,
          stdout: attempt.stdout,
          stderr: attempt.stderr,
        };
        runIndex += 1;
      }
    }

    if (event.type === 'code_snapshot') {
      const current = snapshots[snapshotIndex];
      if (current) {
        const previous = snapshotIndex > 0 ? snapshots[snapshotIndex - 1] : null;

        const summary = previous
          ? summariseDiff(previous.source, current.source, current.language)
          : { linesAdded: 0, linesRemoved: 0, linesModified: 0, changes: [] };

        snapshot = {
          snapshotId: current.snapshotId,
          language: current.language,
          source: current.source,
          changes: summary.changes.map(describeChange),
          linesAdded: summary.linesAdded,
          linesRemoved: summary.linesRemoved,
          linesModified: summary.linesModified,
        };
        snapshotIndex += 1;
      }
    }

    return {
      id: event.id,
      type: event.type,
      elapsedMs: event.elapsedMs,
      detail: detailFor(event.type, event.payload),
      run,
      snapshot,
    };
  });

  return {
    sessionId: session.id,
    problemTitle: session.problemTitle,
    problemSlug: session.problemSlug,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    rows,
    /*
     * "No snapshots, and capture is off" is a different fact from "no snapshots,
     * and nothing was run". The page says which rather than showing one silence
     * for both.
     */
    captureDisabled: !captureEnabled && snapshots.length === 0,
  };
}

/**
 * The one extra line a row prints, from its payload.
 *
 * Only fields the event actually carries. Nothing is invented for a row that
 * has nothing to add.
 */
function detailFor(
  type: TimelineRowView['type'],
  payload: Record<string, unknown>,
): string | null {
  if (type === 'stuck_marked') {
    const category = payload['category'];
    return typeof category === 'string' ? `Category: ${category.replace(/_/g, ' ')}` : null;
  }

  if (type === 'idle_autopause') {
    const seconds = payload['idleSeconds'];
    return typeof seconds === 'number'
      ? `No activity for ${Math.round(seconds / 60)} minutes`
      : null;
  }

  if (type === 'session_abandoned') {
    return payload['reason'] === 'swept' ? 'Closed by the server' : null;
  }

  return null;
}
