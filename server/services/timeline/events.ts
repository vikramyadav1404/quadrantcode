/**
 * The session log, and how long into the session each event happened.
 *
 * ## `elapsedMs` is derived here, not stored
 *
 * F3.2's spec lists `elapsed_ms` as a column. It is not one. The reasoning is
 * in `server/db/schema/timeline.ts`; the short version is that **D20 already
 * settled it one level up** (F1.4 deleted `active_duration_seconds` because
 * events are the record), and that an append-only table cannot have a derived
 * value corrected in it — the trigger would refuse the fix.
 *
 * The field the timeline renders is still called `elapsedMs` and still reads
 * `00:00 / 05:20`. Only its home changed.
 *
 * ## It subtracts paused time, and reuses the arithmetic that already does
 *
 * `pausedIntervals` is F1.4's, exported precisely so this could use it. A
 * second implementation of "when was this session not being worked on" is a
 * second answer to the same question, and the two would part company the first
 * time either changed.
 */
import { asc, eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { type SessionEvent, sessionEvents } from '@/server/db/schema';
import { pausedIntervals, type DurationEvent } from '@/server/services/session/duration';

/** One row of the log, with the elapsed figure the timeline prints. */
export type TimelineEvent = {
  id: string;
  type: SessionEvent['type'];
  occurredAt: Date;
  /** Active milliseconds from the session's start. Never negative. */
  elapsedMs: number;
  payload: Record<string, unknown>;
};

/**
 * Active milliseconds from `startedAt` to each event.
 *
 * One pass over the paused intervals per event rather than a fresh
 * `pausedIntervals` call per event: the intervals do not depend on which event
 * we are asking about, only on the whole log.
 *
 * `now` is a parameter (D18). A live session's still-open pause has to be
 * clamped to something, and reading the clock in here would make every case
 * below untestable without changing the machine's time.
 */
export function elapsedMsFor<T extends DurationEvent>(
  input: { startedAt: Date; endedAt: Date | null; events: readonly T[] },
  now: Date,
): Map<T, number> {
  const intervals = pausedIntervals(input, now);
  const elapsed = new Map<T, number>();

  for (const event of input.events) {
    const at = event.occurredAt.getTime();
    const wallMs = at - input.startedAt.getTime();

    /*
     * Only the part of each pause that happened BEFORE this event counts. A
     * pause that starts later has not happened yet from this row's point of
     * view, and one that straddles the event counts up to the event.
     */
    let pausedMs = 0;
    for (const interval of intervals) {
      const from = interval.from.getTime();
      const to = Math.min(interval.to.getTime(), at);
      if (to > from) pausedMs += to - from;
    }

    elapsed.set(event, Math.max(0, wallMs - pausedMs));
  }

  return elapsed;
}

/**
 * Every event of a session, oldest first, with elapsed attached.
 *
 * Ordered by `occurred_at` rather than by insertion, because an idle autopause
 * is stamped at the last heartbeat — an instant deliberately earlier than its
 * write time (`server/services/session/sweep.ts`). The timeline has to read as
 * the sitting happened, not as the rows arrived.
 */
export async function loadTimeline(
  db: Database,
  input: { sessionId: string; startedAt: Date; endedAt: Date | null; now: Date },
): Promise<TimelineEvent[]> {
  const rows = await db
    .select({
      id: sessionEvents.id,
      type: sessionEvents.type,
      occurredAt: sessionEvents.occurredAt,
      payload: sessionEvents.payload,
    })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, input.sessionId))
    .orderBy(asc(sessionEvents.occurredAt));

  const elapsed = elapsedMsFor(
    { startedAt: input.startedAt, endedAt: input.endedAt, events: rows },
    input.now,
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt,
    elapsedMs: elapsed.get(row) ?? 0,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}
