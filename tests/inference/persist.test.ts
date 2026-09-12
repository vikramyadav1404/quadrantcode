/**
 * F3.3 · inferences in the database.
 *
 * Two criteria live here:
 *
 *   · "Confirm, adjust-range, and dismiss all persist correctly"
 *   · "Confirmed vs inferred are separable in a single SQL query"
 *
 * The second is asserted with actual SQL rather than through the service,
 * because that is the shape of the claim: F3.5 and F2.1 will read these rows
 * with a WHERE clause, and a service method that happens to filter correctly
 * proves nothing about what they will get.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { problems, solveSessions, stuckPoints } from '@/server/db/schema';
import {
  StuckPointNotFoundError,
  answerStuckPoint,
  loadStuckPoints,
  saveInferences,
} from '@/server/services/inference';
import { markStuck } from '@/server/services/reflection';
import { weightFor } from '@/lib/inference/confidence';
import type { StuckRegion } from '@/server/services/inference/types';
import {
  type TestContext,
  createUser,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const START = new Date('2026-06-01T09:00:00.000Z');

function region(overrides: Partial<StuckRegion> = {}): StuckRegion {
  return {
    lineStart: 10,
    lineEnd: 14,
    startedSeconds: 120,
    endedSeconds: 400,
    durationSeconds: 280,
    confidence: 'high',
    evidence: ['edits stayed around lines 10–14 for 4m40s'],
    codeSnippet: 'if lo < hi:',
    signals: ['edit_locality'],
    ...overrides,
  };
}

suite('F3.3 · inferences in the database', () => {
  let ctx: TestContext;
  let userId: string;
  let otherUserId: string;
  let sessionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'infer@example.com' })).id;
    otherUserId = (await createUser(ctx.db, { email: 'other@example.com' })).id;

    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'infer-fixture',
        title: 'Inference fixture',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/infer-fixture/',
        difficulty: 'easy',
      })
      .returning();

    const [session] = await ctx.db
      .insert(solveSessions)
      .values({
        userId,
        problemId: problem!.id,
        startedAt: START,
        startedLocalDate: '2026-06-01',
      })
      .returning();
    sessionId = session!.id;
  });

  const inferredRows = async () =>
    ctx.db.select().from(stuckPoints).where(eq(stuckPoints.sessionId, sessionId));

  describe('writing inferences', () => {
    it('writes them with no category, which the CHECK permits only for inferences', async () => {
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });

      const [row] = await inferredRows();
      expect(row?.source).toBe('inferred');
      expect(row?.category).toBeNull();
      expect(row?.status).toBe('inferred');
      expect(row?.lineStart).toBe(10);
    });

    it('REFUSES A USER ROW WITH NO CATEGORY, at the database', async () => {
      /*
       * The backstop for the nullable column. Without it, a bug in this writer
       * could put a categoryless row in front of the user as their own words.
       */
      await expectDbRejection(
        ctx.db.execute(
          sql`insert into stuck_points (session_id, elapsed_seconds, source)
              values (${sessionId}, 10, 'user')`,
        ),
        'stuck_points_user_has_category',
      );
    });

    it('refuses an inverted line range', async () => {
      await expectDbRejection(
        ctx.db.execute(
          sql`insert into stuck_points (session_id, elapsed_seconds, source, line_start, line_end)
              values (${sessionId}, 10, 'inferred', 40, 10)`,
        ),
        'stuck_points_line_range_coherent',
      );
    });

    it('RUNNING IT TWICE LEAVES ONE SET OF ROWS', async () => {
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });

      expect(await inferredRows()).toHaveLength(1);
    });

    it('NEVER OVERWRITES AN ANSWER THE USER ALREADY GAVE', async () => {
      /*
       * Re-proposing something somebody dismissed is this feature arguing with
       * them. Re-writing something they confirmed discards the evidence they
       * agreed to.
       */
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });
      const [first] = await inferredRows();

      await answerStuckPoint(ctx.db, {
        userId,
        stuckPointId: first!.id,
        answer: { action: 'dismiss' },
        now: new Date(),
      });

      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });

      const rows = await inferredRows();
      expect(rows.find((row) => row.id === first!.id)?.status).toBe('dismissed');
    });

    it('does not write a user marker back into the table', async () => {
      // The ranking includes user markers so the UI gets one ordered list.
      // Writing them would duplicate every marker on every re-run.
      await saveInferences(ctx.db, {
        userId,
        sessionId,
        regions: [region({ confidence: 'user_marked' })],
      });

      expect(await inferredRows()).toHaveLength(0);
    });

    it("writes nothing for another user's session", async () => {
      await saveInferences(ctx.db, { userId: otherUserId, sessionId, regions: [region()] });
      expect(await inferredRows()).toHaveLength(0);
    });
  });

  describe('answering', () => {
    let stuckPointId: string;

    beforeEach(async () => {
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });
      const [row] = await inferredRows();
      stuckPointId = row!.id;
    });

    it('CONFIRM persists', async () => {
      await answerStuckPoint(ctx.db, {
        userId,
        stuckPointId,
        answer: { action: 'confirm' },
        now: new Date(),
      });

      const [row] = await inferredRows();
      expect(row?.status).toBe('confirmed');
      // Origin is unchanged: we still proposed it, they still agreed.
      expect(row?.source).toBe('inferred');
    });

    it('DISMISS persists', async () => {
      await answerStuckPoint(ctx.db, {
        userId,
        stuckPointId,
        answer: { action: 'dismiss' },
        now: new Date(),
      });

      expect((await inferredRows())[0]?.status).toBe('dismissed');
    });

    it('ADJUST persists the new range AND confirms', async () => {
      /*
       * Somebody who takes the trouble to correct the range has agreed there
       * was a stuck point. Two buttons for one judgement is the form getting in
       * the way of the answer.
       */
      await answerStuckPoint(ctx.db, {
        userId,
        stuckPointId,
        answer: { action: 'adjust', lineStart: 20, lineEnd: 25 },
        now: new Date(),
      });

      const [row] = await inferredRows();
      expect(row?.lineStart).toBe(20);
      expect(row?.lineEnd).toBe(25);
      expect(row?.status).toBe('confirmed');
    });

    it("refuses another user's stuck point, without confirming it exists", async () => {
      await expect(
        answerStuckPoint(ctx.db, {
          userId: otherUserId,
          stuckPointId,
          answer: { action: 'confirm' },
          now: new Date(),
        }),
      ).rejects.toThrow(StuckPointNotFoundError);

      expect((await inferredRows())[0]?.status).toBe('inferred');
    });

    it('refuses to "confirm" a marker the user typed themselves', async () => {
      const marker = await markStuck(ctx.db, {
        userId,
        sessionId,
        category: 'implementation',
        now: new Date(START.getTime() + 60_000),
      });

      await expect(
        answerStuckPoint(ctx.db, {
          userId,
          stuckPointId: marker.id,
          answer: { action: 'confirm' },
          now: new Date(),
        }),
      ).rejects.toThrow(StuckPointNotFoundError);
    });
  });

  describe('CONFIRMED AND INFERRED ARE SEPARABLE IN ONE SQL QUERY', () => {
    beforeEach(async () => {
      await saveInferences(ctx.db, {
        userId,
        sessionId,
        regions: [region(), region({ lineStart: 40, lineEnd: 44, startedSeconds: 600 })],
      });

      const rows = await inferredRows();
      await answerStuckPoint(ctx.db, {
        userId,
        stuckPointId: rows[0]!.id,
        answer: { action: 'confirm' },
        now: new Date(),
      });
    });

    it('one WHERE clause splits them', async () => {
      // The criterion, in the form F3.5 and F2.1 will actually use.
      const confirmed = await ctx.db.execute(
        sql`select count(*)::int as n from stuck_points
            where session_id = ${sessionId} and status = 'confirmed'`,
      );
      const unanswered = await ctx.db.execute(
        sql`select count(*)::int as n from stuck_points
            where session_id = ${sessionId} and status = 'inferred'`,
      );

      expect(Number(confirmed[0]!['n'])).toBe(1);
      expect(Number(unanswered[0]!['n'])).toBe(1);
    });

    it('one GROUP BY reports the whole picture', async () => {
      const rows = await ctx.db.execute(
        sql`select source, status, count(*)::int as n from stuck_points
            where session_id = ${sessionId} group by source, status order by status`,
      );

      expect(rows).toHaveLength(2);
    });

    it('an unconfirmed inference weighs less than a confirmed one, and a dismissal weighs nothing', () => {
      // The documented discount, asserted rather than described.
      expect(weightFor('confirmed')).toBe(1);
      expect(weightFor('inferred')).toBe(0.4);
      expect(weightFor('dismissed')).toBe(0);

      // Two unconfirmed guesses must not outvote one thing the user said.
      expect(weightFor('inferred') * 2).toBeLessThan(weightFor('confirmed'));
    });
  });

  describe('reading', () => {
    it("returns the user's markers and our inferences together", async () => {
      await markStuck(ctx.db, {
        userId,
        sessionId,
        category: 'debugging',
        now: new Date(START.getTime() + 60_000),
      });
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });

      const rows = await loadStuckPoints(ctx.db, { userId, sessionId });

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.source).sort()).toEqual(['inferred', 'user']);
    });

    it("returns nothing for another user's session", async () => {
      await saveInferences(ctx.db, { userId, sessionId, regions: [region()] });
      expect(await loadStuckPoints(ctx.db, { userId: otherUserId, sessionId })).toEqual([]);
    });
  });
});
