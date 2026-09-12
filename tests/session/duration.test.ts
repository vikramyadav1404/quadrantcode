/**
 * F1.4 · the duration arithmetic.
 *
 * The ticket's warning is that elapsed time must survive refreshes, tab closes
 * and a hostile client. Every one of those is the same property: the number is
 * a function of timestamps the server wrote, so nothing the client does — or
 * fails to do — can change it.
 *
 * Pure, so every case below is expressible without changing the machine clock.
 */
import { describe, expect, it } from 'vitest';
import {
  type DurationEvent,
  activeDurationSeconds,
  isPausedAt,
  pausedIntervals,
} from '@/server/services/session/duration';

const START = new Date('2026-03-02T10:00:00.000Z');

/** Minutes after the start, as an instant. */
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

const event = (type: DurationEvent['type'], minutes: number): DurationEvent => ({
  type,
  occurredAt: at(minutes),
});

const MINUTE = 60;

describe('F1.4 · activeDurationSeconds — the simple cases', () => {
  it('counts the whole span when nothing paused', () => {
    const seconds = activeDurationSeconds(
      { startedAt: START, endedAt: at(30), events: [] },
      at(99),
    );
    expect(seconds).toBe(30 * MINUTE);
  });

  it('runs to NOW while the session is still live', () => {
    const seconds = activeDurationSeconds(
      { startedAt: START, endedAt: null, events: [] },
      at(12),
    );
    expect(seconds).toBe(12 * MINUTE);
  });

  it('A SHORT ABSENCE COSTS NOTHING; A LONG ONE COSTS EXACTLY THE GAP', () => {
    /*
     * The "close the tab for 2 minutes, reopen" criterion, reduced to the part
     * that lives in this function.
     *
     * A heartbeat gap is not an input here — only start, end and events are —
     * so a gap below the idle threshold leaves the log untouched and nothing
     * is subtracted. A gap above it produces an `idle_autopause` stamped at the
     * last heartbeat, and only then does the total stop growing.
     *
     * The first version of this test computed the same expression twice and
     * compared them, which asserted nothing. The contrast is the content: the
     * two cases must differ, and by exactly the idle interval.
     */
    const shortGap = activeDurationSeconds(
      { startedAt: START, endedAt: null, events: [] },
      at(10),
    );

    // Heartbeats stopped at minute 4; the sweep stamped the pause there.
    const longGap = activeDurationSeconds(
      { startedAt: START, endedAt: null, events: [event('idle_autopause', 4)] },
      at(10),
    );

    expect(shortGap).toBe(10 * MINUTE);
    expect(longGap).toBe(4 * MINUTE);
    expect(shortGap - longGap).toBe(6 * MINUTE);
  });

  it('is zero, not negative, when nothing has elapsed', () => {
    expect(activeDurationSeconds({ startedAt: START, endedAt: START, events: [] }, START)).toBe(
      0,
    );
  });

  it('is zero rather than negative if `now` precedes the start', () => {
    // Reachable only through a clock skew or a bad caller, and returning a
    // negative duration would propagate into every total that reads it.
    const seconds = activeDurationSeconds(
      { startedAt: START, endedAt: null, events: [] },
      new Date(START.getTime() - 60_000),
    );
    expect(seconds).toBe(0);
  });

  it('floors rather than rounds', () => {
    // A timer that reads ahead of its own elapsed time is the one users notice.
    const seconds = activeDurationSeconds(
      { startedAt: START, endedAt: new Date(START.getTime() + 60_600), events: [] },
      at(99),
    );
    expect(seconds).toBe(60);
  });
});

