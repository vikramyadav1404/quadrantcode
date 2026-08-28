/**
 * The two things that close a session nobody is attending.
 *
 * ## There is no scheduler, and there will not be one
 *
 * The ticket calls for "a background job" to auto-close abandoned sessions.
 * F2.3 is cut (**D17**), so nothing runs on a timer. Instead:
 *
 *   - the request path closes the CURRENT user's stale session, which it can do
 *     for free because it has already loaded that session to render the timer
 *   - `npm run sessions:sweep` closes everyone else's, on demand
 *
 * What that costs, stated rather than implied: a session belonging to a user
 * who never comes back stays live until someone runs the script. It blocks
 * nothing — their own next session sweeps it first — and it distorts nothing
 * except a count of live sessions.
 *
 * ## Both stamp the past, not the present
 *
 * A user who closed their laptop stopped working when their heartbeats stopped.
 * Recording either event when the server noticed would hand them every minute
 * in between — up to six hours of it for the abandonment. So the autopause and
 * the abandonment are both stamped `last_heartbeat_at`.
 */
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { solveSessions, users } from '@/server/db/schema';
import { localDateFor } from '@/server/services/streak';
import { recordEvent } from './events';
import { LIVE_STATUSES, type SessionStatus } from './state';

/** No heartbeat for this long and the session is paused where the user left it. */
export const IDLE_TIMEOUT_SECONDS = 5 * 60;

/** No heartbeat for this long and the session is closed as abandoned. */
export const ABANDON_AFTER_SECONDS = 6 * 60 * 60;

/** The fields the sweeps need. Anything else on the row is irrelevant here. */
export type SweepableSession = {
  id: string;
  status: SessionStatus;
  lastHeartbeatAt: Date;
};

export function isIdle(session: { lastHeartbeatAt: Date }, now: Date): boolean {
  return now.getTime() - session.lastHeartbeatAt.getTime() >= IDLE_TIMEOUT_SECONDS * 1000;
}

export function isAbandoned(session: { lastHeartbeatAt: Date }, now: Date): boolean {
  return now.getTime() - session.lastHeartbeatAt.getTime() >= ABANDON_AFTER_SECONDS * 1000;
}

/**
 * Pause an active session whose heartbeats stopped, from the moment they
 * stopped.
 *
 * Lazy on purpose. The alternative is something watching every live session on
 * a timer — the queue this project does not have — and the effect is identical,
 * because the pause is stamped in the past either way. A session discovered
 * idle an hour later is paused as of an hour ago.
 */
export async function applyIdleAutopause(
  db: Database,
  session: SweepableSession,
  now: Date,
): Promise<boolean> {
  if (session.status !== 'active' || !isIdle(session, now)) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(solveSessions)
      .set({ status: 'paused', updatedAt: now })
      .where(and(eq(solveSessions.id, session.id), eq(solveSessions.status, 'active')));

    await recordEvent(tx, {
      sessionId: session.id,
      type: 'idle_autopause',
      occurredAt: session.lastHeartbeatAt,
      payload: { idleSeconds: IDLE_TIMEOUT_SECONDS },
    });
  });

  return true;
}

/**
 * Close one session if its heartbeat is old enough, and say whether it did.
 *
 * The single place a session becomes 'abandoned' by the system, shared by the
 * request path and the script. Two implementations of "how long is too long"
 * would be one implementation too many.
 */
export async function abandonIfStale(
  db: Database,
  session: SweepableSession & { timeZone: string },
  now: Date,
): Promise<boolean> {
  if (!isAbandoned(session, now)) return false;

  const endedAt = session.lastHeartbeatAt;
  let closed = false;

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(solveSessions)
      .set({
        status: 'abandoned',
        endedAt,
        endedLocalDate: localDateFor(endedAt, session.timeZone),
        updatedAt: now,
      })
      /*
       * Still live when we get here, or someone beat us to it. This makes the
       * sweep safe to run concurrently with the user finishing the very session
       * it is closing: the loser writes nothing rather than overwriting a real
       * outcome with 'abandoned'.
       */
      .where(
        and(
          eq(solveSessions.id, session.id),
          inArray(solveSessions.status, [...LIVE_STATUSES]),
        ),
      )
      .returning({ id: solveSessions.id });

    if (updated.length === 0) return;

    await recordEvent(tx, {
      sessionId: session.id,
      type: 'session_abandoned',
      occurredAt: endedAt,
      payload: { reason: 'swept', afterSeconds: ABANDON_AFTER_SECONDS },
    });

    closed = true;
  });

  return closed;
}

/**
 * Close every live session whose heartbeat is older than six hours.
 *
 * Unscoped by default — that is the script's job. The request path does not
 * call this: it already holds the current user's session and calls
 * `abandonIfStale` directly, so the common page load costs no extra query.
 *
 * Returns how many were closed, so the script reports something true.
 */
export async function sweepAbandonedSessions(
  db: Database,
  options: { now: Date; userId?: string },
): Promise<number> {
  const { now, userId } = options;
  const cutoff = new Date(now.getTime() - ABANDON_AFTER_SECONDS * 1000);

  const stale = await db
    .select({
      id: solveSessions.id,
      status: solveSessions.status,
      lastHeartbeatAt: solveSessions.lastHeartbeatAt,
      /*
       * The OWNER's timezone, joined rather than passed in. An unscoped run
       * touches many users at once, and resolving every session's end date in
       * one caller's zone would file other people's sessions under the wrong
       * day (D18).
       */
      timeZone: users.timezone,
    })
    .from(solveSessions)
    .innerJoin(users, eq(users.id, solveSessions.userId))
    .where(
      and(
        inArray(solveSessions.status, [...LIVE_STATUSES]),
        lt(solveSessions.lastHeartbeatAt, cutoff),
        ...(userId ? [eq(solveSessions.userId, userId)] : []),
      ),
    );

  let closed = 0;
  for (const session of stale) {
    // Each its own transaction: one row that cannot be closed must not stop the
    // rest, which matters far more for the unscoped run.
    if (await abandonIfStale(db, session, now)) closed += 1;
  }

  return closed;
}
