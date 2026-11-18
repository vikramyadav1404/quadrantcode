/**
 * FSRS — the pure model, and the opt-in wiring against a real database.
 *
 * The wiring claim that matters most is the negative one: a user who never
 * opts in gets exactly the ladder, and switching never moves a date already set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { problems, revisionSchedule, userProfiles } from '@/server/db/schema';
import { completeSession, startSession } from '@/server/services/session';
import {
  gradeForOutcome,
  gradeForSolve,
  initialState,
  intervalFor,
  nextState,
  recordRevisionOutcome,
  retrievability,
  stateFromLadder,
} from '@/server/services/revision';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const SIGNALS = {
  confidence: 'medium' as const,
  hintsUsed: 0,
  failedAttempts: 0,
  activeSeconds: 600,
  estimatedSeconds: 1800,
};

describe('FSRS model (pure)', () => {
  it('recall is 90% when elapsed time equals stability', () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 5);
    expect(retrievability(0, 10)).toBe(1);
  });

  it('first-review stability follows the grade', () => {
    const [again, hard, good, easy] = ([1, 2, 3, 4] as const).map((grade) =>
      intervalFor(initialState(grade)),
    );
    expect(again).toBe(1);
    expect(hard).toBe(1);
    expect(good).toBe(4);
    expect(easy).toBe(14);
  });

  it('a successful review on time grows the interval; a lapse shrinks it', () => {
    const state = initialState(3);
    const good = nextState(state, 3, intervalFor(state));
    const again = nextState(state, 1, intervalFor(state));
    expect(intervalFor(good)).toBeGreaterThan(intervalFor(state));
    expect(again.stability).toBeLessThanOrEqual(state.stability);
    expect(good.difficulty).toBeGreaterThanOrEqual(1);
    expect(good.difficulty).toBeLessThanOrEqual(10);
  });

  it('easy grows more than good, good more than hard', () => {
    const state = stateFromLadder(7);
    const [hard, good, easy] = ([2, 3, 4] as const).map((grade) =>
      intervalFor(nextState(state, grade, 7)),
    );
    expect(hard!).toBeLessThan(good!);
    expect(good!).toBeLessThan(easy!);
  });

  it('never exceeds a year', () => {
    let state = initialState(4);
    for (let i = 0; i < 30; i += 1) state = nextState(state, 4, intervalFor(state));
    expect(intervalFor(state)).toBe(365);
  });

  it('maps outcomes and solve signals to grades', () => {
    expect(gradeForOutcome('failed')).toBe(1);
    expect(gradeForOutcome('struggled')).toBe(2);
    expect(gradeForOutcome('clean')).toBe(3);
    expect(gradeForSolve(SIGNALS)).toBe(3);
    expect(gradeForSolve({ ...SIGNALS, confidence: 'low' })).toBe(2);
    expect(gradeForSolve({ ...SIGNALS, hintsUsed: 1 })).toBe(2);
    expect(gradeForSolve({ ...SIGNALS, confidence: 'high' })).toBe(4);
  });
});

const suite = hasTestDatabase ? describe : describe.skip;
const START = new Date('2026-03-02T10:00:00.000Z');
const TODAY = '2026-03-02';
const TIME_ZONE = 'Asia/Kolkata';

suite('FSRS opt-in against a real database', () => {
  let ctx: TestContext;
  let userId: string;
  let problemId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'fsrs@example.com', timezone: TIME_ZONE })).id;
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'fsrs-problem',
        title: 'FSRS problem',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/fsrs-problem/',
        difficulty: 'medium',
        estimatedMinutes: 30,
      })
      .returning();
    problemId = problem!.id;
  });

  async function useScheduler(scheduler: 'ladder' | 'fsrs') {
    await ctx.db
      .insert(userProfiles)
      .values({ userId, revisionScheduler: scheduler })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { revisionScheduler: scheduler },
      });
  }

  async function solve() {
    const session = await startSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: START,
      problemId,
    });
    await completeSession(ctx.db, {
      userId,
      timeZone: TIME_ZONE,
      now: new Date(START.getTime() + 20 * 60_000),
      sessionId: session.id,
      outcome: 'solved',
      confidence: 'medium',
    });
  }

  const row = async () =>
    (
      await ctx.db.select().from(revisionSchedule).where(eq(revisionSchedule.userId, userId))
    )[0]!;

  it('without opting in, a solve is scheduled by the ladder and carries no FSRS state', async () => {
    await solve();
    const scheduled = await row();
    expect(scheduled.intervalDays).toBe(1);
    expect(scheduled.fsrsStability).toBeNull();
    expect(scheduled.fsrsDifficulty).toBeNull();
  });

  it('opted in, a solve gets FSRS state and an FSRS interval', async () => {
    await useScheduler('fsrs');
    await solve();
    const scheduled = await row();
    expect(scheduled.fsrsStability).toBeGreaterThan(0);
    expect(scheduled.intervalDays).toBe(intervalFor(initialState(3)));
  });

  it('switching never moves a date; the next revision converts the row', async () => {
    await solve(); // ladder: 1 day
    const before = await row();
    await useScheduler('fsrs');
    expect((await row()).dueLocalDate).toBe(before.dueLocalDate);

    const next = await recordRevisionOutcome(ctx.db, {
      userId,
      problemId,
      outcome: 'clean',
      today: TODAY,
    });
    const after = await row();
    expect(after.fsrsStability).toBeGreaterThan(0);
    expect(next?.intervalDays).toBe(after.intervalDays);
    expect(after.revisionCount).toBe(1);

    // Back to the ladder: FSRS state is kept, the ladder moves the date again.
    await useScheduler('ladder');
    await recordRevisionOutcome(ctx.db, { userId, problemId, outcome: 'clean', today: TODAY });
    const ladder = await row();
    expect(ladder.revisionCount).toBe(2);
    expect([1, 3, 7, 14, 30]).toContain(ladder.intervalDays);
  });

  it('the database refuses half an FSRS state and an unknown scheduler', async () => {
    await useScheduler('ladder');
    await solve();
    await expect(
      ctx.db
        .update(revisionSchedule)
        .set({ fsrsStability: 3 })
        .where(eq(revisionSchedule.userId, userId)),
    ).rejects.toThrow();
    await expect(
      ctx.db
        .update(userProfiles)
        .set({ revisionScheduler: 'sm2' })
        .where(eq(userProfiles.userId, userId)),
    ).rejects.toThrow();
  });
});
