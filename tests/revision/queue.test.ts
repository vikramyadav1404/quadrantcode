/**
 * F2.1 · the due queue against a real database.
 *
 * The ladder and the score are proved pure elsewhere. What is only checkable
 * here is that they are wired to the right facts: that finishing a solve
 * actually schedules something, that the queue reads the signals it claims to,
 * and that the cap holds back work without hiding it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  problemTags,
  problems,
  reflectionMistakes,
  reflections,
  revisionSchedule,
} from '@/server/db/schema';
import { completeSession, startSession } from '@/server/services/session';
import { DEFAULT_DAILY_CAP, dueToday, recordRevisionOutcome } from '@/server/services/revision';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const START = new Date('2026-03-02T10:00:00.000Z');
const TODAY = '2026-03-02';
const TIME_ZONE = 'Asia/Kolkata';

const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

suite('F2.1 · scheduling and the due queue', () => {
  let ctx: TestContext;
  let userId: string;
  let counter = 0;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'revision@example.com', timezone: TIME_ZONE }))
      .id;
    counter = 0;
  });

  async function makeProblem(options: { topic?: string; estimatedMinutes?: number } = {}) {
    counter += 1;
    const slug = `problem-${counter}`;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug,
        title: `Problem ${counter}`,
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: `https://leetcode.com/problems/${slug}/`,
        difficulty: 'medium',
        estimatedMinutes: options.estimatedMinutes ?? 30,
      })
      .returning();

    if (options.topic) {
      await ctx.db
        .insert(problemTags)
        .values({ problemId: problem!.id, tagType: 'topic', tagValue: options.topic });
    }

    return problem!.id;
  }

  /** Solve a problem through the real F1.4 path, which is what schedules it. */
  async function solve(
    problemId: string,
    options: { minutes?: number; confidence?: 'low' | 'medium' | 'high'; startAt?: Date } = {},
  ) {
    const startAt = options.startAt ?? START;
    const session = await startSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: startAt,
      problemId,
    });

    await completeSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: new Date(startAt.getTime() + (options.minutes ?? 20) * 60_000),
      sessionId: session.id,
      outcome: 'solved',
      ...(options.confidence ? { confidence: options.confidence } : {}),
    });
  }

  describe('a solve schedules its revision', () => {
    it('SCHEDULES INSIDE THE COMPLETION ITSELF', async () => {
      /*
       * The wiring that matters most. A completed solve whose revision was never
       * scheduled is a problem that silently never comes back — and unlike the
       * streak, nothing downstream would notice and repair it.
       */
      const problemId = await makeProblem();
      await solve(problemId);

      const [schedule] = await ctx.db.select().from(revisionSchedule);

      expect(schedule?.problemId).toBe(problemId);
      expect(schedule?.ladderKind).toBe('standard');
      expect(schedule?.intervalDays).toBe(1);
      expect(String(schedule?.dueLocalDate)).toContain('2026-03-03');
    });

    it('puts a low-confidence solve on the compressed ladder', async () => {
      const problemId = await makeProblem();
      await solve(problemId, { confidence: 'low' });

      const [schedule] = await ctx.db.select().from(revisionSchedule);
      expect(schedule?.ladderKind).toBe('compressed');
    });

    it('compresses when the solve ran long', async () => {
      // 90 minutes against a 30-minute estimate is past 1.5×, so the step drops
      // — from rung 0 it has nowhere to drop to, which is the floor holding.
      const problemId = await makeProblem({ estimatedMinutes: 30 });
      await solve(problemId, { minutes: 90 });

      const [schedule] = await ctx.db.select().from(revisionSchedule);
      expect(schedule?.intervalDays).toBe(1);
      expect(schedule?.ladderIndex).toBe(0);
    });

    it('CONTINUES FROM THE CURRENT RUNG WHEN SOLVED AGAIN', async () => {
      /*
       * Re-solving a problem must not drop it back to a one-day gap. A user
       * revisiting something they have held for months would otherwise be
       * punished for the revisit.
       */
      const problemId = await makeProblem();
      await solve(problemId);

      await ctx.db
        .update(revisionSchedule)
        .set({ ladderIndex: 3, intervalDays: 14 })
        .where(eq(revisionSchedule.problemId, problemId));

      await solve(problemId, { startAt: at(600) });

      const [schedule] = await ctx.db.select().from(revisionSchedule);
      // Still high on the ladder, and one row rather than two.
      expect(schedule?.ladderIndex).toBeGreaterThanOrEqual(3);
      expect(await ctx.db.select().from(revisionSchedule)).toHaveLength(1);
    });

    it('does not schedule anything for a stuck sitting', async () => {
      const problemId = await makeProblem();
      const session = await startSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: START,
        problemId,
      });
      await completeSession(ctx.db, {
        userId,
        timeZone: TIME_ZONE,
        now: at(30),
        sessionId: session.id,
        outcome: 'stuck',
      });

      expect(await ctx.db.select().from(revisionSchedule)).toHaveLength(0);
    });
  });

  describe('the queue', () => {
    /** Schedule `count` problems as due today, oldest first. */
    async function seedDue(count: number) {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const problemId = await makeProblem();
        ids.push(problemId);

        await ctx.db.insert(revisionSchedule).values({
          userId,
          problemId,
          intervalDays: 3,
          dueLocalDate: '2026-03-01',
        });
      }
      return ids;
    }

    it('returns nothing when nothing is due', async () => {
      const problemId = await makeProblem();
      await ctx.db.insert(revisionSchedule).values({
        userId,
        problemId,
        intervalDays: 7,
        dueLocalDate: '2026-04-01',
      });

      const queue = await dueToday(ctx.db, { userId, today: TODAY });
      expect(queue.items).toEqual([]);
      expect(queue.totalDue).toBe(0);
    });

    it('CAPS THE LIST BUT REPORTS THE WHOLE TOTAL', async () => {
      /*
       * A list of sixty is a list nobody starts. The cap makes the work
       * startable; `totalDue` keeps the number honest, so the user is not told
       * they have five when they have sixty.
       */
      await seedDue(9);

      const queue = await dueToday(ctx.db, { userId, today: TODAY });

      expect(queue.items).toHaveLength(DEFAULT_DAILY_CAP);
      expect(queue.totalDue).toBe(9);
      expect(queue.cap).toBe(DEFAULT_DAILY_CAP);
    });

    it('takes a different cap when asked', async () => {
      await seedDue(4);
      const queue = await dueToday(ctx.db, { userId, today: TODAY, cap: 2 });

      expect(queue.items).toHaveLength(2);
      expect(queue.totalDue).toBe(4);
    });

    it('ORDERS BY RISK, AND EVERY ITEM CARRIES ITS FACTORS', async () => {
      // The riskier problem is more overdue and was solved with low confidence.
      const calm = await makeProblem();
      const risky = await makeProblem();

      await ctx.db.insert(revisionSchedule).values([
        { userId, problemId: calm, intervalDays: 3, dueLocalDate: TODAY },
        { userId, problemId: risky, intervalDays: 3, dueLocalDate: '2026-02-16' },
      ]);

      const queue = await dueToday(ctx.db, { userId, today: TODAY });

      expect(queue.items[0]?.problemId).toBe(risky);
      expect(queue.items[0]!.risk.score).toBeGreaterThan(queue.items[1]!.risk.score);
      expect(queue.items[0]!.risk.factors.length).toBeGreaterThan(0);
      expect(queue.items[0]!.daysOverdue).toBe(14);
    });

    it('reads the mistakes recorded against a problem', async () => {
      const problemId = await makeProblem();
      await solve(problemId);

      const [session] = await ctx.sql`SELECT id FROM solve_sessions LIMIT 1`;
      const [reflection] = await ctx.db
        .insert(reflections)
        .values({ sessionId: String(session!.id) })
        .returning();
      await ctx.db
        .insert(reflectionMistakes)
        .values({ reflectionId: reflection!.id, category: 'wrong_data_structure' });

      await ctx.db
        .update(revisionSchedule)
        .set({ dueLocalDate: TODAY })
        .where(eq(revisionSchedule.problemId, problemId));

      const queue = await dueToday(ctx.db, { userId, today: TODAY });
      const labels = queue.items[0]!.risk.factors.map((factor) => factor.label).join(' | ');

      expect(labels).toContain('wrong data structure');
    });

    it("never shows another user's schedule", async () => {
      const other = await createUser(ctx.db, { email: 'other-revision@example.com' });
      const problemId = await makeProblem();

      await ctx.db.insert(revisionSchedule).values({
        userId: other.id,
        problemId,
        intervalDays: 1,
        dueLocalDate: TODAY,
      });

      const queue = await dueToday(ctx.db, { userId, today: TODAY });
      expect(queue.items).toEqual([]);
    });
  });

  describe('recording an outcome', () => {
    async function scheduled(index: number) {
      const problemId = await makeProblem();
      await ctx.db.insert(revisionSchedule).values({
        userId,
        problemId,
        ladderIndex: index,
        intervalDays: 7,
        dueLocalDate: TODAY,
      });
      return problemId;
    }

    it('CLEAN advances the ladder and pushes the date out', async () => {
      const problemId = await scheduled(1);

      const next = await recordRevisionOutcome(ctx.db, {
        userId,
        problemId,
        outcome: 'clean',
        today: TODAY,
      });

      expect(next?.intervalDays).toBe(7);
      const [row] = await ctx.db.select().from(revisionSchedule);
      expect(row?.ladderIndex).toBe(2);
      expect(row?.revisionCount).toBe(1);
      expect(String(row?.lastRevisedLocalDate)).toContain(TODAY);
    });

    it('STRUGGLED repeats the same interval', async () => {
      const problemId = await scheduled(3);

      const next = await recordRevisionOutcome(ctx.db, {
        userId,
        problemId,
        outcome: 'struggled',
        today: TODAY,
      });

      expect(next?.intervalDays).toBe(14);
      const [row] = await ctx.db.select().from(revisionSchedule);
      expect(row?.ladderIndex).toBe(3);
    });

    it('FAILED resets to a one-day gap', async () => {
      const problemId = await scheduled(4);

      const next = await recordRevisionOutcome(ctx.db, {
        userId,
        problemId,
        outcome: 'failed',
        today: TODAY,
      });

      expect(next?.intervalDays).toBe(1);
      expect(next?.dueLocalDate).toBe('2026-03-03');
      const [row] = await ctx.db.select().from(revisionSchedule);
      expect(row?.ladderIndex).toBe(0);
    });

    it('is null for a problem that was never scheduled', async () => {
      // Revising something never solved is not an error; there is simply no
      // ladder to move.
      const problemId = await makeProblem();

      const next = await recordRevisionOutcome(ctx.db, {
        userId,
        problemId,
        outcome: 'clean',
        today: TODAY,
      });

      expect(next).toBeNull();
    });

    it("refuses to move another user's schedule", async () => {
      const other = await createUser(ctx.db, { email: 'intruder-revision@example.com' });
      const problemId = await scheduled(2);

      const next = await recordRevisionOutcome(ctx.db, {
        userId: other.id,
        problemId,
        outcome: 'failed',
        today: TODAY,
      });

      expect(next).toBeNull();

      const [row] = await ctx.db
        .select()
        .from(revisionSchedule)
        .where(
          and(eq(revisionSchedule.userId, userId), eq(revisionSchedule.problemId, problemId)),
        );
      expect(row?.ladderIndex).toBe(2);
    });
  });
});
