/**
 * What the v2 session strip shows about ONE live sitting (step C2), and nothing
 * more.
 *
 * ## Why this exists beside `getTimeline`
 *
 * `getTimeline` (detail.ts) is the session page's read: it rebuilds every code
 * snapshot from its diff chain and loads each run's stdout and stderr. That is
 * the right cost for a page opened on purpose and the wrong one for a strip
 * rendered on every /solve request — production has already seen a 504
 * FUNCTION_INVOCATION_TIMEOUT. This is the approved light read: one ownership
 * check, one events query, no snapshots, no run output.
 *
 * ## Verdicts come from the event, not from `run_attempts`
 *
 * `run_attempted` is written by the execution pipeline in the SAME transaction
 * as the attempt row, at the moment the run completes, and carries the verdict
 * in its payload (`server/services/execution/pipeline.ts`). So the strip
 * already has it without a join.
 *
 * Code snapshots are left out: one is written per run, and the strip shows the
 * run itself.
 *
 * Read-only. Returns null for a session that is not the caller's, so an id is
 * never confirmed to a stranger (the same rule as `getTimeline`).
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { type SessionEvent, sessionEvents, solveSessions } from '@/server/db/schema';
import type { StripEventView } from '@/lib/solve-v2/strip-view';
import { elapsedMsFor } from './events';

/** The client-safe shape (`lib/solve-v2/strip-view.ts`), with the enum type kept. */
export type StripEvent = StripEventView & { type: SessionEvent['type'] };

export async function getSessionStrip(
  db: Database,
  input: { userId: string; sessionId: string; now: Date },
): Promise<StripEvent[] | null> {
  const [session] = await db
    .select({ startedAt: solveSessions.startedAt, endedAt: solveSessions.endedAt })
    .from(solveSessions)
    .where(and(eq(solveSessions.id, input.sessionId), eq(solveSessions.userId, input.userId)))
    .limit(1);

  if (!session) return null;

  const rows = await db
    .select({
      id: sessionEvents.id,
      type: sessionEvents.type,
      occurredAt: sessionEvents.occurredAt,
      payload: sessionEvents.payload,
    })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, input.sessionId),
        ne(sessionEvents.type, 'code_snapshot'),
      ),
    )
    .orderBy(asc(sessionEvents.occurredAt));

  const elapsed = elapsedMsFor(
    { startedAt: session.startedAt, endedAt: session.endedAt, events: rows },
    input.now,
  );

  return rows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const text = (key: string) =>
      typeof payload[key] === 'string' ? (payload[key] as string) : null;

    return {
      id: row.id,
      type: row.type,
      elapsedSeconds: Math.floor((elapsed.get(row) ?? 0) / 1000),
      verdict: row.type === 'run_attempted' ? text('verdict') : null,
      category: row.type === 'stuck_marked' ? text('category') : null,
    };
  });
}
