import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  assessmentAnswers,
  assessmentAttempts,
  assessmentPaperQuestions,
  assessmentPapers,
  companies,
  contentLicenses,
  executionJobs,
  problemLanguageTemplates,
  problemVersions,
  problems,
  runAttempts,
} from '@/server/db/schema';
import {
  finalizeAssessment,
  getAssessmentAttempt,
  startOrResumeAssessment,
  switchAssessmentQuestion,
} from '@/server/services/assessments';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

async function createPaperFixture(ctx: TestContext, durationMinutes = 60) {
  const user = await createUser(ctx.db);
  const [company] = await ctx.db
    .insert(companies)
    .values({ slug: 'timer-company', name: 'Timer Company', overview: 'A test company.' })
    .returning();
  const [license] = await ctx.db
    .insert(contentLicenses)
    .values({
      provenance: 'quadrantcode-original',
      licenseName: `Assessment test ${durationMinutes}`,
      author: 'Quadrantcode tests',
    })
    .returning();

  const createdProblems = [];
  for (let index = 1; index <= 2; index += 1) {
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: `assessment-problem-${durationMinutes}-${index}`,
        title: `Assessment Problem ${index}`,
        sourceType: 'original',
        difficulty: index === 1 ? 'easy' : 'medium',
        status: 'published',
        statement: `Original assessment statement ${index}.`,
      })
      .returning();
    const [version] = await ctx.db
      .insert(problemVersions)
      .values({
        problemId: problem!.id,
        version: 1,
        status: 'published',
        problemType: 'function',
        story: 'Original assessment fixture story.',
        statement: 'Return a deterministic test value from the supplied input.',
        inputFormat: 'One JSON value.',
        outputFormat: 'One JSON value.',
        functionContract: {
          functionName: 'solve',
          parameters: [{ name: 'value', type: 'integer', description: 'Input value.' }],
          returnType: 'integer',
        },
        constraints: ['0 <= value <= 100'],
        hints: ['Return the value.'],
        timeLimitMs: 1_000,
        memoryLimitKb: 64_000,
        contentLicenseId: license!.id,
        provenance: 'Independent assessment fixture.',
        publishedAt: new Date(),
      })
      .returning();
    await ctx.db.insert(problemLanguageTemplates).values({
      problemVersionId: version!.id,
      language: 'cpp17',
      displayName: 'C++',
      functionSignature: 'int solve(int value)',
      starterCode: 'int solve(int value) { return 0; }',
      wrapperTemplate: '/*__USER_CODE__*/\nint main() { return 0; }',
      serialization: { input: 'JSON integer', output: 'JSON integer', equality: 'exact_json' },
      referenceSolution: 'int solve(int value) { return value; }',
    });
    createdProblems.push(problem!);
  }

  const [paper] = await ctx.db
    .insert(assessmentPapers)
    .values({
      companyId: company!.id,
      slug: `timer-paper-${durationMinutes}`,
      title: 'Server Timer Paper',
      role: 'Software Engineer',
      patternPeriod: 'Current practice pattern',
      paperType: 'pattern_based_mock',
      durationMinutes,
      instructions: 'Solve both original questions before the server deadline.',
      status: 'published',
      contentLicenseId: license!.id,
    })
    .returning();
  const questions = await ctx.db
    .insert(assessmentPaperQuestions)
    .values(
      createdProblems.map((problem, index) => ({
        paperId: paper!.id,
        problemId: problem.id,
        ordinal: index + 1,
        marks: (index + 1) * 10,
      })),
    )
    .returning();
  return { user, paper: paper!, questions, problems: createdProblems };
}

