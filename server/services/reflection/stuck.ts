/**
 * "I'm stuck here", pressed mid-solve.
 *
 * The whole value of a marker is WHEN it was dropped, and that number is
 * computed here from the session's own event log — never accepted from the
 * client. A marker at "12 minutes in" is only comparable with the session total,
 * or with another session's markers, if every one of those numbers came out of
 * the same arithmetic (D20).
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { stuckPoints } from '@/server/db/schema';
import type { StuckCategory } from '@/lib/reflection/taxonomy';
import {
  activeDurationSeconds,
  isLive,
  loadEvents,
  loadOwnedSession,
  recordEvent,
} from '@/server/services/session';
import { SessionNotLiveError } from './errors';

export type StuckMarker = {
  id: string;
  category: StuckCategory;
  elapsedSeconds: number;
  note: string | null;
  createdAt: Date;
};

/**
 * Record a stuck marker against a live session.
 *
 * Allowed while paused as well as while active: the timer bar shows both, the
 * elapsed time is frozen either way, and refusing would mean a user who paused
 * to think — the most likely moment to feel stuck — cannot say so.
 */
export async function markStuck(
  db: Database,
  input: {
    userId: string;
    sessionId: string;
    category: StuckCategory;
    note?: string;
    now: Date;
  },
): Promise<StuckMarker> {
  const { userId, sessionId, category, note, now } = input;

  const session = await loadOwnedSession(db, sessionId, userId);
  if (!isLive(session.status)) throw new SessionNotLiveError();

  const events = await loadEvents(db, sessionId);
  const elapsedSeconds = activeDurationSeconds(
    { startedAt: session.startedAt, endedAt: session.endedAt, events },
    now,
  );

  return db.transaction(async (tx) => {
    const [marker] = await tx
      .insert(stuckPoints)
      .values({
        sessionId,
        category,
        elapsedSeconds,
        note: note?.length ? note : null,
        // F1.5 only ever writes this. F3.3 writes 'inferred' into the same table.
        source: 'user',
      })
      .returning();

    /*
     * The event too, not instead. The row is the queryable record F3.5 counts;
     * the event is what puts the marker in its place on F3.2's timeline,
     * between the run that failed and the pause that followed.
     */
    await recordEvent(tx, {
      sessionId,
      type: 'stuck_marked',
      occurredAt: now,
      payload: { category, elapsedSeconds },
    });

    return {
      id: marker!.id,
      category: marker!.category,
      elapsedSeconds: marker!.elapsedSeconds,
      note: marker!.note,
      createdAt: marker!.createdAt,
    };
  });
}

/** A session's markers, in the order they happened. */
export async function getStuckMarkers(
  db: Database,
  input: { userId: string; sessionId: string },
): Promise<StuckMarker[]> {
  // Through the ownership check rather than around it: a marker list is as
  // private as the session it belongs to.
  await loadOwnedSession(db, input.sessionId, input.userId);

  const rows = await db
    .select({
      id: stuckPoints.id,
      category: stuckPoints.category,
      elapsedSeconds: stuckPoints.elapsedSeconds,
      note: stuckPoints.note,
      createdAt: stuckPoints.createdAt,
    })
    .from(stuckPoints)
    .where(and(eq(stuckPoints.sessionId, input.sessionId), eq(stuckPoints.source, 'user')))
    .orderBy(asc(stuckPoints.elapsedSeconds));

  return rows;
}