describe('F1.4 · pause arithmetic', () => {
  it('subtracts a single pause', () => {
    const seconds = activeDurationSeconds(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('paused', 10), event('resumed', 15)],
      },
      at(99),
    );
    expect(seconds).toBe(25 * MINUTE); // 30 wall − 5 paused
  });

  it('THREE PAUSE/RESUME CYCLES ARE ARITHMETICALLY CORRECT', () => {
    // The acceptance criterion. 60 minutes of wall time, 3 + 4 + 5 paused.
    const seconds = activeDurationSeconds(
      {
        startedAt: START,
        endedAt: at(60),
        events: [
          event('paused', 5),
          event('resumed', 8), // 3
          event('paused', 20),
          event('resumed', 24), // 4
          event('paused', 40),
          event('resumed', 45), // 5
        ],
      },
      at(99),
    );
    expect(seconds).toBe(48 * MINUTE);
  });

  it('an idle autopause pauses exactly like a manual one', () => {
    const manual = activeDurationSeconds(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('paused', 10), event('resumed', 20)],
      },
      at(99),
    );
    const idle = activeDurationSeconds(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('idle_autopause', 10), event('resumed', 20)],
      },
      at(99),
    );

    expect(idle).toBe(manual);
    expect(idle).toBe(20 * MINUTE);
  });

  it('STOPS ACCRUING while paused, however long the session is left open', () => {
    /*
     * The property that makes the idle autopause worth having. A user who
     * walked away is paused from the moment their heartbeats stopped, and the
     * total must not grow while they are gone — so two different `now` values
     * have to produce the same answer.
     */
    const input = {
      startedAt: START,
      endedAt: null,
      events: [event('paused', 10)],
    };

    expect(activeDurationSeconds(input, at(11))).toBe(10 * MINUTE);
    expect(activeDurationSeconds(input, at(600))).toBe(10 * MINUTE);
  });
});

describe('F1.4 · a log that does not read cleanly', () => {
  it('does not double-count a second pause while already paused', () => {
    /*
     * The failure a mutable counter cannot survive. Two `paused` events — a
     * retry, a double click, a replay — subtract one interval here, because
     * the second one opens nothing that is not already open.
     */
    const seconds = activeDurationSeconds(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('paused', 10), event('paused', 12), event('resumed', 20)],
      },
      at(99),
    );
    expect(seconds).toBe(20 * MINUTE);
  });

  it('ignores a resume with no pause open', () => {
    const seconds = activeDurationSeconds(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('resumed', 5), event('resumed', 9)],
      },
      at(99),
    );
    expect(seconds).toBe(30 * MINUTE);
  });

  it('reads events by WHEN THEY HAPPENED, not the order they arrived', () => {
    /*
     * Not hypothetical: an idle autopause is stamped with the last heartbeat,
     * an instant already in the past when the row is written. Trusting
     * insertion order would compute a pause that ran backwards.
     */
    const outOfOrder = activeDurationSeconds(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('resumed', 20), event('idle_autopause', 10)],
      },
      at(99),
    );
    expect(outOfOrder).toBe(20 * MINUTE);
  });

  it('clamps an event that falls outside the session', () => {
    const seconds = activeDurationSeconds(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('paused', -10), event('resumed', 5)],
      },
      at(99),
    );
    // The pause cannot start before the session did, so it costs 5 minutes.
    expect(seconds).toBe(25 * MINUTE);
  });

  it('closes a pause left open at the end of a finished session', () => {
    const seconds = activeDurationSeconds(
      { startedAt: START, endedAt: at(30), events: [event('paused', 10)] },
      at(99),
    );
    expect(seconds).toBe(10 * MINUTE);
  });

  it('never exceeds the wall-clock span', () => {
    const input = {
      startedAt: START,
      endedAt: at(30),
      events: [event('paused', 5), event('resumed', 10)],
    };
    expect(activeDurationSeconds(input, at(99))).toBeLessThanOrEqual(30 * MINUTE);
  });
});

describe('F1.4 · pausedIntervals and isPausedAt', () => {
  it('returns the intervals themselves, so the arithmetic is inspectable', () => {
    const intervals = pausedIntervals(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('paused', 5), event('resumed', 8), event('paused', 20)],
      },
      at(99),
    );

    expect(intervals).toEqual([
      { from: at(5), to: at(8) },
      { from: at(20), to: at(30) }, // still open at the end
    ]);
  });

  it('drops a zero-length pause rather than recording it', () => {
    const intervals = pausedIntervals(
      {
        startedAt: START,
        endedAt: at(30),
        events: [event('paused', 10), event('resumed', 10)],
      },
      at(99),
    );
    expect(intervals).toEqual([]);
  });

  it('knows whether the session is paused right now', () => {
    const live = { startedAt: START, endedAt: null, events: [event('paused', 10)] };
    expect(isPausedAt(live, at(20))).toBe(true);

    const resumed = {
      startedAt: START,
      endedAt: null,
      events: [event('paused', 10), event('resumed', 15)],
    };
    expect(isPausedAt(resumed, at(20))).toBe(false);
  });

  it('reports a never-paused session as not paused', () => {
    expect(isPausedAt({ startedAt: START, endedAt: null, events: [] }, at(20))).toBe(false);
  });
});
