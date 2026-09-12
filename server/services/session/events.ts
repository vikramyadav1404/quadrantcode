/**
 * Reading and appending session events.
 *
 * Deliberately the only place that writes to `session_events`, and it only ever
 * inserts. Nothing updates or deletes a row: the duration arithmetic treats the
 * log as a record of what happened, and F3.2 makes that enforceable at the
 * database rather than by convention.
 */
import { asc, eq } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { type SessionEvent, sessionEvents } from '@/server/db/schema';
import type { DurationEvent } from './duration';

/** Either a pool or an open transaction — every writer here runs inside one. */
type Writer = Database | Transaction;

/**
 * Append one event.
 *
 * `occurredAt` is required rather than defaulted, because the one case that
 * matters most gets it wrong by default: an idle autopause happened when the
 * heartbeats stopped, not when the sweep noticed. Making the caller state the
 * instant means nobody reaches for `now` without deciding.
 */
export async function recordEvent(
  writer: Writer,
  input: {
    sessionId: string;
    type: SessionEvent['type'];
    occurredAt: Date;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await writer.insert(sessionEvents).values({
    sessionId: input.sessionId,
    type: input.type,
    occurredAt: input.occurredAt,
    payload: input.payload ?? {},
  });
}

/** Every event for a session, oldest first — what the duration arithmetic reads. */
export async function loadEvents(db: Database, sessionId: string): Promise<DurationEvent[]> {
  return db
    .select({ type: sessionEvents.type, occurredAt: sessionEvents.occurredAt })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(asc(sessionEvents.occurredAt));
}
