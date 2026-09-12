/**
 * F3.5 · the mistake aggregate, against a real database.
 *
 * Criterion 3 lives here: **inferred (unconfirmed) stuck points must not
 * inflate mistake counts.** It is asserted with a positive control on both
 * sides — confirming the same inference DOES move the number, and a reflection
 * mistake DOES move the other one — because "adding X changed nothing" is a
 * claim that passes trivially if nothing is being counted at all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  problemTags,
  problems,
  reflectionMistakes,
  reflections,
  solveSessions,
  stuckPoints,
} from '@/server/db/schema';
import { rebuildPatterns, readPatterns } from '@/server/services/mistakes/aggregate';
import { answerStuckPoint, saveInferences } from '@/server/services/inference';
import type { StuckRegion } from '@/server/services/inference/types';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const NOW = new Date('2026-07-01T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

suite('F3.5 · aggregating mistakes', () => {
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
    userId = (await createUser(ctx.db, { email: 'mistakes@example.com' })).id;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'mistakes-fixture',
        title: 'Mistakes fixture',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/mistakes-fixture/',
        difficulty: 'medium',
      })
      .returning();
    problemId = problem!.id;

    await ctx.db
      .insert(problemTags)
      .values({ problemId, tagType: 'topic', tagValue: 'binary-search' });
  });

  /** A finished session, `at` days ago. */
  async function session(at: number): Promise<string> {
    const startedAt = daysAgo(at);
    const [row] = await ctx.db
      .insert(solveSessions)
      .values({
        userId,
        problemId,
        status: 'solved',
        startedAt,
        endedAt: new Date(startedAt.getTime() + 600_000),
        startedLocalDate: startedAt.toISOString().slice(0, 10),
        endedLocalDate: startedAt.toISOString().slice(0, 10),
      })
      .returning();
    return row!.id;
  }

  /** A reflection recording one mistake category. */
  async function reflectMistake(
    sessionId: string,
    at: number,
    category: 'off_by_one' | 'wrong_data_structure',
  ) {
    const [reflection] = await ctx.db
      .insert(reflections)
      .values({ sessionId, approach: 'x', createdAt: daysAgo(at) })
      .returning();

    await ctx.db.insert(reflectionMistakes).values({ reflectionId: reflection!.id, category });
  }

  const region = (): StuckRegion => ({
    lineStart: 10,
    lineEnd: 14,
    startedSeconds: 100,
    endedSeconds: 400,
    durationSeconds: 300,
    confidence: 'high',
    evidence: ['edits stayed around lines 10–14'],
    codeSnippet: '',
    signals: ['edit_locality'],
  });

  describe("counting the user's own mistakes", () => {
    it('groups by category and topic', async () => {
      const first = await session(5);
      const second = await session(10);
      await reflectMistake(first, 5, 'off_by_one');
      await reflectMistake(second, 10, 'off_by_one');

      const rows = await rebuildPatterns(ctx.db, { userId, now: NOW });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.category).toBe('off_by_one');
      expect(rows[0]?.topic).toBe('binary-search');
      expect(rows[0]?.occurrences).toBe(2);
    });

    it('RUNNING IT TWICE LEAVES ONE SET OF ROWS', async () => {
      const one = await session(5);
      await reflectMistake(one, 5, 'off_by_one');

      await rebuildPatterns(ctx.db, { userId, now: NOW });
      await rebuildPatterns(ctx.db, { userId, now: NOW });

      expect(await readPatterns(ctx.db, userId)).toHaveLength(1);
    });

    it('splits the trend windows at thirty days', async () => {
      for (const at of [5, 10, 15]) await reflectMistake(await session(at), at, 'off_by_one');
      for (const at of [40, 45]) await reflectMistake(await session(at), at, 'off_by_one');

      const [row] = await rebuildPatterns(ctx.db, { userId, now: NOW });

      expect(row?.recentCount).toBe(3);
      expect(row?.earlierCount).toBe(2);
      expect(row?.occurrences).toBe(5);
    });
  });

  describe('CRITERION 3 · unconfirmed inferences do not inflate anything', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await session(5);
      await reflectMistake(sessionId, 5, 'off_by_one');
    });

    it('AN UNANSWERED INFERENCE CHANGES NO COUNT', async () => {
      const before = await rebuildPatterns(ctx.db, { userId, now: NOW });

      await saveInferences(ctx.db, { userId, sessionId, regions: [region(), region()] });

      const after = await rebuildPatterns(ctx.db, { userId, now: NOW });

      expect(after[0]?.occurrences).toBe(before[0]?.occurrences);
      expect(after[0]?.confirmedStuckCount).toBe(0);
    });

    it('POSITIVE CONTROL · CONFIRMING IT DOES MOVE THE NUMBER', async () => {
      /*
       * Without this, the assertion above would pass if nothing were counted at
       * all — which is exactly how a "does not inflate" test goes vacuous.
       */
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });

      const [inference] = await ctx.db
        .select({ id: stuckPoints.id })
        .from(stuckPoints)
        .where(eq(stuckPoints.status, 'inferred'));

      await answerStuckPoint(ctx.db, {
        userId,
        stuckPointId: inference!.id,
        answer: { action: 'confirm' },
        now: NOW,
      });

      const after = await rebuildPatterns(ctx.db, { userId, now: NOW });
      expect(after[0]?.confirmedStuckCount).toBe(1);
    });

    it('a DISMISSED inference counts for nothing', async () => {
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });

      const [inference] = await ctx.db
        .select({ id: stuckPoints.id })
        .from(stuckPoints)
        .where(eq(stuckPoints.status, 'inferred'));

      await answerStuckPoint(ctx.db, {
        userId,
        stuckPointId: inference!.id,
        answer: { action: 'dismiss' },
        now: NOW,
      });

      const after = await rebuildPatterns(ctx.db, { userId, now: NOW });
      expect(after[0]?.confirmedStuckCount).toBe(0);
    });

    it('KEEPS THE TWO TAXONOMIES APART', async () => {
      /*
       * `occurrences` is `mistake_category` — what went wrong.
       * `confirmedStuckCount` is `stuck_category` — where the struggle was.
       * Adding them would produce a number that means neither, and the first
       * draft of the aggregate did exactly that.
       */
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });

      const [inference] = await ctx.db
        .select({ id: stuckPoints.id })
        .from(stuckPoints)
        .where(eq(stuckPoints.status, 'inferred'));

      await answerStuckPoint(ctx.db, {
        userId,
        stuckPointId: inference!.id,
        answer: { action: 'confirm' },
        now: NOW,
      });

      const [row] = await rebuildPatterns(ctx.db, { userId, now: NOW });

      // One reflection mistake, one confirmed stuck point. Not two of anything.
      expect(row?.occurrences).toBe(1);
      expect(row?.confirmedStuckCount).toBe(1);
    });
  });

  describe('scoping', () => {
    it("never counts another user's mistakes", async () => {
      const other = (await createUser(ctx.db, { email: 'other@example.com' })).id;

      const mine = await session(5);
      await reflectMistake(mine, 5, 'off_by_one');

      const rows = await rebuildPatterns(ctx.db, { userId: other, now: NOW });
      expect(rows).toEqual([]);
    });

    it('a user with nothing gets nothing, not a zero row', async () => {
      expect(await rebuildPatterns(ctx.db, { userId, now: NOW })).toEqual([]);
      expect(await readPatterns(ctx.db, userId)).toEqual([]);
    });
  });
});
