import { and, asc, eq, sql } from 'drizzle-orm';
import type { Transaction } from '@/server/db';
import { sessionEvents, solveSessions } from '@/server/db/schema';
import { activeDurationSeconds } from './duration';

/**
 * What a solve was actually like, for the revision ladder.
 *
 * These lived inside `lifecycle.ts` as private helpers, which meant only the
 * manual "Solved" path could reach them. `applyVerifiedSubmissionEffectsTx`
 * therefore scheduled revisions from placeholders — `failedAttempts: 0` and
 * `activeSeconds = estimatedSeconds` — and the ladder's arithmetic made that
 * worse than it looks: with those values NO rule can fire, so every accepted
 * Submit stepped the ladder by exactly zero regardless of how the solve went.
 *
 * Shared from here so both paths read the same facts from the same tables.
 */

/** How many sittings on this problem ended `stuck` — the ladder's own signal. */
export async function countStuckAttempts(
  tx: Transaction,
  userId: string,
  problemId: string,
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(solveSessions)
    .where(
      and(
        eq(solveSessions.userId, userId),
        eq(solveSessions.problemId, problemId),
        eq(solveSessions.status, 'stuck'),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Active seconds on a live session, paused time removed.
 *
 * `null` when there is no session — a Submit from the editor outside a timed
 * sitting is legitimate, and has no duration to report. Callers must treat that
 * as "unknown", never as zero: zero is a *fast* solve to the ladder, so
 * defaulting would hand every untimed submission the best possible signal.
 */
export async function activeSecondsForSession(
  tx: Transaction,
  sessionId: string | null,
  now: Date,
): Promise<number | null> {
  if (!sessionId) return null;

  const [session] = await tx
    .select({ startedAt: solveSessions.startedAt, endedAt: solveSessions.endedAt })
    .from(solveSessions)
    .where(eq(solveSessions.id, sessionId))
    .limit(1);
  if (!session) return null;

  /*
   * The same query as `loadEvents`, inlined because that one takes a Database
   * and this runs inside a transaction — the two types are not interchangeable
   * in drizzle. Widening the shared signature to accept both would touch every
   * existing caller to serve one new one.
   */
  const events = await tx
    .select({ type: sessionEvents.type, occurredAt: sessionEvents.occurredAt })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(asc(sessionEvents.occurredAt));

  return activeDurationSeconds(
    { startedAt: session.startedAt, endedAt: session.endedAt, events },
    now,
  );
}
