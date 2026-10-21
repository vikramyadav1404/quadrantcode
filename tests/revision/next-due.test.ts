/**
 * C3 · `getNextRevisionDate`, the one read-only function the v2 plan approved
 * for the history card.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { problems, revisionSchedule } from '@/server/db/schema';
import { completeSession, startSession } from '@/server/services/session';
import { getNextRevisionDate } from '@/server/services/revision';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const TIME_ZONE = 'Asia/Kolkata';
const START = new Date('2026-05-01T04:00:00.000Z');

suite('C3 · getNextRevisionDate', () => {
  let ctx: TestContext;
  let userId: string;
  let otherUserId: string;
  let problemId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'next-due@example.com', timezone: TIME_ZONE }))
      .id;
    otherUserId = (
      await createUser(ctx.db, { email: 'next-due-other@example.com', timezone: TIME_ZONE })
    ).id;
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'next-due-fixture',
        title: 'Next due fixture',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/next-due-fixture/',
        difficulty: 'easy',
      })
      .returning();
    problemId = problem!.id;
  });

  /** A finished sitting through the real F1.4 path. */
  async function finish(forUser: string, outcome: 'solved' | 'stuck') {
    const session = await startSession(ctx.db, {
      userId: forUser,
      timeZone: TIME_ZONE,
      now: START,
      problemId,
    });
    await completeSession(ctx.db, {
      userId: forUser,
      timeZone: TIME_ZONE,
      now: new Date(START.getTime() + 20 * 60_000),
      sessionId: session.id,
      outcome,
    });
  }

  it('RETURNS THE SCHEDULED LOCAL DATE after a solve, exactly as stored', async () => {
    await finish(userId, 'solved');
    const [schedule] = await ctx.db.select().from(revisionSchedule);

    const next = await getNextRevisionDate(ctx.db, { userId, problemId });
    expect(next).toBe(schedule!.dueLocalDate);
    expect(next).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is null when the problem was never finished', async () => {
    expect(await getNextRevisionDate(ctx.db, { userId, problemId })).toBeNull();
  });

  it('IS NULL AFTER A STUCK-ONLY ATTEMPT: giving up schedules nothing', async () => {
    await finish(userId, 'stuck');
    expect(await getNextRevisionDate(ctx.db, { userId, problemId })).toBeNull();
  });

  it("NEVER RETURNS ANOTHER USER'S SCHEDULE", async () => {
    await finish(otherUserId, 'solved');
    expect(await getNextRevisionDate(ctx.db, { userId, problemId })).toBeNull();
    // POSITIVE CONTROL: the other user's row really exists.
    expect(
      await getNextRevisionDate(ctx.db, { userId: otherUserId, problemId }),
    ).not.toBeNull();
  });

  it('WRITES NOTHING', async () => {
    await finish(userId, 'solved');
    const before = await ctx.db.select().from(revisionSchedule);
    await getNextRevisionDate(ctx.db, { userId, problemId });
    await getNextRevisionDate(ctx.db, { userId: otherUserId, problemId });
    expect(await ctx.db.select().from(revisionSchedule)).toEqual(before);
  });
});
