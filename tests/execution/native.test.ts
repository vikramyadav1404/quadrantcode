import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  contentLicenses,
  executionJobs,
  problemLanguageTemplates,
  problemVersions,
  problems,
  runAttempts,
  testCases,
  userProblems,
} from '@/server/db/schema';
import {
  executeNativeProblem,
  getExecution,
  outputsMatch,
  runExecutionJob,
  submitExecution,
  wrapUserSource,
  type ExecutionProvider,
  type ExecutionRequest,
  type ExecutionResult,
} from '@/server/services/execution';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

class LengthProvider implements ExecutionProvider {
  readonly name = 'judge0-contract';
  readonly executes = true;
  readonly requests: ExecutionRequest[] = [];

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    this.requests.push(request);
    const values = JSON.parse(request.stdin ?? '[]') as unknown[];
    return {
      verdict: 'accepted',
      runtimeMs: 4,
      memoryKb: 1_024,
      stdout: JSON.stringify(values.length),
      stderr: null,
      compileOutput: null,
      compilerRuntimeVersion: 'Python (test contract)',
    };
  }
}

async function createNativeFixture(ctx: TestContext) {
  const user = await createUser(ctx.db);
  const [problem] = await ctx.db
    .insert(problems)
    .values({
      slug: 'native-length-lab',
      title: 'Native Length Lab',
      sourceType: 'original',
      difficulty: 'easy',
      status: 'published',
      currentVersion: 1,
      statement: 'Return the number of items in an independently supplied array.',
    })
    .returning();
  const [license] = await ctx.db
    .insert(contentLicenses)
    .values({
      provenance: 'quadrantcode-original',
      licenseName: 'Test fixture license',
      author: 'Quadrantcode tests',
    })
    .returning();
  const [version] = await ctx.db
    .insert(problemVersions)
    .values({
      problemId: problem!.id,
      version: 1,
      status: 'published',
      problemType: 'function',
      story: 'A native test story used only to verify the secure execution contract.',
      statement: 'Return the exact number of values in the supplied JSON array.',
      inputFormat: 'One JSON array.',
      outputFormat: 'One JSON integer.',
      functionContract: {
        functionName: 'solve',
        parameters: [{ name: 'values', type: 'integer[]', description: 'Input values.' }],
        returnType: 'integer',
      },
      constraints: ['0 <= n <= 100'],
      hints: ['Use the array length.'],
      timeLimitMs: 1_000,
      memoryLimitKb: 64_000,
      contentLicenseId: license!.id,
      provenance: 'Independent integration fixture.',
      publishedAt: new Date(),
    })
    .returning();
  await ctx.db.insert(problemLanguageTemplates).values({
    problemVersionId: version!.id,
    language: 'python3',
    displayName: 'Python',
    functionSignature: 'def solve(values):',
    starterCode: 'def solve(values):\n    return 0',
    wrapperTemplate: '/*__USER_CODE__*/\n# wrapper reads stdin and prints JSON',
    serialization: { input: 'JSON array', output: 'JSON integer', equality: 'exact_json' },
    referenceSolution: 'def solve(values):\n    return len(values)',
  });
  await ctx.db.insert(testCases).values([
    {
      problemVersionId: version!.id,
      ordinal: 1,
      visibility: 'sample',
      input: '[1,2]',
      expectedOutput: '2',
    },
    {
      problemVersionId: version!.id,
      ordinal: 2,
      visibility: 'visible',
      input: '[]',
      expectedOutput: '0',
    },
    {
      problemVersionId: version!.id,
      ordinal: 3,
      visibility: 'hidden',
      input: '[9,8,7]',
      expectedOutput: '3',
    },
  ]);
  return { user: user!, problem: problem!, version: version! };
}

