/**
 * How long a session was actually being worked on.
 *
 *   active = (end − start) − every interval the session spent paused
 *
 * Pure: no clock, no database. `now` is a parameter for the same reason
 * `today` is one in the streak engine (D18) — a duration function that reads
 * the clock cannot be tested across the cases that break it, and every case
 * below is one that would otherwise need the machine's time changed.
 *
 * ## Why this is computed rather than stored
 *
 * A stored counter is a second source of truth that must be kept in step with
 * the events that justify it. Increment it twice and it is silently wrong;
 * duplicate an event and the arithmetic here still gives the same answer,
 * because a `paused` while already paused is not a new interval. That
 * idempotence is the property a counter cannot have, and it is what makes the
 * number safe to recompute on every read.
 */
import type { SessionEvent } from '@/server/db/schema';

/** The two fields the arithmetic needs. Anything else on the row is irrelevant. */
export type DurationEvent = Pick<SessionEvent, 'type' | 'occurredAt'>;

export type DurationInput = {
  startedAt: Date;
  /** Null while the session is still live. */
  endedAt: Date | null;
  events: readonly DurationEvent[];
};

export type Interval = { from: Date; to: Date };

/** Both ways a session can enter a paused state. */
const PAUSE_TYPES = new Set<SessionEvent['type']>(['paused', 'idle_autopause']);

/**
 * The intervals the session was paused for, clamped to its own lifetime.
 *
 * Exported because F3.2's timeline draws them, and because it is far easier to
 * see that the arithmetic is right when the intervals themselves are
 * assertable.
 *
 * Tolerates a log that does not read cleanly:
 *
 *   - a second `paused` while already paused extends nothing; the first one
 *     already opened the interval
 *   - a `resumed` with no pause open is ignored rather than throwing, because
 *     refusing to compute a duration is a worse failure than ignoring an event
 *     that changes nothing
 *   - a pause still open at the end closes at the end (or at `now` for a live
 *     session), so a session paused and never resumed does not accrue time
 */
export function pausedIntervals(input: DurationInput, now: Date): Interval[] {
  const { startedAt } = input;
  const finish = input.endedAt ?? now;

  /*
   * Sorted defensively rather than trusting insertion order. An idle autopause
   * is stamped with the last heartbeat — an instant in the past — so it is one
   * event whose `occurred_at` is deliberately earlier than its write time, and
   * the arithmetic must depend on when things HAPPENED.
   */
  const ordered = [...input.events].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );

  const clamp = (moment: Date): Date => {
    if (moment < startedAt) return startedAt;
    if (moment > finish) return finish;
    return moment;
  };

  const intervals: Interval[] = [];
  let openedAt: Date | null = null;

  for (const event of ordered) {
    if (PAUSE_TYPES.has(event.type)) {
      openedAt ??= clamp(event.occurredAt);
      continue;
    }

    if (event.type === 'resumed' && openedAt !== null) {
      const to = clamp(event.occurredAt);
      if (to > openedAt) intervals.push({ from: openedAt, to });
      openedAt = null;
    }
  }

  if (openedAt !== null && finish > openedAt) {
    intervals.push({ from: openedAt, to: finish });
  }

  return intervals;
}

/**
 * Whole seconds of active time. Never negative, and never longer than the
 * session's own wall-clock span.
 *
 * Floored rather than rounded: reporting 61 seconds for 60.6 would let a
 * displayed timer read ahead of the elapsed time it is derived from, and a
 * timer that runs fast is the one users notice.
 */
export function activeDurationSeconds(input: DurationInput, now: Date): number {
  const finish = input.endedAt ?? now;
  const wallMs = finish.getTime() - input.startedAt.getTime();
  if (wallMs <= 0) return 0;

  const pausedMs = pausedIntervals(input, now).reduce(
    (total, interval) => total + (interval.to.getTime() - interval.from.getTime()),
    0,
  );

  return Math.max(0, Math.floor((wallMs - pausedMs) / 1000));
}

/** True while the session is inside a pause that nothing has closed. */
export function isPausedAt(input: DurationInput, now: Date): boolean {
  const intervals = pausedIntervals(input, now);
  const last = intervals.at(-1);
  const finish = input.endedAt ?? now;

  return last !== undefined && last.to.getTime() === finish.getTime();
}
