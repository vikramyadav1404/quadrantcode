import { and, asc, eq, ne } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  problemLanguageTemplates,
  problemVersions,
  testCases,
  type SafeTestResult,
} from '@/server/db/schema';
import type { ExecutionMode } from '@/lib/native/constants';
import type { ExecutionLifecycle, ExecutionProvider, ExecutionResult } from './provider';
import {
  EXECUTION_LIMITS,
  ExecutionConfigurationError,
  supportsExecutionSuite,
} from './provider';
import type { ExecutionLanguage, ExecutionVerdict } from './types';

const USER_CODE_MARKER = '/*__USER_CODE__*/';

type NativeJob = {
  problemId: string;
  problemVersion: number;
  language: ExecutionLanguage;
  mode: ExecutionMode;
  source: string;
  stdin: string | null;
  lifecycle?: ExecutionLifecycle;
};

export type NativeExecutionResult = ExecutionResult & {
  testsPassed: number;
  testsTotal: number;
  testResults: SafeTestResult[];
};

/**
 * A module-level `from __future__ import a, b` — never an indented one, which
 * Python rejects anyway, and never one inside a string (see the caveat below).
 */
const PYTHON_FUTURE_IMPORT = /^from __future__ import (.+)$/gm;

/**
 * Makes PEP 585 annotations survive Python 3.8.
 *
 * Judge0 runs **Python 3.8.1** and there is nothing newer: the instance offers
 * 3.8.1 and 2.7.17 only, Judge0 CE's language set has been frozen since 2020,
 * and Extra CE is the same vintage. So `def solve(v: list[int])` — which every
 * one of the native library's 100 reference solutions uses — dies at import
 * time with `TypeError: 'type' object is not subscriptable`, because builtin
 * generics are 3.9+.
 *
 * `from __future__ import annotations` (PEP 563, 3.7+) makes every annotation a
 * string that is never evaluated, so the syntax parses and nothing is resolved.
 * It fixes the whole class without editing a single type.
 *
 * ## Why this HOISTS rather than just prepending
 *
 * Python requires future imports to precede every statement except a module
 * docstring. Blindly prepending ours breaks the case where the user's own code
 * opens with a docstring and then its own future import:
 *
 *     from __future__ import annotations   <- ours
 *     """My solution."""                   <- now an expression, not a docstring
 *     from __future__ import division      <- SyntaxError: not at the beginning
 *
 * So every future import in the assembled source is collected, removed, and
 * re-emitted as ONE line at the very top, with `annotations` merged in. Two
 * adjacent future imports would have been legal; a future import after a
 * statement is not, and that is the case this exists for.
 *
 * Hoisting only ever makes previously-invalid code valid — a future import
 * below other statements could not have run in the first place.
 *
 * CAVEAT: the match is textual, so a line inside a triple-quoted string that
 * begins `from __future__ import ` at column zero would be lifted out of it.
 * Accepted: the alternative is parsing Python to run Python, and the failure is
 * loud rather than silent.
 */
export function hoistPythonFutureImports(source: string): string {
  const features = new Set<string>(['annotations']);

  const withoutFutures = source.replace(PYTHON_FUTURE_IMPORT, (_line, imported: string) => {
    for (const feature of imported.split(',')) {
      const name = feature.trim();
      // `from __future__ import annotations as _a` is legal; keep it whole.
      if (name.length > 0) features.add(name);
    }
    // Replaced by an empty line, so reported line numbers do not shift.
    return '';
  });

  return `from __future__ import ${[...features].join(', ')}\n${withoutFutures}`;
}

/**
 * Splices user code into a problem's wrapper.
 *
 * `language` is optional only so existing callers that genuinely have no
 * language keep working; both real call sites — reference validation and user
 * submissions — pass it, and Python needs it (see `hoistPythonFutureImports`).
 */
export function wrapUserSource(
  wrapperTemplate: string,
  userSource: string,
  language?: ExecutionLanguage,
): string {
  const parts = wrapperTemplate.split(USER_CODE_MARKER);
  if (parts.length !== 2) {
    throw new Error('Execution wrapper must contain the user-code marker exactly once.');
  }

  const assembled = `${parts[0]}${userSource}${parts[1]}`;
  return language === 'python3' ? hoistPythonFutureImports(assembled) : assembled;
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
    throw new ExecutionConfigurationError(
      'The problem version or language template is missing.',
    );
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
    throw new ExecutionConfigurationError('No test cases are configured for this problem.');
  }

  const wrappedSource = wrapUserSource(configuration.wrapperTemplate, job.source, job.language);
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

  const suite = supportsExecutionSuite(provider)
    ? await provider.executeSuite({
        language: job.language,
        source: wrappedSource,
        limits,
        cases: plan.map((test) => ({ ordinal: test.ordinal, stdin: test.input })),
        lifecycle: job.lifecycle,
      })
    : null;

  if (suite && suite.cases.length !== plan.length) {
    throw new ExecutionConfigurationError(
      'The execution provider returned an incomplete suite.',
    );
  }

  for (const [index, test] of plan.entries()) {
    const result =
      suite?.cases[index] ??
      (await provider.execute({
        language: job.language,
        source: wrappedSource,
        stdin: test.input,
        expectedOutput: null,
        limits,
        lifecycle: job.lifecycle,
      }));

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