suite('native execution security and persistence', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  it('Run executes visible cases only and custom input as one isolated case', async () => {
    const fixture = await createNativeFixture(ctx);
    const provider = new LengthProvider();
    const visible = await executeNativeProblem(ctx.db, provider, {
      problemId: fixture.problem.id,
      problemVersion: 1,
      language: 'python3',
      mode: 'run',
      source: 'def solve(values): return len(values)',
      stdin: null,
    });
    expect(visible.testsTotal).toBe(2);
    expect(provider.requests.map((request) => request.stdin)).toEqual(['[1,2]', '[]']);

    provider.requests.length = 0;
    const custom = await executeNativeProblem(ctx.db, provider, {
      problemId: fixture.problem.id,
      problemVersion: 1,
      language: 'python3',
      mode: 'run',
      source: 'def solve(values): return len(values)',
      stdin: '[4,5,6,7]',
    });
    expect(custom.testsTotal).toBe(1);
    expect(custom.testResults[0]).toMatchObject({ visibility: 'custom', actualOutput: '4' });
  });

  it('Submit stores only a hidden-case summary and applies server-verified solve state', async () => {
    const fixture = await createNativeFixture(ctx);
    const provider = new LengthProvider();
    const queued: string[] = [];
    const submitted = await submitExecution(ctx.db, {
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      language: 'python3',
      mode: 'submit',
      source: 'def solve(values): return len(values)',
      stdin: null,
      now: new Date('2026-08-31T10:00:00.000Z'),
      runner: { enqueue: async (jobId) => void queued.push(jobId) },
    });
    expect(submitted.ok).toBe(true);
    const jobId = queued[0]!;
    await runExecutionJob(ctx.db, provider, jobId);

    const view = await getExecution(ctx.db, { userId: fixture.user.id, jobId });
    expect(view).toMatchObject({
      mode: 'submit',
      verdict: 'accepted',
      testsPassed: 3,
      testsTotal: 3,
    });
    const hidden = view!.testResults!.find((test) => test.visibility === 'hidden')!;
    expect(hidden).toEqual({
      ordinal: 3,
      visibility: 'hidden',
      verdict: 'accepted',
      runtimeMs: 4,
      memoryKb: 1_024,
    });
    expect(JSON.stringify(hidden)).not.toContain('[9,8,7]');
    expect(JSON.stringify(hidden)).not.toContain('expectedOutput');

    const [attempt] = await ctx.db
      .select()
      .from(runAttempts)
      .where(eq(runAttempts.jobId, jobId));
    expect(attempt).toMatchObject({ serverVerified: true, providerName: 'judge0-contract' });
    const [state] = await ctx.db
      .select()
      .from(userProblems)
      .where(eq(userProblems.userId, fixture.user.id));
    expect(state?.status).toBe('solved');
    const [updatedProblem] = await ctx.db
      .select()
      .from(problems)
      .where(eq(problems.id, fixture.problem.id));
    expect(updatedProblem).toMatchObject({ acceptedSubmissions: 1, totalSubmissions: 1 });
  });

  it('does not expose wrapper/reference/test data through the execution job row', async () => {
    const fixture = await createNativeFixture(ctx);
    const queued: string[] = [];
    const submitted = await submitExecution(ctx.db, {
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      language: 'python3',
      mode: 'run',
      source: 'def solve(values): return len(values)',
      stdin: null,
      now: new Date(),
      runner: { enqueue: async (jobId) => void queued.push(jobId) },
    });
    expect(submitted.ok).toBe(true);
    const [job] = await ctx.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.id, queued[0]!));
    expect(job!.source).not.toContain('wrapper reads stdin');
    expect(job!.source).not.toContain('[9,8,7]');
  });
});

describe('native output and wrapper contracts', () => {
  it('compares canonical JSON instead of unsafe text or browser verdicts', () => {
    expect(outputsMatch('{"b":2,"a":1}', '{"a":1,"b":2}')).toBe(true);
    expect(outputsMatch('[1,2]', '[2,1]')).toBe(false);
    expect(outputsMatch('<script>', '"<script>"')).toBe(false);
  });

  it('requires exactly one server-owned wrapper marker', () => {
    expect(wrapUserSource('before /*__USER_CODE__*/ after', 'USER')).toBe('before USER after');
    expect(() => wrapUserSource('no marker', 'USER')).toThrow('exactly once');
  });
});