suite('server-timed assessment attempts', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());
  beforeEach(async () => truncateAll(ctx.sql));

  it('resumes one live attempt and anchors expiry to the original server start', async () => {
    const fixture = await createPaperFixture(ctx);
    const startedAt = new Date('2026-08-31T10:00:00.000Z');
    const first = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: startedAt,
    });
    const resumed = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: new Date('2026-08-31T10:05:00.000Z'),
    });
    expect(resumed).toEqual({ attemptId: first.attemptId, resumed: true });
    const [attempt] = await ctx.db
      .select()
      .from(assessmentAttempts)
      .where(eq(assessmentAttempts.id, first.attemptId));
    expect(attempt!.expiresAt.toISOString()).toBe('2026-08-31T11:00:00.000Z');
  });

  it('accounts time on the server when navigating questions', async () => {
    const fixture = await createPaperFixture(ctx);
    const first = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: new Date('2026-08-31T10:00:00.000Z'),
    });
    await switchAssessmentQuestion(ctx.db, {
      userId: fixture.user.id,
      attemptId: first.attemptId,
      paperQuestionId: fixture.questions[1]!.id,
      now: new Date('2026-08-31T10:00:30.000Z'),
    });
    await finalizeAssessment(ctx.db, {
      userId: fixture.user.id,
      attemptId: first.attemptId,
      now: new Date('2026-08-31T10:00:50.000Z'),
    });
    const answers = await ctx.db
      .select()
      .from(assessmentAnswers)
      .where(eq(assessmentAnswers.attemptId, first.attemptId));
    expect(
      answers.find((answer) => answer.paperQuestionId === fixture.questions[0]!.id)
        ?.timeSpentSeconds,
    ).toBe(30);
    expect(
      answers.find((answer) => answer.paperQuestionId === fixture.questions[1]!.id)
        ?.timeSpentSeconds,
    ).toBe(20);
  });

  it('auto-submits on server expiry and caps time at the deadline', async () => {
    const fixture = await createPaperFixture(ctx, 1);
    const first = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: new Date('2026-08-31T10:00:00.000Z'),
    });
    const view = await getAssessmentAttempt(ctx.db, {
      userId: fixture.user.id,
      attemptId: first.attemptId,
      now: new Date('2026-08-31T10:02:00.000Z'),
    });
    expect(view!.attempt.status).toBe('auto_submitted');
    expect(view!.remainingSeconds).toBe(0);
    expect(view!.answers[0]!.timeSpentSeconds).toBe(60);
  });

  it('scores only verdicts tied to server-verified execution results', async () => {
    const fixture = await createPaperFixture(ctx);
    const started = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: new Date('2026-08-31T10:00:00.000Z'),
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

    // A database verdict without a verified provider result earns nothing.
    await ctx.db
      .update(assessmentAnswers)
      .set({ verdict: 'accepted' })
      .where(eq(assessmentAnswers.id, answer!.id));
    let result = await finalizeAssessment(ctx.db, {
      userId: fixture.user.id,
      attemptId: started.attemptId,
      now: new Date('2026-08-31T10:05:00.000Z'),
    });
    expect(result.score).toBe(0);

    // A fresh attempt with a real server-verified run receives the question marks.
    const second = await startOrResumeAssessment(ctx.db, {
      userId: fixture.user.id,
      paperId: fixture.paper.id,
      now: new Date('2026-08-31T11:00:00.000Z'),
    });
    const [secondAnswer] = await ctx.db
      .select()
      .from(assessmentAnswers)
      .where(eq(assessmentAnswers.attemptId, second.attemptId));
    const finishedAt = new Date('2026-08-31T11:01:00.000Z');
    const [job] = await ctx.db
      .insert(executionJobs)
      .values({
        userId: fixture.user.id,
        problemId: fixture.problems[0]!.id,
        language: 'cpp17',
        mode: 'assessment',
        source: secondAnswer!.source,
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
      .where(eq(assessmentAnswers.id, secondAnswer!.id));
    result = await finalizeAssessment(ctx.db, {
      userId: fixture.user.id,
      attemptId: second.attemptId,
      now: new Date('2026-08-31T11:05:00.000Z'),
    });
    expect(result.score).toBe(10);
  });
});
