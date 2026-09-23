/**
 * Confidence reaching the revision ladder — end to end, against a real Postgres.
 *
 * ## Why this test exists rather than a unit test of the ladder
 *
 * `scheduleAfterSolve` has always handled confidence correctly in isolation.
 * The failure was upstream and invisible to a unit test: **nothing collected
 * the value before the schedule was written.** `TimerBar.onComplete` was typed
 * `{ sessionId, outcome }` with no confidence field at all, and
 * `ReflectionForm` asks only on `/sessions/[id]/reflect` — after
 * `completeSession` has already written the row, with no path re-scheduling.
 *
 * So two of the ladder's five rules had never fired in production:
 *
 *   low-confidence-ladder  needs confidence === 'low'
 *   clean-and-quick        needs confidence === 'high'
 *
 * A test of the pure function would have passed throughout. The claim worth
 * asserting is the whole path — call `completeSession` with a confidence, read
 * the persisted `revision_schedule` row — because that is the link that was
 * broken.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { problems, revisionSchedule, solveSessions } from '@/server/db/schema';
import { completeSession } from '@/server/services/session';
import type { Confidence } from '@/lib/session/confidence';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-09-23T10:00:00.000Z');
/** Generous, so a short sitting is comfortably "inside the estimate". */
const ESTIMATED_MINUTES = 30;

suite('F2.1 · confidence reaches the ladder through completeSession', () => {
  let ctx: TestContext;
  let userId = '';

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { timezone: TZ })).id;
  });

  async function solveWith(
    slug: string,
    confidence: Confidence | undefined,
    options: { activeSeconds?: number } = {},
  ) {
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug,
        title: `Problem ${slug}`,
        sourceType: 'original',
        difficulty: 'medium',
        statement: 'Our own original statement text.',
        estimatedMinutes: ESTIMATED_MINUTES,
      })
      .returning({ id: problems.id });

    // A short sitting: well inside the estimate, so `slow-solve` cannot fire and
    // confound the rule under test.
    const activeSeconds = options.activeSeconds ?? 120;
    const startedAt = new Date(NOW.getTime() - activeSeconds * 1000);
    const [session] = await ctx.db
      .insert(solveSessions)
      .values({
        userId,
        problemId: problem!.id,
        status: 'active',
        startedAt,
        lastHeartbeatAt: NOW,
        startedLocalDate: '2026-09-23',
      })
      .returning({ id: solveSessions.id });

    await completeSession(ctx.db, {
      userId,
      timeZone: TZ,
      now: NOW,
      sessionId: session!.id,
      outcome: 'solved',
      ...(confidence ? { confidence } : {}),
    });

    const [row] = await ctx.db
      .select({
        ladderKind: revisionSchedule.ladderKind,
        ladderIndex: revisionSchedule.ladderIndex,
        intervalDays: revisionSchedule.intervalDays,
      })
      .from(revisionSchedule)
      .where(
        and(eq(revisionSchedule.userId, userId), eq(revisionSchedule.problemId, problem!.id)),
      );
    return row!;
  }

  it("'low' selects the compressed ladder — a rule that had never fired", async () => {
    const row = await solveWith('low-confidence', 'low');
    expect(row.ladderKind).toBe('compressed');
  });

  it("'high' on a quick unaided solve lengthens the gap — the other dead rule", async () => {
    const high = await solveWith('high-confidence', 'high');
    const none = await solveWith('no-confidence', undefined);

    // clean-and-quick is the only rule that ADDS a step, so a confident solve
    // must land on a later rung than the same solve with no answer.
    expect(high.ladderIndex).toBeGreaterThan(none.ladderIndex);
    expect(high.intervalDays).toBeGreaterThan(none.intervalDays);
  });

  /*
   * The positive control, and it runs in both directions.
   *
   * Every assertion above says "confidence changed the outcome". That is only
   * meaningful if the absence of confidence leaves the outcome alone — otherwise
   * an implementation that compressed or advanced unconditionally would satisfy
   * them. This pins the baseline the other two are measured against, and would
   * fail if `Skip` were silently coerced to a rating.
   */
  it('no confidence leaves the standard ladder at its starting rung', async () => {
    const row = await solveWith('declined', undefined);
    expect(row.ladderKind).toBe('standard');
    expect(row.ladderIndex).toBe(0);
  });

  it('a LOW-confidence solve is not merely the standard ladder relabelled', async () => {
    // The two ladders have different intervals; if `compressed` were a synonym
    // the kind assertion above would be decorative.
    const low = await solveWith('low-again', 'low');
    const none = await solveWith('none-again', undefined);
    expect(low.ladderKind).not.toBe(none.ladderKind);
    expect(low.intervalDays).toBeLessThanOrEqual(none.intervalDays);
  });
});
