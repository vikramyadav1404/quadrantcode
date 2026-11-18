/**
 * "Find a small failing case": the search loop with a stub runner, then the
 * service against a real database — who may search, what is kept, what is
 * charged.
 *
 * The stub "user program" is a plausible bug for Museum Ticket Pair Count:
 * it counts every pair instead of distinct price pairs, so it is right until
 * a price repeats.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  assessmentAnswers,
  contentLicenses,
  executionJobs,
  problemLanguageTemplates,
  problemVersions,
  problems,
  runAttempts,
  stressSearches,
} from '@/server/db/schema';
import type {
  ExecutionProvider,
  ExecutionRequest,
  ExecutionResult,
} from '@/server/services/execution/provider';
import { loadNativeProblemBatches } from '@/server/services/native-content';
import { startOrResumeAssessment } from '@/server/services/assessments';
import {
  STRESS_DAILY_LIMIT,
  STRESS_GENERATORS,
  StressError,
  findSmallFailingCase,
  searchForFailure,
  stressEligibility,
} from '@/server/services/stress';
import { runReference } from '@/server/services/stress/reference';
import { createPaperFixture } from '../helpers/assessment-fixture';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const SLUG = 'museum-ticket-pair-count';

/** Counts all index pairs, not distinct price pairs. */
function everyPair(stdin: string): number {
  const values = stdin.trim() ? stdin.trim().split(/\s+/).map(Number) : [];
  const [target = 0, ...prices] = values;
  let found = 0;
  for (let i = 0; i < prices.length; i += 1) {
    for (let j = i + 1; j < prices.length; j += 1)
      if (prices[i]! + prices[j]! === target) found += 1;
  }
  return found;
}

const ok = (stdout: string): ExecutionResult => ({
  verdict: 'accepted',
  runtimeMs: 3,
  memoryKb: 1_000,
  stdout,
  stderr: null,
  compileOutput: null,
  compilerRuntimeVersion: 'stub',
});

class StubProvider implements ExecutionProvider {
  readonly name = 'stub';
  readonly executes = true;
  readonly requests: ExecutionRequest[] = [];
  constructor(private readonly answer: (stdin: string) => ExecutionResult) {}
  async execute(request: ExecutionRequest) {
    this.requests.push(request);
    return this.answer(request.stdin ?? '');
  }
}

let reference: { wrapperTemplate: string; referenceSolution: string };
let python: { wrapperTemplate: string; referenceSolution: string };
let timeLimitMs = 1_000;

beforeAll(async () => {
  const problem = (await loadNativeProblemBatches())
    .flatMap((batch) => batch.problems)
    .find((item) => item.slug === SLUG)!;
  reference = problem.languages.javascript;
  python = problem.languages.python3;
  timeLimitMs = problem.timeLimitMs;
}, 60_000);

const answer = (stdin: string) => runReference({ ...reference, stdin });

