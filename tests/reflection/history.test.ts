/**
 * F1.5 · attempt history.
 *
 * Two criteria: the last-attempt panel shows real data, and the timeline orders
 * correctly across a **backfilled** past session — one inserted after the fact
 * for a solve that happened last week. The second is the reason the query sorts
 * by `started_at` rather than by insertion order, and the test inserts sessions
 * deliberately out of order to prove it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { problems, solveSessions } from '@/server/db/schema';
import { abandonSession, completeSession, startSession } from '@/server/services/session';
import {
  getAttemptHistory,
  getLastAttempt,
  markStuck,
  saveReflection,
} from '@/server/services/reflection';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-03-02T10:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const MINUTE = 60;
const TIME_ZONE = 'Asia/Kolkata';

suite('F1.5 · getAttemptHistory', () => {
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
    userId = (await createUser(ctx.db, { email: 'history@example.com', timezone: TIME_ZONE }))
      .id;

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

  /** One finished attempt, start to outcome. */
  async function attempt(options: {
    startedAt: Date;
    minutes: number;
    outcome: 'solved' | 'stuck';
  }) {
    const session = await startSession(ctx.db, {
      ...actor(options.startedAt),
      problemId,
    });
    await completeSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: new Date(options.startedAt.getTime() + options.minutes * 60_000),
      sessionId: session.id,
      outcome: options.outcome,
    });
    return session.id;
  }

  it('numbers attempts oldest-first and shows them newest-first', async () => {
    await attempt({ startedAt: START, minutes: 30, outcome: 'stuck' });
    await attempt({
      startedAt: new Date(START.getTime() + DAY),
      minutes: 20,
      outcome: 'solved',
    });

    const history = await getAttemptHistory(ctx.db, { userId, problemId, now: at(9999) });

    expect(history).toHaveLength(2);
    expect(history[0]?.attemptNumber).toBe(2);
    expect(history[0]?.outcome).toBe('solved');
    expect(history[1]?.attemptNumber).toBe(1);
    expect(history[1]?.outcome).toBe('stuck');
  });

  it('ORDERS A BACKFILLED PAST SESSION BY WHEN IT HAPPENED', async () => {
    /*
     * The acceptance criterion. Two attempts are recorded today, then a third
     * is inserted for last week — later in insertion order, earlier in the
     * story. Sorting by anything but `started_at` puts it at the wrong end and
     * renumbers everything after it.
     */
    await attempt({ startedAt: START, minutes: 30, outcome: 'stuck' });
    await attempt({
      startedAt: new Date(START.getTime() + DAY),
      minutes: 20,
      outcome: 'solved',
    });

    const backfilledStart = new Date(START.getTime() - 7 * DAY);
    await ctx.db.insert(solveSessions).values({
      userId,
      problemId,
      status: 'stuck',
      startedAt: backfilledStart,
      lastHeartbeatAt: new Date(backfilledStart.getTime() + 45 * 60_000),
      endedAt: new Date(backfilledStart.getTime() + 45 * 60_000),
      startedLocalDate: '2026-02-23',
      endedLocalDate: '2026-02-23',
    });

    const history = await getAttemptHistory(ctx.db, { userId, problemId, now: at(9999) });

    expect(history.map((entry) => entry.attemptNumber)).toEqual([3, 2, 1]);
    // The backfilled one is oldest, so it is attempt 1 and sits last.
    expect(history[2]?.startedAt.toISOString()).toBe(backfilledStart.toISOString());
    expect(history[2]?.attemptNumber).toBe(1);
    // …and the two recorded today moved up a number rather than staying at 1-2.
    expect(history[0]?.outcome).toBe('solved');
  });

  it('SHOWS AN ABANDONED SITTING WITHOUT NUMBERING IT AN ATTEMPT', async () => {
    /*
     * `user_problems.total_attempts` excludes abandonment (D20). Numbering it
     * here would put "Attempt 3 of 2" on the page; hiding it entirely would
     * leave a user wondering where their session went.
     */
    await attempt({ startedAt: START, minutes: 30, outcome: 'solved' });

    const walked = await startSession(ctx.db, {
      ...actor(new Date(START.getTime() + DAY)),
      problemId,
    });
    await abandonSession(ctx.db, {
      ...actor(new Date(START.getTime() + DAY + 10 * 60_000)),
      sessionId: walked.id,
    });

    const history = await getAttemptHistory(ctx.db, { userId, problemId, now: at(9999) });

    expect(history).toHaveLength(2);
    expect(history[0]?.outcome).toBe('abandoned');
    expect(history[0]?.attemptNumber).toBeNull();
    expect(history[1]?.attemptNumber).toBe(1);

    const [row] = await ctx.sql`SELECT total_attempts FROM user_problems`;
    expect(row!.total_attempts).toBe(1); // and the two agree
  });

  it('THE LAST-ATTEMPT PANEL CARRIES REAL DATA', async () => {
    // The acceptance criterion: reopening a solved problem shows the real
    // duration, outcome, markers and reflection — not a placeholder.
    const session = await startSession(ctx.db, { ...actor(START), problemId });
    await markStuck(ctx.db, {
      userId,
      sessionId: session.id,
      category: 'edge_cases',
      note: 'Empty array.',
      now: at(6),
    });
    await completeSession(ctx.db, {
      ...actor(at(24)),
      sessionId: session.id,
      outcome: 'solved',
      confidence: 'medium',
    });
    await saveReflection(ctx.db, {
      userId,
      sessionId: session.id,
      approach: 'Hash map of complements.',
      achievedComplexity: 'O(n)',
      mistakes: ['missed_edge_case'],
      stuckAreas: ['edge_cases'],
      now: at(25),
    });

    const last = await getLastAttempt(ctx.db, { userId, problemId, now: at(9999) });

    expect(last?.attemptNumber).toBe(1);
    expect(last?.outcome).toBe('solved');
    expect(last?.activeDurationSeconds).toBe(24 * MINUTE);
    expect(last?.confidence).toBe('medium');
    expect(last?.approach).toBe('Hash map of complements.');
    expect(last?.achievedComplexity).toBe('O(n)');
    expect(last?.mistakes).toEqual(['missed_edge_case']);
    expect(last?.stuckMarkers).toEqual([
      { category: 'edge_cases', elapsedSeconds: 6 * MINUTE, note: 'Empty array.' },
    ]);
    expect(last?.hasReflection).toBe(true);
  });

  it('distinguishes a skipped reflection from an empty one', async () => {
    await attempt({ startedAt: START, minutes: 15, outcome: 'solved' });

    const last = await getLastAttempt(ctx.db, { userId, problemId, now: at(9999) });
    expect(last?.hasReflection).toBe(false);
    expect(last?.mistakes).toEqual([]);
  });

  it('excludes the session that is still running', async () => {
    // It is already on screen in the timer bar; a second view of it with a
    // moving duration would be a second place to look at the same thing.
    await attempt({ startedAt: START, minutes: 15, outcome: 'solved' });
    await startSession(ctx.db, { ...actor(new Date(START.getTime() + DAY)), problemId });

    const history = await getAttemptHistory(ctx.db, { userId, problemId, now: at(9999) });
    expect(history).toHaveLength(1);
  });

  it('is empty for a problem never attempted, rather than throwing', async () => {
    const [other] = await ctx.db
      .insert(problems)
      .values({
        slug: 'three-sum',
        title: 'Three Sum',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/3sum/',
        difficulty: 'medium',
      })
      .returning();

    expect(
      await getAttemptHistory(ctx.db, { userId, problemId: other!.id, now: at(1) }),
    ).toEqual([]);
    expect(
      await getLastAttempt(ctx.db, { userId, problemId: other!.id, now: at(1) }),
    ).toBeNull();
  });

  it("never shows another user's attempts", async () => {
    const other = await createUser(ctx.db, { email: 'other-history@example.com' });
    await attempt({ startedAt: START, minutes: 15, outcome: 'solved' });

    const history = await getAttemptHistory(ctx.db, {
      userId: other.id,
      problemId,
      now: at(9999),
    });
    expect(history).toEqual([]);
  });
});
