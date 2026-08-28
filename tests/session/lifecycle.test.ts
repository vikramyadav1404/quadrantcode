/**
 * F1.4 · the lifecycle against a real database.
 *
 * Five of the six acceptance criteria live here. Every one of them is a
 * statement about time, and every one is expressible only because `now` is a
 * parameter: a five-minute idle gap and a seven-hour abandonment are two lines
 * apart in this file and neither needs the machine's clock touched.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dailySessions, problems, userProblems } from '@/server/db/schema';
import {
  ActiveSessionExistsError,
  IllegalTransitionError,
  SessionNotFoundError,
  abandonSession,
  completeSession,
  getActiveSession,
  heartbeat,
  pauseSession,
  resumeSession,
  startSession,
  sweepAbandonedSessions,
} from '@/server/services/session';
import { summariseForShell } from '@/server/services/streak';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

/** 10:00 UTC on 2 March — 15:30 in Kolkata, so comfortably mid-day either way. */
const START = new Date('2026-03-02T10:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const MINUTE = 60;

const TIME_ZONE = 'Asia/Kolkata';

suite('F1.4 · solve-session lifecycle', () => {
  let ctx: TestContext;
  let userId: string;
  let problemId: string;
  let otherProblemId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'session@example.com', timezone: TIME_ZONE }))
      .id;

    const inserted = await ctx.db
      .insert(problems)
      .values([
        {
          slug: 'two-sum',
          title: 'Two Sum',
          sourceType: 'external_link',
          platform: 'leetcode',
          externalUrl: 'https://leetcode.com/problems/two-sum/',
          difficulty: 'easy',
        },
        {
          slug: 'three-sum',
          title: 'Three Sum',
          sourceType: 'external_link',
          platform: 'leetcode',
          externalUrl: 'https://leetcode.com/problems/3sum/',
          difficulty: 'medium',
        },
      ])
      .returning();

    problemId = inserted[0]!.id;
    otherProblemId = inserted[1]!.id;
  });

  const actor = (now: Date) => ({ userId, timeZone: TIME_ZONE, now });

  const eventTypes = async (sessionId: string) => {
    const rows = await ctx.sql`
      SELECT type FROM session_events WHERE session_id = ${sessionId} ORDER BY occurred_at
    `;
    return rows.map((row) => String(row.type));
  };

  describe('starting', () => {
    it('creates an active session and its first event', async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });

      expect(session.status).toBe('active');
      expect(session.activeDurationSeconds).toBe(0);
      expect(await eventTypes(session.id)).toEqual(['session_started']);
    });

    it("resolves the start date in the USER's timezone, not UTC", async () => {
      /*
       * 20:00 UTC on 1 March is already 01:30 on 2 March in Kolkata. Storing the
       * UTC date would file the session under a day the user had not reached.
       */
      const lateUtc = new Date('2026-03-01T20:00:00.000Z');
      const session = await startSession(ctx.db, { ...actor(lateUtc), problemId });

      const [row] = await ctx.sql`
        SELECT started_local_date FROM solve_sessions WHERE id = ${session.id}
      `;
      expect(String(row!.started_local_date)).toContain('2026-03-02');
    });

    it('A SECOND START IS A CONFLICT, NOT A NEW ROW', async () => {
      // The acceptance criterion. The error carries the running session so the
      // UI can offer "finish or abandon" instead of a dead end.
      const first = await startSession(ctx.db, { ...actor(START), problemId });

      await expect(
        startSession(ctx.db, { ...actor(at(5)), problemId: otherProblemId }),
      ).rejects.toBeInstanceOf(ActiveSessionExistsError);

      try {
        await startSession(ctx.db, { ...actor(at(5)), problemId: otherProblemId });
      } catch (error) {
        expect((error as ActiveSessionExistsError).existing.id).toBe(first.id);
        expect((error as ActiveSessionExistsError).status).toBe(409);
      }

      const rows = await ctx.sql`SELECT id FROM solve_sessions WHERE user_id = ${userId}`;
      expect(rows).toHaveLength(1);
    });

    it('conflicts even when the running session is merely PAUSED', async () => {
      const first = await startSession(ctx.db, { ...actor(START), problemId });
      await pauseSession(ctx.db, { ...actor(at(5)), sessionId: first.id });

      await expect(
        startSession(ctx.db, { ...actor(at(6)), problemId: otherProblemId }),
      ).rejects.toBeInstanceOf(ActiveSessionExistsError);
    });

    it('allows a new session once the previous one is finished', async () => {
      const first = await startSession(ctx.db, { ...actor(START), problemId });
      await completeSession(ctx.db, {
        ...actor(at(20)),
        sessionId: first.id,
        outcome: 'solved',
      });

      const second = await startSession(ctx.db, {
        ...actor(at(25)),
        problemId: otherProblemId,
      });
      expect(second.status).toBe('active');
    });
  });

  describe('pause and resume', () => {
    it('THREE CYCLES PRODUCE ARITHMETICALLY CORRECT ACTIVE TIME', async () => {
      // The acceptance criterion. 60 minutes of wall time, 3 + 4 + 5 paused.
      const session = await startSession(ctx.db, { ...actor(START), problemId });

      for (const [pause, resume] of [
        [5, 8],
        [20, 24],
        [40, 45],
      ]) {
        await pauseSession(ctx.db, { ...actor(at(pause!)), sessionId: session.id });
        await resumeSession(ctx.db, { ...actor(at(resume!)), sessionId: session.id });
      }

      const finished = await completeSession(ctx.db, {
        ...actor(at(60)),
        sessionId: session.id,
        outcome: 'solved',
      });

      expect(finished.activeDurationSeconds).toBe(48 * MINUTE);
      expect(await eventTypes(session.id)).toEqual([
        'session_started',
        'paused',
        'resumed',
        'paused',
        'resumed',
        'paused',
        'resumed',
        'session_completed',
      ]);
    });

    it('refuses to pause a paused session', async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      await pauseSession(ctx.db, { ...actor(at(5)), sessionId: session.id });

      await expect(
        pauseSession(ctx.db, { ...actor(at(6)), sessionId: session.id }),
      ).rejects.toBeInstanceOf(IllegalTransitionError);
    });

    it('refuses to resume a running session', async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });

      await expect(
        resumeSession(ctx.db, { ...actor(at(6)), sessionId: session.id }),
      ).rejects.toBeInstanceOf(IllegalTransitionError);
    });

    it('refuses to reopen a finished session', async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      await completeSession(ctx.db, {
        ...actor(at(10)),
        sessionId: session.id,
        outcome: 'solved',
      });

      await expect(
        resumeSession(ctx.db, { ...actor(at(11)), sessionId: session.id }),
      ).rejects.toBeInstanceOf(IllegalTransitionError);
    });
  });

  describe('rehydration', () => {
    it('THE TAB WAS CLOSED FOR TWO MINUTES AND THE ELAPSED TIME IS RIGHT', async () => {
      /*
       * The acceptance criterion. Nothing represents the closed tab, because
       * nothing needs to: the client sent no heartbeat for two minutes, which
       * is under the idle threshold, so no event was written and the elapsed
       * time is simply the wall clock the server recorded.
       */
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      await heartbeat(ctx.db, { ...actor(at(3)), sessionId: session.id });

      // …tab closed at minute 3, reopened at minute 5.
      const rehydrated = await getActiveSession(ctx.db, actor(at(5)));

      expect(rehydrated?.id).toBe(session.id);
      expect(rehydrated?.status).toBe('active');
      expect(rehydrated?.activeDurationSeconds).toBe(5 * MINUTE);
      expect(await eventTypes(session.id)).toEqual(['session_started']);
    });

    it('returns null when the user has no live session', async () => {
      expect(await getActiveSession(ctx.db, actor(START))).toBeNull();
    });
  });

  describe('idle autopause', () => {
    it('FIVE MINUTES WITHOUT A HEARTBEAT PRODUCES AN idle_autopause EVENT', async () => {
      // The acceptance criterion.
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      await heartbeat(ctx.db, { ...actor(at(4)), sessionId: session.id });

      const seen = await getActiveSession(ctx.db, actor(at(10)));

      expect(seen?.status).toBe('paused');
      expect(seen?.isPaused).toBe(true);
      expect(await eventTypes(session.id)).toEqual(['session_started', 'idle_autopause']);
    });

    it('STAMPS THE PAUSE WHERE THE USER STOPPED, NOT WHERE WE NOTICED', async () => {
      /*
       * The difference between honest and convenient. Heartbeats stopped at
       * minute 4; the server found out at minute 90. Recording the pause at
       * minute 90 would credit 86 minutes of work to someone who had closed
       * their laptop.
       */
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      await heartbeat(ctx.db, { ...actor(at(4)), sessionId: session.id });

      const seen = await getActiveSession(ctx.db, actor(at(90)));

      expect(seen?.activeDurationSeconds).toBe(4 * MINUTE);

      const [event] = await ctx.sql`
        SELECT occurred_at FROM session_events
        WHERE session_id = ${session.id} AND type = 'idle_autopause'
      `;
      expect(new Date(String(event!.occurred_at)).toISOString()).toBe(at(4).toISOString());
    });

    it('does not fire while heartbeats keep arriving', async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });

      for (const minute of [2, 4, 6, 8]) {
        await heartbeat(ctx.db, { ...actor(at(minute)), sessionId: session.id });
      }

      const seen = await getActiveSession(ctx.db, actor(at(9)));
      expect(seen?.status).toBe('active');
      expect(await eventTypes(session.id)).toEqual(['session_started']);
    });

    it('ignores a heartbeat for a paused session rather than reviving it', async () => {
      // A client pausing in one tab while another is mid-heartbeat is racing
      // itself, not doing something wrong.
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      await pauseSession(ctx.db, { ...actor(at(5)), sessionId: session.id });

      const after = await heartbeat(ctx.db, { ...actor(at(6)), sessionId: session.id });
      expect(after.status).toBe('paused');
    });
  });

  describe('the six-hour sweep', () => {
    it('AUTO-CLOSES A SEVEN-HOUR-OLD SESSION', async () => {
      // The acceptance criterion. No scheduler exists (D17), so the read path
      // sweeps the user's own session.
      const session = await startSession(ctx.db, { ...actor(START), problemId });

      const sevenHours = new Date(START.getTime() + 7 * 60 * 60 * 1000);
      expect(await getActiveSession(ctx.db, actor(sevenHours))).toBeNull();

      const [row] = await ctx.sql`
        SELECT status, ended_at FROM solve_sessions WHERE id = ${session.id}
      `;
      expect(row!.status).toBe('abandoned');
      // Ended when they stopped being present, not when we noticed.
      expect(new Date(String(row!.ended_at)).toISOString()).toBe(START.toISOString());
    });

    it('frees the user to start a new session', async () => {
      await startSession(ctx.db, { ...actor(START), problemId });
      const sevenHours = new Date(START.getTime() + 7 * 60 * 60 * 1000);

      const next = await startSession(ctx.db, {
        ...actor(sevenHours),
        problemId: otherProblemId,
      });
      expect(next.status).toBe('active');
    });

    it('the unscoped sweep closes OTHER users too, and counts them', async () => {
      const other = await createUser(ctx.db, {
        email: 'other-sweep@example.com',
        timezone: 'America/New_York',
      });

      await startSession(ctx.db, { ...actor(START), problemId });
      await startSession(ctx.db, {
        userId: other.id,
        timeZone: 'America/New_York',
        now: START,
        problemId,
      });

      const sevenHours = new Date(START.getTime() + 7 * 60 * 60 * 1000);
      const closed = await sweepAbandonedSessions(ctx.db, { now: sevenHours });

      expect(closed).toBe(2);
      const live = await ctx.sql`
        SELECT id FROM solve_sessions WHERE status in ('active','paused')
      `;
      expect(live).toHaveLength(0);
    });

    it('leaves a session that is merely old but still beating', async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      const sevenHours = new Date(START.getTime() + 7 * 60 * 60 * 1000);

      // Still here, five minutes ago.
      await heartbeat(ctx.db, {
        ...actor(new Date(sevenHours.getTime() - 60_000)),
        sessionId: session.id,
      });

      expect(await sweepAbandonedSessions(ctx.db, { now: sevenHours })).toBe(0);
    });
  });

  describe('completing', () => {
    it('records the attempt, credits the day, and moves the streak', async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      const finished = await completeSession(ctx.db, {
        ...actor(at(25)),
        sessionId: session.id,
        outcome: 'solved',
        confidence: 'medium',
      });

      expect(finished.status).toBe('solved');
      expect(finished.activeDurationSeconds).toBe(25 * MINUTE);

      const [attempt] = await ctx.db
        .select()
        .from(userProblems)
        .where(and(eq(userProblems.userId, userId), eq(userProblems.problemId, problemId)));
      expect(attempt?.status).toBe('solved');
      expect(attempt?.totalAttempts).toBe(1);
      expect(attempt?.bestTimeSeconds).toBe(25 * MINUTE);
      expect(attempt?.confidence).toBe('medium');

      const [day] = await ctx.db.select().from(dailySessions);
      expect(day?.solvedCount).toBe(1);
      expect(day?.targetCount).toBe(2); // schema default target
      expect(day?.completed).toBe(false); // one solve against a target of two

      const [streak] = await ctx.sql`SELECT * FROM user_streaks WHERE user_id = ${userId}`;
      expect(streak).toBeDefined();
    });

    it('THE SHELL SEES IT IN THE SAME REQUEST', async () => {
      /*
       * The cross-ticket claim. F1.3 wired the badge and the ring to
       * `summariseForShell`; this is the first thing that ever writes what they
       * read, so "a solve moves the badge" has to be asserted somewhere or the
       * two tickets are only connected by intention.
       */
      const before = await summariseForShell(ctx.db, userId, '2026-03-02');
      expect(before.goalCompleted).toBe(0);
      expect(before.streakDays).toBe(0);

      const first = await startSession(ctx.db, { ...actor(START), problemId });
      await completeSession(ctx.db, {
        ...actor(at(20)),
        sessionId: first.id,
        outcome: 'solved',
      });

      const second = await startSession(ctx.db, {
        ...actor(at(30)),
        problemId: otherProblemId,
      });
      await completeSession(ctx.db, {
        ...actor(at(50)),
        sessionId: second.id,
        outcome: 'solved',
      });

      const after = await summariseForShell(ctx.db, userId, '2026-03-02');
      expect(after.goalCompleted).toBe(2);
      expect(after.goalMet).toBe(true);
      expect(after.streakDays).toBe(1);
    });

    it('a STUCK outcome is an attempt, but not a solve', async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      await completeSession(ctx.db, {
        ...actor(at(30)),
        sessionId: session.id,
        outcome: 'stuck',
        confidence: 'low',
      });

      const [attempt] = await ctx.db.select().from(userProblems);
      expect(attempt?.status).toBe('stuck');
      expect(attempt?.totalAttempts).toBe(1);
      // Not a time to beat: the problem was not solved.
      expect(attempt?.bestTimeSeconds).toBeNull();

      // Nothing credited, so the streak has nothing to count.
      expect(await ctx.db.select().from(dailySessions)).toHaveLength(0);
    });

    it('A LATER STRUGGLE NEVER UN-SOLVES A PROBLEM', async () => {
      /*
       * Solving it is a fact about the past. A catalog that flipped back to
       * "stuck" would lose that silently, and the user would have no way to
       * tell the difference between "never solved" and "solved, then had a bad
       * day with it".
       */
      const first = await startSession(ctx.db, { ...actor(START), problemId });
      await completeSession(ctx.db, {
        ...actor(at(20)),
        sessionId: first.id,
        outcome: 'solved',
      });

      const second = await startSession(ctx.db, { ...actor(at(30)), problemId });
      await completeSession(ctx.db, {
        ...actor(at(60)),
        sessionId: second.id,
        outcome: 'stuck',
      });

      const [attempt] = await ctx.db.select().from(userProblems);
      expect(attempt?.status).toBe('solved');
      expect(attempt?.totalAttempts).toBe(2);
    });

    it('keeps the BEST active time across attempts', async () => {
      const slow = await startSession(ctx.db, { ...actor(START), problemId });
      await completeSession(ctx.db, {
        ...actor(at(40)),
        sessionId: slow.id,
        outcome: 'solved',
      });

      const fast = await startSession(ctx.db, { ...actor(at(50)), problemId });
      await completeSession(ctx.db, {
        ...actor(at(60)),
        sessionId: fast.id,
        outcome: 'solved',
      });

      const [attempt] = await ctx.db.select().from(userProblems);
      expect(attempt?.bestTimeSeconds).toBe(10 * MINUTE);
    });

    it('credits the day the solve LANDED on, across midnight', async () => {
      /*
       * Begun 23:50 Kolkata, solved 00:30 the next Kolkata day. The streak
       * credits the day the solve became a fact — the alternative lets a user
       * hold a session open across midnight to bank a solve for a day they did
       * not finish.
       */
      const beforeMidnightIst = new Date('2026-03-02T18:20:00.000Z'); // 23:50 IST
      const afterMidnightIst = new Date('2026-03-02T19:00:00.000Z'); // 00:30 IST, 3 Mar

      const session = await startSession(ctx.db, {
        ...actor(beforeMidnightIst),
        problemId,
      });
      await completeSession(ctx.db, {
        ...actor(afterMidnightIst),
        sessionId: session.id,
        outcome: 'solved',
      });

      const [row] = await ctx.sql`
        SELECT started_local_date, ended_local_date FROM solve_sessions WHERE id = ${session.id}
      `;
      expect(String(row!.started_local_date)).toContain('2026-03-02');
      expect(String(row!.ended_local_date)).toContain('2026-03-03');

      const [day] = await ctx.db.select().from(dailySessions);
      expect(String(day?.localDate)).toContain('2026-03-03');
    });
  });

  describe('abandoning', () => {
    it('DOES NOT COUNT AS AN ATTEMPT', async () => {
      /*
       * An attempt is something the user finished making a claim about.
       * Abandonment is the opposite, and the sweep abandons sessions on the
       * user's behalf — counting those would inflate `total_attempts` for
       * people who simply closed a tab, in the history F1.5 renders.
       */
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      const abandoned = await abandonSession(ctx.db, {
        ...actor(at(15)),
        sessionId: session.id,
      });

      expect(abandoned.status).toBe('abandoned');
      expect(await ctx.db.select().from(userProblems)).toHaveLength(0);
      expect(await ctx.db.select().from(dailySessions)).toHaveLength(0);
      expect(await eventTypes(session.id)).toEqual(['session_started', 'session_abandoned']);
    });
  });

  describe('ownership', () => {
    it("refuses to touch another user's session", async () => {
      const session = await startSession(ctx.db, { ...actor(START), problemId });
      const intruder = await createUser(ctx.db, { email: 'intruder@example.com' });

      await expect(
        pauseSession(ctx.db, {
          userId: intruder.id,
          timeZone: TIME_ZONE,
          now: at(5),
          sessionId: session.id,
        }),
      ).rejects.toBeInstanceOf(SessionNotFoundError);

      const [row] = await ctx.sql`SELECT status FROM solve_sessions WHERE id = ${session.id}`;
      expect(row!.status).toBe('active');
    });
  });
});
