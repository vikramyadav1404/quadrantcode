/**
 * The languages and verdicts, declared once.
 *
 * Same rule as `lib/reflection/taxonomy.ts` and for the same reason: this list
 * has to be identical in a Postgres enum, a Zod schema, a `<select>` and the
 * editor's syntax mode. Written four times it drifts, and the symptom is a
 * language the editor offers and the database rejects on submit.
 *
 * It lives in `lib/` because `components/` may not import from `server/` (F0.1).
 */

export const EXECUTION_LANGUAGES = ['cpp17', 'java', 'python3', 'javascript'] as const;
export type ExecutionLanguage = (typeof EXECUTION_LANGUAGES)[number];

export const EXECUTION_LANGUAGE_LABELS: Record<ExecutionLanguage, string> = {
  cpp17: 'C++17',
  java: 'Java',
  python3: 'Python 3',
  javascript: 'JavaScript',
};

/** Monaco's own identifier for each, which is not always ours. */
export const MONACO_LANGUAGE_IDS: Record<ExecutionLanguage, string> = {
  cpp17: 'cpp',
  java: 'java',
  python3: 'python',
  javascript: 'javascript',
};

/** Something to start from, so an empty editor is not a blank page. */
export const LANGUAGE_STARTERS: Record<ExecutionLanguage, string> = {
  cpp17: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  \n  return 0;\n}\n',
  java: 'public class Main {\n  public static void main(String[] args) {\n    \n  }\n}\n',
  python3: 'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
  javascript: 'function main() {\n  \n}\n\nmain();\n',
};

export const EXECUTION_VERDICTS = [
  'accepted',
  'wrong_answer',
  'tle',
  'mle',
  'runtime_error',
  'compile_error',
  'internal_error',
] as const;
export type ExecutionVerdict = (typeof EXECUTION_VERDICTS)[number];

/**
 * What each verdict says to a person.
 *
 * `internal_error` is deliberately not "your code crashed": it means the runner
 * itself went wrong, and blaming the user for that is how a tool loses trust.
 */
export const VERDICT_LABELS: Record<ExecutionVerdict, string> = {
  accepted: 'Accepted',
  wrong_answer: 'Wrong answer',
  tle: 'Too slow (time limit)',
  mle: 'Out of memory',
  runtime_error: 'Runtime error',
  compile_error: 'Compile error',
  internal_error: 'The runner failed, not your code',
};

export function isExecutionLanguage(value: unknown): value is ExecutionLanguage {
  return (EXECUTION_LANGUAGES as readonly unknown[]).includes(value);
}
