/**
 * F4.5 · the upsolve queue.
 *
 * "Unsolved problems land in the upsolve queue automatically." The queue is
 * derived (see `upsolve.ts`), so these tests drive the real attempt lifecycle —
 * start, open questions, finalise, auto-submit on expiry — and read the queue
 * back, rather than asserting on a table that could be filled by hand.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  assessmentAnswers,
  executionJobs,
  runAttempts,
  solveSessions,
} from '@/server/db/schema';
import {
  type UpsolveCandidate,
  finalizeAssessment,
  getAssessmentAttempt,
  getUpsolveQueue,
  selectUpsolve,
  startOrResumeAssessment,
  switchAssessmentQuestion,
} from '@/server/services/assessments';
import { createPaperFixture } from '../helpers/assessment-fixture';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const at = (iso: string) => new Date(iso);

describe('selectUpsolve (pure)', () => {
  const miss = (overrides: Partial<UpsolveCandidate>): UpsolveCandidate => ({
    attemptId: 'a1',
    paperTitle: 'Paper',
    submittedAt: at('2026-09-01T10:00:00Z'),
    problemId: 'p1',
    slug: 'p1',
    title: 'Problem 1',
    difficulty: 'easy',
    marksAwarded: 0,
    ...overrides,
  });

  it('keeps a missed problem, and drops one that earned marks', () => {
    const queue = selectUpsolve(
      [miss({}), miss({ problemId: 'p2', slug: 'p2', title: 'Problem 2', marksAwarded: 10 })],
      new Map(),
    );
    expect(queue.map((item) => item.problemId)).toEqual(['p1']);
  });

  it('a never-opened question is in the queue, and says so', () => {
    const [item] = selectUpsolve([miss({ marksAwarded: null })], new Map());
    expect(item?.attempted).toBe(false);
  });

  it('is cleared only by a solve AFTER the attempt, not before', () => {
    const before = selectUpsolve([miss({})], new Map([['p1', [at('2026-09-01T09:00:00Z')]]]));
    const after = selectUpsolve([miss({})], new Map([['p1', [at('2026-09-02T09:00:00Z')]]]));
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(0);
  });

  it('one row per problem — the most recent miss — however many mocks missed it', () => {
    const queue = selectUpsolve(
      [
        miss({ attemptId: 'old', submittedAt: at('2026-09-01T10:00:00Z') }),
        miss({ attemptId: 'new', submittedAt: at('2026-09-05T10:00:00Z') }),
      ],
      new Map(),
    );
    expect(queue.map((item) => item.attemptId)).toEqual(['new']);
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('F4.5 · the upsolve queue against a real database', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());
  beforeEach(async () => truncateAll(ctx.sql));

  it('UNSOLVED PROBLEMS LAND IN THE QUEUE AUTOMATICALLY — on submit, opened or not', async () => {
    const fixture = await createPaperFixture(ctx);
    const started = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: at('2026-09-01T10:00:00Z'),
    });
    // Only question 1 is ever opened; question 2 has no answer row at all.
    await finalizeAssessment(ctx.db, {
      userId: fixture.user.id,
      attemptId: started.attemptId,
      now: at('2026-09-01T10:10:00Z'),
    });

    const queue = await getUpsolveQueue(ctx.db, { userId: fixture.user.id });
    expect(queue.map((item) => [item.title, item.attempted])).toEqual([
      ['Assessment Problem 1', true],
      ['Assessment Problem 2', false],
    ]);
    expect(queue[0]).toMatchObject({
      attemptId: started.attemptId,
      paperTitle: 'Server Timer Paper',
    });
  });

  it('an attempt auto-submitted by expiry fills the queue too', async () => {
    const fixture = await createPaperFixture(ctx, 1);
    const started = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: at('2026-09-01T10:00:00Z'),
    });
    const view = await getAssessmentAttempt(ctx.db, {
      userId: fixture.user.id,
      attemptId: started.attemptId,
      now: at('2026-09-01T10:02:00Z'),
    });
    expect(view!.attempt.status).toBe('auto_submitted');
    expect(await getUpsolveQueue(ctx.db, { userId: fixture.user.id })).toHaveLength(2);
  });

  it('a live attempt contributes nothing until it is finished', async () => {
    const fixture = await createPaperFixture(ctx);
    await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: at('2026-09-01T10:00:00Z'),
    });
    expect(await getUpsolveQueue(ctx.db, { userId: fixture.user.id })).toEqual([]);
  });

  it('a question that earned server-verified marks is not in the queue', async () => {
    const fixture = await createPaperFixture(ctx);
    const started = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: at('2026-09-01T10:00:00Z'),
    });
    const [answer] = await ctx.db
      .select()
      .from(assessmentAnswers)
      .where(
        and(
          eq(assessmentAnswers.attemptId, started.attemptId),
          eq(assessmentAnswers.paperQuestionId, fixture.questions[0]!.id),
        ),
      );
    const finishedAt = at('2026-09-01T10:05:00Z');
    const [job] = await ctx.db
      .insert(executionJobs)
      .values({
        userId: fixture.user.id,
        problemId: fixture.problems[0]!.id,
        language: 'cpp17',
        mode: 'assessment',
        source: answer!.source,
        status: 'completed',
        finishedAt,
      })
      .returning();
    await ctx.db.insert(runAttempts).values({
      jobId: job!.id,
      userId: fixture.user.id,
      problemId: fixture.problems[0]!.id,
      language: 'cpp17',
      verdict: 'accepted',
      serverVerified: true,
      serverVerifiedAt: finishedAt,
      providerName: 'judge0-test',
    });
    await ctx.db
      .update(assessmentAnswers)
      .set({ executionJobId: job!.id })
      .where(eq(assessmentAnswers.id, answer!.id));
    await switchAssessmentQuestion(ctx.db, {
      userId: fixture.user.id,
      attemptId: started.attemptId,
      paperQuestionId: fixture.questions[1]!.id,
      now: at('2026-09-01T10:06:00Z'),
    });
    await finalizeAssessment(ctx.db, {
      userId: fixture.user.id,
      attemptId: started.attemptId,
      now: at('2026-09-01T10:10:00Z'),
    });

    const queue = await getUpsolveQueue(ctx.db, { userId: fixture.user.id });
    expect(queue.map((item) => item.title)).toEqual(['Assessment Problem 2']);
  });

  it('solving it afterwards clears it; a solve from before the attempt does not', async () => {
    const fixture = await createPaperFixture(ctx);
    const solved = (problemId: string, endedAt: Date) =>
      ctx.db.insert(solveSessions).values({
        userId: fixture.user.id,
        problemId,
        status: 'solved',
        startedAt: new Date(endedAt.getTime() - 60_000),
        endedAt,
        lastHeartbeatAt: new Date(endedAt.getTime() - 60_000),
        startedLocalDate: endedAt.toISOString().slice(0, 10),
        endedLocalDate: endedAt.toISOString().slice(0, 10),
      });

    // Problem 1 was solved BEFORE the mock — the mock is the newer evidence.
    await solved(fixture.problems[0]!.id, at('2026-08-30T10:00:00Z'));
    const started = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: at('2026-09-01T10:00:00Z'),
    });
    await finalizeAssessment(ctx.db, {
      userId: fixture.user.id,
      attemptId: started.attemptId,
      now: at('2026-09-01T10:10:00Z'),
    });
    // Problem 2 is upsolved afterwards.
    await solved(fixture.problems[1]!.id, at('2026-09-02T10:00:00Z'));

    const queue = await getUpsolveQueue(ctx.db, { userId: fixture.user.id });
    expect(queue.map((item) => item.title)).toEqual(['Assessment Problem 1']);
  });

  it('is scoped to its owner, and to one attempt when asked', async () => {
    const fixture = await createPaperFixture(ctx);
    const started = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: at('2026-09-01T10:00:00Z'),
    });
    await finalizeAssessment(ctx.db, {
      userId: fixture.user.id,
      attemptId: started.attemptId,
      now: at('2026-09-01T10:10:00Z'),
    });
    const other = await createUser(ctx.db, { email: 'someone-else@example.com' });

    expect(await getUpsolveQueue(ctx.db, { userId: other.id })).toEqual([]);
    expect(
      await getUpsolveQueue(ctx.db, { userId: fixture.user.id, attemptId: started.attemptId }),
    ).toHaveLength(2);
    expect(
      await getUpsolveQueue(ctx.db, {
        userId: fixture.user.id,
        attemptId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toEqual([]);
  });
});
