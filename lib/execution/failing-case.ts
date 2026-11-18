import type { ExecutionVerdict } from './languages';

/** What a "find a small failing case" search found. Never a stored test. */
export type StressSearchResult =
  | {
      found: true;
      /** Our generated input, as stdin. */
      input: string;
      /** The reference solution's answer. */
      expected: string;
      /** What the user's program printed, truncated. Null when it printed nothing. */
      actual: string | null;
      verdict: ExecutionVerdict;
    }
  | { found: false };

export type FailingCaseResult =
  | { ok: true; result: StressSearchResult; remainingToday: number }
  | { ok: false; message: string };

/** The search is offered after a Submit that failed on a test, not on a compile or runner error. */
export const FAILING_CASE_VERDICTS: readonly ExecutionVerdict[] = [
  'wrong_answer',
  'tle',
  'mle',
  'runtime_error',
];
