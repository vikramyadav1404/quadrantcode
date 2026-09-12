/**
 * F1.6 · the rollup.
 *
 * The acceptance criterion is idempotency — "two runs for one day produce one
 * row set" — and the reason it is worth a criterion is that the obvious
 * implementation fails it silently. An upsert that adds to a counter doubles
 * every number on the dashboard the second time it runs, and nothing complains.
 *
 * Here a day is deleted and rewritten in one transaction, so re-running is
 * correct by construction rather than by care. These tests hold that, and the
 * cases where the difference shows: a session deleted, a topic tag removed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  analyticsDaily,
  analyticsStuckDaily,
  analyticsTopicDaily,
  problemTags,
  problems,
  reflectionStuckAreas,
  reflections,
  solveSessions,
  stuckPoints,
} from '@/server/db/schema';
import { ensureFreshRollup, rollUpDays, staleDays } from '@/server/services/analytics';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const NOW = new Date('2026-03-30T12:00:00.000Z');
const TODAY = '2026-03-30';

suite('F1.6 · rollUpDays', () => {
  let ctx: TestContext;
  let userId: string;
  let problemCounter = 0;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'rollup@example.com' })).id;
    problemCounter = 0;
  });

  /** A finished session on `localDate`, with its problem and topic tags. */
  async function seedSession(options: {
    localDate: string;
    status?: 'solved' | 'stuck' | 'abandoned';
    minutes?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    estimatedMinutes?: number;
    topics?: string[];
    confidence?: 'low' | 'medium' | 'high';
  }): Promise<string> {
    problemCounter += 1;
    const slug = `problem-${problemCounter}`;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug,
        title: `Problem ${problemCounter}`,
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: `https://leetcode.com/problems/${slug}/`,
        difficulty: options.difficulty ?? 'medium',
        estimatedMinutes: options.estimatedMinutes ?? 30,
      })
      .returning();

    for (const topic of options.topics ?? []) {
      await ctx.db
        .insert(problemTags)
        .values({ problemId: problem!.id, tagType: 'topic', tagValue: topic });
    }

    const startedAt = new Date(`${options.localDate}T09:00:00.000Z`);
    const endedAt = new Date(startedAt.getTime() + (options.minutes ?? 20) * 60_000);

    const [session] = await ctx.db
      .insert(solveSessions)
      .values({
        userId,
        problemId: problem!.id,
        status: options.status ?? 'solved',
        startedAt,
        lastHeartbeatAt: endedAt,
        endedAt,
        startedLocalDate: options.localDate,
        endedLocalDate: options.localDate,
        confidence: options.confidence ?? null,
      })
      .returning();

    return session!.id;
  }

  describe('the day row', () => {
    it('counts outcomes, sessions, time and the difficulty split', async () => {
      await seedSession({ localDate: TODAY, minutes: 20, difficulty: 'easy' });
      await seedSession({ localDate: TODAY, minutes: 40, difficulty: 'hard' });
      await seedSession({ localDate: TODAY, minutes: 15, status: 'stuck' });
      await seedSession({ localDate: TODAY, minutes: 5, status: 'abandoned' });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      const [day] = await ctx.db.select().from(analyticsDaily);
      expect(day?.sessionCount).toBe(4);
      expect(day?.solvedCount).toBe(2);
      expect(day?.stuckCount).toBe(1);
      expect(day?.abandonedCount).toBe(1);
      expect(day?.activeSeconds).toBe((20 + 40 + 15 + 5) * 60);
      expect(day?.easySolved).toBe(1);
      expect(day?.hardSolved).toBe(1);
      expect(day?.mediumSolved).toBe(0);
    });

    it('writes no row for a day with nothing on it', async () => {
      // Absent rather than zeroed, so six months of an occasional user is a
      // handful of rows rather than 180.
      await rollUpDays(ctx.db, { userId, dates: ['2026-03-29'], now: NOW });
      expect(await ctx.db.select().from(analyticsDaily)).toHaveLength(0);
    });
  });

  describe('the topic rows', () => {
    it('COUNTS A TWO-TOPIC PROBLEM IN BOTH, AND THE DAY ONLY ONCE', async () => {
      /*
       * The reason the headline and the topic table are separate tables. "How
       * am I doing at graphs" wants this session counted under graphs AND bfs;
       * "how much did I solve today" wants it counted once.
       */
      await seedSession({ localDate: TODAY, topics: ['graphs', 'bfs'], minutes: 30 });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      const [day] = await ctx.db.select().from(analyticsDaily);
      expect(day?.solvedCount).toBe(1);

      const topicRows = await ctx.db.select().from(analyticsTopicDaily);
      expect(topicRows.map((row) => row.topic).sort()).toEqual(['bfs', 'graphs']);
      expect(topicRows.every((row) => row.solvedCount === 1)).toBe(true);
      expect(topicRows.every((row) => row.activeSeconds === 1_800)).toBe(true);
    });

    it('keeps an untagged problem out of the topic table but in the day total', async () => {
      await seedSession({ localDate: TODAY, topics: [] });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      expect(await ctx.db.select().from(analyticsTopicDaily)).toHaveLength(0);
      const [day] = await ctx.db.select().from(analyticsDaily);
      expect(day?.solvedCount).toBe(1);
    });

    it('EXCLUDES AN ABANDONED SESSION FROM EVERY TOPIC', async () => {
      /*
       * Walking away from a tab is not evidence about a subject either way —
       * the same judgement D20 makes when it refuses to count abandonment as an
       * attempt. Counting it as a topic session would drag the failed-attempt
       * ratio around for reasons unrelated to the topic.
       */
      await seedSession({ localDate: TODAY, topics: ['graphs'], status: 'abandoned' });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      expect(await ctx.db.select().from(analyticsTopicDaily)).toHaveLength(0);
      const [day] = await ctx.db.select().from(analyticsDaily);
      expect(day?.abandonedCount).toBe(1);
    });

    it('sums confidence and its count, never an average', async () => {
      // An average of averages is not an average. The dashboard divides once,
      // at the end, over whatever range it is showing.
      await seedSession({ localDate: TODAY, topics: ['dp'], confidence: 'high' });
      await seedSession({ localDate: TODAY, topics: ['dp'], confidence: 'low' });
      await seedSession({ localDate: TODAY, topics: ['dp'] }); // said nothing

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      const [row] = await ctx.db.select().from(analyticsTopicDaily);
      expect(row?.sessionCount).toBe(3);
      expect(row?.confidenceSum).toBe(4); // 3 + 1
      expect(row?.confidenceCount).toBe(2); // the silent one is in neither
    });

    it('carries the estimate so slowness can be computed later', async () => {
      await seedSession({
        localDate: TODAY,
        topics: ['greedy'],
        minutes: 60,
        estimatedMinutes: 30,
      });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      const [row] = await ctx.db.select().from(analyticsTopicDaily);
      expect(row?.activeSeconds).toBe(3_600);
      expect(row?.estimatedSeconds).toBe(1_800);
    });
  });

  describe('the stuck distribution', () => {
    it('keeps a live marker separate from a reflected one', async () => {
      /*
       * What the user felt at the time and what they concluded afterwards are
       * different observations. F3.3 will add a third kind — inferred — and it
       * must not be able to hide inside either of these.
       */
      const sessionId = await seedSession({ localDate: TODAY });

      await ctx.db
        .insert(stuckPoints)
        .values({ sessionId, category: 'debugging', elapsedSeconds: 300 });

      const [reflection] = await ctx.db.insert(reflections).values({ sessionId }).returning();
      await ctx.db
        .insert(reflectionStuckAreas)
        .values({ reflectionId: reflection!.id, category: 'debugging' });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      const [row] = await ctx.db.select().from(analyticsStuckDaily);
      expect(row?.category).toBe('debugging');
      expect(row?.markedCount).toBe(1);
      expect(row?.reflectedCount).toBe(1);
    });

    it('ignores an inferred marker, which only F3.3 will write', async () => {
      const sessionId = await seedSession({ localDate: TODAY });
      await ctx.db.insert(stuckPoints).values({
        sessionId,
        category: 'approach',
        elapsedSeconds: 60,
        source: 'inferred',
      });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      expect(await ctx.db.select().from(analyticsStuckDaily)).toHaveLength(0);
    });
  });

  describe('idempotency', () => {
    it('TWO RUNS FOR ONE DAY PRODUCE ONE ROW SET', async () => {
      // The acceptance criterion.
      await seedSession({ localDate: TODAY, topics: ['graphs'], minutes: 25 });
      await seedSession({ localDate: TODAY, topics: ['graphs'], status: 'stuck' });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });
      const first = await readAll();

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });
      const second = await readAll();

      expect(second.days).toEqual(first.days);
      expect(second.topics).toEqual(first.topics);
      expect(second.counts).toEqual({ days: 1, topics: 1, stuck: 0 });
    });

    it('a third and fourth run change nothing either', async () => {
      await seedSession({ localDate: TODAY, topics: ['dp'] });

      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });
      const first = await readAll();

      for (let run = 0; run < 3; run += 1) {
        await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });
      }

      expect(await readAll()).toEqual(first);
    });

    it('THE ASSERTION CAN FAIL — a new session does change the numbers', async () => {
      /*
       * The positive control. "Nothing changed" would also pass if the rollup
       * were writing nothing at all, or reading the wrong user.
       */
      await seedSession({ localDate: TODAY, topics: ['dp'] });
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });
      const before = await readAll();

      await seedSession({ localDate: TODAY, topics: ['dp'] });
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      expect(await readAll()).not.toEqual(before);
    });

    it('DROPS A DAY WHOSE SESSIONS ARE GONE', async () => {
      /*
       * Where delete-and-rewrite differs from an upsert. An upsert leaves the
       * old row in place, and the dashboard keeps reporting activity that no
       * longer exists.
       */
      const sessionId = await seedSession({ localDate: TODAY, topics: ['graphs'] });
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });
      expect(await ctx.db.select().from(analyticsDaily)).toHaveLength(1);

      await ctx.db.delete(solveSessions).where(eq(solveSessions.id, sessionId));
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      expect(await ctx.db.select().from(analyticsDaily)).toHaveLength(0);
      expect(await ctx.db.select().from(analyticsTopicDaily)).toHaveLength(0);
    });

    it('drops a topic row when the tag is removed', async () => {
      await seedSession({ localDate: TODAY, topics: ['graphs', 'bfs'] });
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });
      expect(await ctx.db.select().from(analyticsTopicDaily)).toHaveLength(2);

      await ctx.db.delete(problemTags).where(eq(problemTags.tagValue, 'bfs'));
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      const rows = await ctx.db.select().from(analyticsTopicDaily);
      expect(rows.map((row) => row.topic)).toEqual(['graphs']);
    });

    it("never touches another user's rows", async () => {
      const other = await createUser(ctx.db, { email: 'other-rollup@example.com' });
      await seedSession({ localDate: TODAY, topics: ['graphs'] });
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      await rollUpDays(ctx.db, { userId: other.id, dates: [TODAY], now: NOW });

      const rows = await ctx.db.select().from(analyticsDaily);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.userId).toBe(userId);
    });
  });

  describe('freshness', () => {
    it('finds a day that has never been rolled up', async () => {
      await seedSession({ localDate: TODAY });
      expect(await staleDays(ctx.db, { userId, limit: 10 })).toEqual([TODAY]);
    });

    it('stops reporting a day once it is rolled up', async () => {
      await seedSession({ localDate: TODAY });
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });

      expect(await staleDays(ctx.db, { userId, limit: 10 })).toEqual([]);
    });

    it('A REFLECTION SAVED LATER MAKES ITS DAY STALE AGAIN', async () => {
      /*
       * A reflection can be written days after the session — F1.5 makes it
       * skippable and offers it again later — and it changes the topic
       * confidence and the stuck distribution. Without this clause the
       * dashboard would never see it.
       */
      const sessionId = await seedSession({ localDate: TODAY, topics: ['dp'] });
      await rollUpDays(ctx.db, { userId, dates: [TODAY], now: NOW });
      expect(await staleDays(ctx.db, { userId, limit: 10 })).toEqual([]);

      // Written now, which is after the rollup ran — the real sequence, and the
      // reason both timestamps have to come from the database's clock.
      await ctx.db.insert(reflections).values({ sessionId });

      expect(await staleDays(ctx.db, { userId, limit: 10 })).toEqual([TODAY]);
    });

    it('caps the work per call and says it is still catching up', async () => {
      for (const day of ['2026-03-28', '2026-03-29', '2026-03-30']) {
        await seedSession({ localDate: day });
      }

      const status = await ensureFreshRollup(ctx.db, {
        userId,
        today: TODAY,
        now: NOW,
        maxDays: 2,
      });

      expect(status.rolledUp).toBe(2);
      expect(status.catchingUp).toBe(true);
      expect(status.asOf).not.toBeNull();

      // Newest first, so the most recent days are the ones the user sees.
      const rows = await ctx.db.select().from(analyticsDaily);
      expect(rows.map((row) => String(row.localDate).slice(0, 10)).sort()).toEqual([
        '2026-03-29',
        '2026-03-30',
      ]);
    });

    it('reports nothing to do once everything is current', async () => {
      await seedSession({ localDate: TODAY });
      await ensureFreshRollup(ctx.db, { userId, today: TODAY, now: NOW });

      const second = await ensureFreshRollup(ctx.db, { userId, today: TODAY, now: NOW });
      expect(second.rolledUp).toBe(0);
      expect(second.catchingUp).toBe(false);
    });
  });

  /** Every rollup row, with the timestamps stripped so values can be compared. */
  async function readAll() {
    const days = await ctx.db.select().from(analyticsDaily);
    const topics = await ctx.db.select().from(analyticsTopicDaily);
    const stuck = await ctx.db.select().from(analyticsStuckDaily);

    const strip = <T extends { id: string; computedAt: Date }>(rows: T[]) =>
      rows
        .map(({ id: _id, computedAt: _computedAt, ...rest }) => rest)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

    return {
      days: strip(days),
      topics: strip(topics),
      stuck: strip(stuck),
      counts: { days: days.length, topics: topics.length, stuck: stuck.length },
    };
  }
});
