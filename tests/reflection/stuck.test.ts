/**
 * F1.5 · stuck markers.
 *
 * The criterion is "three stuck markers in one session all persist with
 * distinct elapsed times", and the word doing the work is **distinct**: the
 * elapsed value has to come from somewhere that moves, which means the
 * session's own event log rather than anything the client says.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { problems, stuckPoints } from '@/server/db/schema';
import {
  SessionNotFoundError,
  completeSession,
  pauseSession,
  resumeSession,
  startSession,
} from '@/server/services/session';
import { SessionNotLiveError, getStuckMarkers, markStuck } from '@/server/services/reflection';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const START = new Date('2026-03-02T10:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const MINUTE = 60;
const TIME_ZONE = 'Asia/Kolkata';

suite('F1.5 · markStuck', () => {
  let ctx: TestContext;
  let userId: string;
  let problemId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'stuck@example.com', timezone: TIME_ZONE })).id;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'two-sum',
        title: 'Two Sum',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'easy',
      })
      .returning();
    problemId = problem!.id;
  });

  const actor = (now: Date) => ({ userId, timeZone: TIME_ZONE, now });

  const startLive = () => startSession(ctx.db, { ...actor(START), problemId });

  it('THREE MARKERS IN ONE SESSION, EACH AT ITS OWN ELAPSED TIME', async () => {
    // The acceptance criterion.
    const session = await startLive();

    await markStuck(ctx.db, {
      userId,
      sessionId: session.id,
      category: 'understanding',
      now: at(2),
    });
    await markStuck(ctx.db, {
      userId,
      sessionId: session.id,
      category: 'approach',
      note: 'Tried a hash map, got lost in the indices.',
      now: at(11),
    });
    await markStuck(ctx.db, {
      userId,
      sessionId: session.id,
      category: 'debugging',
      now: at(26),
    });

    const markers = await getStuckMarkers(ctx.db, { userId, sessionId: session.id });

    expect(markers.map((marker) => marker.elapsedSeconds)).toEqual([
      2 * MINUTE,
      11 * MINUTE,
      26 * MINUTE,
    ]);
    expect(markers.map((marker) => marker.category)).toEqual([
      'understanding',
      'approach',
      'debugging',
    ]);
    expect(markers[1]?.note).toContain('hash map');
    expect(markers[0]?.note).toBeNull();
  });

  it('THE ELAPSED TIME EXCLUDES PAUSED TIME, LIKE EVERY OTHER DURATION', async () => {
    /*
     * The marker is only comparable with the session total — or with another
     * session's markers — if it came out of the same arithmetic. Here the user
     * paused for five minutes before feeling stuck, so a wall-clock reading
     * would say 20 and the truth is 15.
     */
    const session = await startLive();
    await pauseSession(ctx.db, { ...actor(at(5)), sessionId: session.id });
    await resumeSession(ctx.db, { ...actor(at(10)), sessionId: session.id });

    const marker = await markStuck(ctx.db, {
      userId,
      sessionId: session.id,
      category: 'implementation',
      now: at(20),
    });

    expect(marker.elapsedSeconds).toBe(15 * MINUTE);
  });

  it('can be marked while PAUSED — the most likely moment to feel stuck', async () => {
    const session = await startLive();
    await pauseSession(ctx.db, { ...actor(at(5)), sessionId: session.id });

    const marker = await markStuck(ctx.db, {
      userId,
      sessionId: session.id,
      category: 'approach',
      now: at(8),
    });

    // Frozen at the pause: the three minutes spent thinking with the timer
    // stopped are not solve time.
    expect(marker.elapsedSeconds).toBe(5 * MINUTE);
  });

  it('writes an event beside the row, so the timeline can place it', async () => {
    // The row is what F3.5 counts; the event is what puts the marker between
    // the failed run and the pause on F3.2's timeline.
    const session = await startLive();
    await markStuck(ctx.db, {
      userId,
      sessionId: session.id,
      category: 'edge_cases',
      now: at(7),
    });

    const events = await ctx.sql`
      SELECT type, payload FROM session_events
      WHERE session_id = ${session.id} AND type = 'stuck_marked'
    `;

    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ category: 'edge_cases', elapsedSeconds: 420 });
  });

  it('REFUSES A MARKER ON A FINISHED SESSION', async () => {
    /*
     * "I'm stuck here" is a statement about the present — it captures elapsed
     * time at the moment it is pressed. A finished session has no present, and
     * accepting one would file a marker at a time that never happened.
     */
    const session = await startLive();
    await completeSession(ctx.db, {
      ...actor(at(30)),
      sessionId: session.id,
      outcome: 'solved',
    });

    await expect(
      markStuck(ctx.db, {
        userId,
        sessionId: session.id,
        category: 'debugging',
        now: at(31),
      }),
    ).rejects.toBeInstanceOf(SessionNotLiveError);
  });

  it("refuses to mark another user's session", async () => {
    const session = await startLive();
    const intruder = await createUser(ctx.db, { email: 'intruder-stuck@example.com' });

    await expect(
      markStuck(ctx.db, {
        userId: intruder.id,
        sessionId: session.id,
        category: 'debugging',
        now: at(5),
      }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);

    expect(await ctx.db.select().from(stuckPoints)).toHaveLength(0);
  });

  it('stores an empty note as null rather than an empty string', async () => {
    // Two representations of "they said nothing" is one too many; F3.5 reads
    // these and must not have to check for both.
    const session = await startLive();
    const marker = await markStuck(ctx.db, {
      userId,
      sessionId: session.id,
      category: 'complexity',
      note: '',
      now: at(4),
    });

    expect(marker.note).toBeNull();
  });
});
