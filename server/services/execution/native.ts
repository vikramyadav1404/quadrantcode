import { and, asc, eq, ne } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  problemLanguageTemplates,
  problemVersions,
  testCases,
  type SafeTestResult,
} from '@/server/db/schema';
import type { ExecutionMode } from '@/lib/native/constants';
import type { ExecutionProvider, ExecutionResult } from './provider';
import { EXECUTION_LIMITS, ProviderUnavailableError } from './provider';
import type { ExecutionLanguage, ExecutionVerdict } from './types';

const USER_CODE_MARKER = '/*__USER_CODE__*/';

type NativeJob = {
  problemId: string;
  problemVersion: number;
  language: ExecutionLanguage;
  mode: ExecutionMode;
  source: string;
  stdin: string | null;
};

export type NativeExecutionResult = ExecutionResult & {
  testsPassed: number;
  testsTotal: number;
  testResults: SafeTestResult[];
};

export function wrapUserSource(wrapperTemplate: string, userSource: string): string {
  const parts = wrapperTemplate.split(USER_CODE_MARKER);
  if (parts.length !== 2) {
    throw new Error('Execution wrapper must contain the user-code marker exactly once.');
  }
  return `${parts[0]}${userSource}${parts[1]}`;
}

export function outputsMatch(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  try {
    return deepEqual(JSON.parse(actual.trim()), JSON.parse(expected.trim()));
  } catch {
    return false;
  }
}

export async function executeNativeProblem(
  db: Database,
  provider: ExecutionProvider,
  job: NativeJob,
): Promise<NativeExecutionResult> {
  const [configuration] = await db
    .select({
      versionId: problemVersions.id,
      timeLimitMs: problemVersions.timeLimitMs,
      memoryLimitKb: problemVersions.memoryLimitKb,
      wrapperTemplate: problemLanguageTemplates.wrapperTemplate,
    })
    .from(problemVersions)
    .innerJoin(
      problemLanguageTemplates,
      and(
        eq(problemLanguageTemplates.problemVersionId, problemVersions.id),
        eq(problemLanguageTemplates.language, job.language),
      ),
    )
    .where(
      and(
        eq(problemVersions.problemId, job.problemId),
        eq(problemVersions.version, job.problemVersion),
      ),
    )
    .limit(1);

  if (!configuration) {
    throw new ProviderUnavailableError('Native judge', 'missing version or language template');
  }

  const storedTests =
    job.mode === 'run' && job.stdin?.trim()
      ? []
      : await db
          .select({
            ordinal: testCases.ordinal,
            visibility: testCases.visibility,
            input: testCases.input,
            expectedOutput: testCases.expectedOutput,
          })
          .from(testCases)
          .where(
            job.mode === 'run'
              ? and(
                  eq(testCases.problemVersionId, configuration.versionId),
                  ne(testCases.visibility, 'hidden'),
                )
              : eq(testCases.problemVersionId, configuration.versionId),
          )
          .orderBy(asc(testCases.ordinal));

  const plan =
    job.mode === 'run' && job.stdin?.trim()
      ? [
          {
            ordinal: 0,
            visibility: 'custom' as const,
            input: job.stdin,
            expectedOutput: null,
          },
        ]
      : storedTests;

  if (plan.length === 0) {
    throw new ProviderUnavailableError('Native judge', 'no test cases are configured');
  }

  const wrappedSource = wrapUserSource(configuration.wrapperTemplate, job.source);
  const limits = {
    cpuSeconds: Math.max(
      0.1,
      Math.min(EXECUTION_LIMITS.cpuSeconds, configuration.timeLimitMs / 1_000),
    ),
    wallSeconds: Math.max(
      1,
      Math.min(EXECUTION_LIMITS.wallSeconds, Math.ceil(configuration.timeLimitMs / 1_000) + 1),
    ),
    memoryKb: Math.min(EXECUTION_LIMITS.memoryKb, configuration.memoryLimitKb),
  };

  let verdict: ExecutionVerdict = 'accepted';
  let testsPassed = 0;
  let runtimeMs = 0;
  let hasRuntime = false;
  let memoryKb = 0;
  let hasMemory = false;
  let compilerRuntimeVersion: string | null = null;
  let compileOutput: string | null = null;
  let stderr: string | null = null;
  let safeStdout: string | null = null;
  const testResults: SafeTestResult[] = [];

  for (const test of plan) {
    const result = await provider.execute({
      language: job.language,
      source: wrappedSource,
      stdin: test.input,
      expectedOutput: null,
      limits,
    });

    compilerRuntimeVersion ??= result.compilerRuntimeVersion;
    compileOutput ??= result.compileOutput;
    stderr ??= result.stderr;
    if (result.runtimeMs !== null) {
      runtimeMs += result.runtimeMs;
      hasRuntime = true;
    }
    if (result.memoryKb !== null) {
      memoryKb = Math.max(memoryKb, result.memoryKb);
      hasMemory = true;
    }

    const testVerdict =
      result.verdict === 'accepted' && test.expectedOutput !== null
        ? outputsMatch(result.stdout, test.expectedOutput)
          ? 'accepted'
          : 'wrong_answer'
        : result.verdict;

    if (testVerdict === 'accepted') testsPassed += 1;
    else if (verdict === 'accepted') verdict = testVerdict;

    if (test.visibility !== 'hidden') {
      safeStdout = result.stdout;
      testResults.push({
        ordinal: test.ordinal,
        visibility: test.visibility,
        verdict: testVerdict,
        runtimeMs: result.runtimeMs,
        memoryKb: result.memoryKb,
        input: test.input,
        ...(test.expectedOutput !== null ? { expectedOutput: test.expectedOutput } : {}),
        actualOutput: result.stdout,
      });
    } else {
      testResults.push({
        ordinal: test.ordinal,
        visibility: 'hidden',
        verdict: testVerdict,
        runtimeMs: result.runtimeMs,
        memoryKb: result.memoryKb,
      });
    }

    if (testVerdict === 'compile_error' || testVerdict === 'internal_error') break;
  }

  return {
    verdict,
    runtimeMs: hasRuntime ? runtimeMs : null,
    memoryKb: hasMemory ? memoryKb : null,
    stdout: job.mode === 'run' ? safeStdout : null,
    stderr,
    compileOutput,
    compilerRuntimeVersion,
    testsPassed,
    testsTotal: plan.length,
    testResults,
  };
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (
    typeof left === 'object' &&
    left !== null &&
    typeof right === 'object' &&
    right !== null
  ) {
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftObject).sort();
    const rightKeys = Object.keys(rightObject).sort();
    return (
      deepEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => deepEqual(leftObject[key], rightObject[key]))
    );
  }
  return false;
}