describe('searchForFailure', () => {
  it('finds the duplicate-price bug and shrinks it to three prices', async () => {
    const { failure, runs } = await searchForFailure({
      generator: STRESS_GENERATORS[SLUG]!,
      seed: 7,
      reference: answer,
      run: async (stdin) => ok(String(everyPair(stdin))),
      randomInputs: 60,
      maxRuns: 80,
    });
    expect(failure).not.toBeNull();
    expect(failure!.verdict).toBe('wrong_answer');
    expect(failure!.expected).toBe(answer(failure!.stdin));
    expect(failure!.actual).toBe(String(everyPair(failure!.stdin)));
    // Target plus the fewest prices that can show the bug: a repeat and a partner.
    expect(failure!.values.length).toBe(4);
    expect(runs).toBeLessThanOrEqual(80);
  });

  it('reports nothing for a correct program and never exceeds its run budget', async () => {
    let calls = 0;
    const { failure, runs } = await searchForFailure({
      generator: STRESS_GENERATORS[SLUG]!,
      seed: 1,
      reference: answer,
      run: async (stdin) => {
        calls += 1;
        return ok(answer(stdin));
      },
      maxRuns: 5,
    });
    expect(failure).toBeNull();
    expect(runs).toBe(5);
    expect(calls).toBe(5);
  });

  it('a crash or a timeout is a failure with its own verdict', async () => {
    const { failure } = await searchForFailure({
      generator: STRESS_GENERATORS[SLUG]!,
      seed: 3,
      reference: answer,
      run: async () => ({ ...ok(''), verdict: 'tle', stdout: null }),
    });
    expect(failure).toMatchObject({ verdict: 'tle', actual: null });
  });

  it('a runner failure stops the search rather than blaming the code', async () => {
    await expect(
      searchForFailure({
        generator: STRESS_GENERATORS[SLUG]!,
        seed: 3,
        reference: answer,
        run: async () => ({ ...ok(''), verdict: 'internal_error' }),
      }),
    ).rejects.toThrow(StressError);
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('findSmallFailingCase against a real database', () => {
  let ctx: TestContext;
  const now = new Date('2026-11-19T10:00:00.000Z');

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);
  afterAll(async () => ctx?.close());
  beforeEach(async () => truncateAll(ctx.sql));

  async function fixture(
    options: {
      sourceType?: 'original' | 'external_link';
      mode?: 'run' | 'submit';
      verdict?: 'wrong_answer' | 'accepted' | 'compile_error';
    } = {},
  ) {
    const user = await createUser(ctx.db);
    const external = options.sourceType === 'external_link';
    const [problem] = await ctx.db
      .insert(problems)
      .values(
        external
          ? {
              slug: SLUG,
              title: 'External',
              sourceType: 'external_link',
              platform: 'leetcode',
              externalUrl: 'https://leetcode.com/problems/two-sum/',
              difficulty: 'easy',
            }
          : {
              slug: SLUG,
              title: 'Museum Ticket Pair Count',
              sourceType: 'original',
              difficulty: 'easy',
              status: 'published',
              currentVersion: 1,
              statement: 'Count distinct price pairs that sum to the target.',
            },
      )
      .returning();
    if (!external) {
      const [license] = await ctx.db
        .insert(contentLicenses)
        .values({ provenance: 'quadrantcode-original', licenseName: 'Test', author: 'Tests' })
        .returning();
      const [version] = await ctx.db
        .insert(problemVersions)
        .values({
          problemId: problem!.id,
          version: 1,
          status: 'published',
          problemType: 'function',
          story: 'A test story for the small failing case search fixture.',
          statement: 'Count distinct price pairs that sum to the target.',
          inputFormat: 'Target, then prices.',
          outputFormat: 'One integer.',
          functionContract: {
            functionName: 'countPairs',
            parameters: [{ name: 'prices', type: 'integer[]', description: 'Prices.' }],
            returnType: 'integer',
          },
          constraints: ['0 <= n <= 100000'],
          hints: ['Sort first.'],
          timeLimitMs,
          memoryLimitKb: 64_000,
          contentLicenseId: license!.id,
          provenance: 'Test fixture.',
          publishedAt: new Date(),
        })
        .returning();
      await ctx.db.insert(problemLanguageTemplates).values(
        (
          [
            ['javascript', reference],
            ['python3', python],
          ] as const
        ).map(([language, template]) => ({
          problemVersionId: version!.id,
          language,
          displayName: language,
          functionSignature: 'countPairs',
          starterCode: 'starter',
          wrapperTemplate: template.wrapperTemplate,
          serialization: {
            input: 'integers',
            output: 'integer',
            equality: 'exact_json' as const,
          },
          referenceSolution: template.referenceSolution,
        })),
      );
    }
    const [job] = await ctx.db
      .insert(executionJobs)
      .values({
        userId: user.id,
        problemId: problem!.id,
        language: 'python3',
        mode: options.mode ?? 'submit',
        status: 'completed',
        finishedAt: now,
        source: 'def countPairs(prices, target):\n    return 0',
      })
      .returning();
    await ctx.db.insert(runAttempts).values({
      jobId: job!.id,
      userId: user.id,
      problemId: problem!.id,
      language: 'python3',
      verdict: options.verdict ?? 'wrong_answer',
    });
    return { user, problem: problem!, job: job! };
  }

  const buggy = () => new StubProvider((stdin) => ok(String(everyPair(stdin))));
  /*
   * The job id seeds the search, and fixtures get random ids, so the
   * service-level tests use a program that is wrong on every input; finding
   * and shrinking a subtle bug is covered above with a fixed seed.
   */
  const alwaysWrong = () => new StubProvider(() => ok('-1'));

  it('finds a small case with the job wrapper and limits, and keeps it', async () => {
    const { user, job } = await fixture();
    const provider = alwaysWrong();
    const first = await findSmallFailingCase(ctx.db, {
      userId: user.id,
      jobId: job.id,
      now,
      provider,
    });
    expect(first.result.found).toBe(true);
    expect(first.remainingToday).toBe(STRESS_DAILY_LIMIT - 1);
    expect(provider.requests[0]!.language).toBe('python3');
    expect(provider.requests[0]!.source).toContain(job.source);
    expect(provider.requests[0]!.expectedOutput).toBeNull();
    expect(provider.requests[0]!.limits?.cpuSeconds).toBe(Math.min(2, timeLimitMs / 1_000));

    // Asking again is free: the kept result, no new runs.
    const runs = provider.requests.length;
    const again = await findSmallFailingCase(ctx.db, {
      userId: user.id,
      jobId: job.id,
      now,
      provider,
    });
    expect(again.result).toEqual(first.result);
    expect(provider.requests.length).toBe(runs);
    const [row] = await ctx.db
      .select()
      .from(stressSearches)
      .where(eq(stressSearches.jobId, job.id));
    expect(row).toMatchObject({ status: 'done', runs });
  });

  it('refuses another user, a Run, a pass, a compile error and an external problem', async () => {
    const own = await fixture();
    const stranger = await createUser(ctx.db);
    await expect(
      findSmallFailingCase(ctx.db, {
        userId: stranger.id,
        jobId: own.job.id,
        now,
        provider: buggy(),
      }),
    ).rejects.toThrow('not found');

    for (const [options, message] of [
      [{ mode: 'run' }, 'after a Submit'],
      [{ verdict: 'accepted' }, 'passed'],
      [{ verdict: 'compile_error' }, 'compile'],
      [{ sourceType: 'external_link' }, 'Quadrantcode problems'],
    ] as const) {
      await truncateAll(ctx.sql);
      const { user, job } = await fixture(options);
      const provider = buggy();
      await expect(
        findSmallFailingCase(ctx.db, { userId: user.id, jobId: job.id, now, provider }),
      ).rejects.toThrow(message);
      expect(provider.requests).toHaveLength(0);
    }
  });

  it('refuses a job that answers a mock OA question', async () => {
    const paper = await createPaperFixture(ctx);
    const started = await startOrResumeAssessment(ctx.db, {
      userId: paper.user.id,
      paperId: paper.paper.id,
      now,
    });
    const { user, job } = await fixture();
    await ctx.db
      .update(assessmentAnswers)
      .set({ executionJobId: job.id })
      .where(eq(assessmentAnswers.attemptId, started.attemptId));
    expect(await stressEligibility(ctx.db, { userId: user.id, jobId: job.id })).toEqual({
      ok: false,
      reason: 'Not available during a mock OA.',
    });
  });

  it('stops at the daily limit, and a runner failure gives the slot back', async () => {
    const { user, job } = await fixture();
    const broken = new StubProvider(() => ({ ...ok(''), verdict: 'internal_error' }));
    await expect(
      findSmallFailingCase(ctx.db, { userId: user.id, jobId: job.id, now, provider: broken }),
    ).rejects.toThrow(StressError);
    expect(await ctx.db.select().from(stressSearches)).toHaveLength(0);

    // Fill today's allowance with other jobs' searches.
    for (let i = 0; i < STRESS_DAILY_LIMIT; i += 1) {
      const [other] = await ctx.db
        .insert(executionJobs)
        .values({
          userId: user.id,
          problemId: job.problemId,
          language: 'python3',
          mode: 'submit',
          status: 'completed',
          finishedAt: now,
          source: 'x',
        })
        .returning();
      await ctx.db.insert(stressSearches).values({
        jobId: other!.id,
        userId: user.id,
        status: 'done',
        result: { found: false },
        finishedAt: now,
        createdAt: now,
      });
    }
    await expect(
      findSmallFailingCase(ctx.db, { userId: user.id, jobId: job.id, now, provider: buggy() }),
    ).rejects.toThrow(`all ${STRESS_DAILY_LIMIT} searches`);
  });

  it('the database refuses a finished search without a result', async () => {
    const { user, job } = await fixture();
    await expect(
      ctx.db.insert(stressSearches).values({ jobId: job.id, userId: user.id, status: 'done' }),
    ).rejects.toThrow();
  });
});
