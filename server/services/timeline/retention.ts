/**
 * Purging snapshots on a schedule, and deleting a user's solve history on
 * request.
 *
 * ## The append-only log has to be deletable, and that is not a contradiction
 *
 * `session_events` refuses UPDATE and DELETE at the database level — that is
 * F3.2's first criterion. Its fourth criterion says "delete my solve history"
 * must leave no event rows. Both are real requirements and they meet here.
 *
 * The trigger therefore refuses a mutation **unless a session-local flag is
 * set**, and this file is the only place that sets it. That is not the same as
 * enforcing by convention: without the flag, no code path, no psql session and
 * no accidental `DELETE` can remove a row. Setting it is a deliberate statement
 * inside a transaction that exists to erase data the user asked to erase.
 *
 * `set_config(..., true)` scopes the flag to the transaction, so it cannot leak
 * into the next statement on a pooled connection.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { codeSnapshots, sessionEvents, solveSessions } from '@/server/db/schema';
import { SNAPSHOT_RETENTION_DAYS } from '@/lib/timeline/events';

/** The flag the append-only trigger checks. Named once, here. */
export const PURGE_FLAG = 'quadrantcode.purging';

/**
 * Permit deletion for the rest of this transaction.
 *
 * Takes a transaction rather than the pool on purpose: `set_config(_, true)` is
 * transaction-scoped, and calling it outside one would set a flag that applies
 * to a single statement nobody controls.
 */
async function allowDeletion(tx: Transaction): Promise<void> {
  await tx.execute(sql`select set_config(${PURGE_FLAG}, 'on', true)`);
}

/**
 * Drop snapshots older than the retention window.
 *
 * Events are NOT purged with them. A snapshot is the user's code; an event is
 * the fact that something happened at a time, which is what the timeline, the
 * streak and the analytics rollups are built from. Ninety days of retention is
 * a promise about storing code, and quietly erasing the history alongside it
 * would break features the user never asked to switch off.
 */
export async function purgeExpiredSnapshots(
  db: Database,
  now: Date,
): Promise<{ deleted: number; before: Date }> {
  const cutoff = new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const deleted = await db
    .delete(codeSnapshots)
    .where(lt(codeSnapshots.createdAt, cutoff))
    .returning({ id: codeSnapshots.id });

  return { deleted: deleted.length, before: cutoff };
}

/**
 * Erase everything this project recorded about HOW this user solved.
 *
 * Snapshots and events, for every session they own. The sessions themselves
 * stay: "delete my solve history" is about the telemetry, and removing the
 * sessions would silently rewrite their streak, their analytics and their
 * revision schedule — a much larger deletion than the one that was asked for.
 * The privacy copy (F3.2b) says exactly this.
 */
export async function deleteSolveHistory(
  db: Database,
  input: { userId: string },
): Promise<{ snapshots: number; events: number }> {
  return db.transaction(async (tx) => {
    await allowDeletion(tx);

    const snapshots = await tx
      .delete(codeSnapshots)
      .where(eq(codeSnapshots.userId, input.userId))
      .returning({ id: codeSnapshots.id });

    /*
     * Events carry no user_id — they belong to a session, which belongs to a
     * user. Scoping through the session rather than denormalising a column that
     * only this one query would read.
     */
    const owned = tx
      .select({ id: solveSessions.id })
      .from(solveSessions)
      .where(eq(solveSessions.userId, input.userId));

    const events = await tx
      .delete(sessionEvents)
      .where(inArray(sessionEvents.sessionId, owned))
      .returning({ id: sessionEvents.id });

    return { snapshots: snapshots.length, events: events.length };
  });
}

/**
 * Erase the telemetry for one session.
 *
 * Same rules, narrower scope — offered from the timeline page so a user can
 * drop one sitting without dropping everything.
 */
export async function deleteSessionHistory(
  db: Database,
  input: { userId: string; sessionId: string },
): Promise<{ snapshots: number; events: number } | null> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: solveSessions.id })
      .from(solveSessions)
      .where(and(eq(solveSessions.id, input.sessionId), eq(solveSessions.userId, input.userId)))
      .limit(1);

    // Not theirs, or not there. Indistinguishable, deliberately.
    if (!session) return null;

    await allowDeletion(tx);

    const snapshots = await tx
      .delete(codeSnapshots)
      .where(eq(codeSnapshots.sessionId, input.sessionId))
      .returning({ id: codeSnapshots.id });

    const events = await tx
      .delete(sessionEvents)
      .where(eq(sessionEvents.sessionId, input.sessionId))
      .returning({ id: sessionEvents.id });

    return { snapshots: snapshots.length, events: events.length };
  });
}
