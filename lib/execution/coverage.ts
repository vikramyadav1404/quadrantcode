/**
 * Why a submission failed, by KIND of test — never by input.
 *
 * Every stored test carries a coverage label (smallest inputs, largest,
 * repeated values…). A hidden test's input and expected output never leave the
 * server, but its label can: "you failed two largest-input cases on time" says
 * where to look without saying what the test was.
 */
import type { TestCaseCoverage } from '@/lib/native/constants';
import type { SafeTestResultView } from './view';

export const COVERAGE_LABELS: Record<TestCaseCoverage, string> = {
  sample: 'worked example',
  empty: 'empty input',
  minimum: 'smallest inputs',
  maximum: 'largest inputs',
  duplicates: 'repeated values',
  adversarial: 'tricky edge case',
  performance: 'performance',
  typical: 'typical input',
};

/** What to check first, per kind of failing case. */
export const COVERAGE_ADVICE: Record<TestCaseCoverage, string> = {
  sample: 'Re-read the statement against the worked example.',
  empty: 'Handle zero items before the main loop.',
  minimum: 'Check the boundaries: one element, the first and last index.',
  maximum: 'Check overflow and whether the approach is fast enough at the largest n.',
  duplicates: 'Check equal values: ties, strict versus non-strict comparisons, counting twice.',
  adversarial:
    'Look for the case the obvious approach gets wrong: ordering, negatives, worst-case shapes.',
  performance: 'The approach is likely too slow; look for a lower time complexity.',
  typical: 'The core logic is off on ordinary input; trace a small case by hand.',
};

export type FailedCoverage = { coverage: TestCaseCoverage; count: number; timedOut: number };

/**
 * Failed tests grouped by kind, most failures first. Tests without a label
 * (custom input, results stored before labels were kept) are left out.
 */
export function failedByCoverage(results: readonly SafeTestResultView[]): FailedCoverage[] {
  const groups = new Map<TestCaseCoverage, FailedCoverage>();
  for (const test of results) {
    if (test.verdict === 'accepted' || !test.coverage) continue;
    const group = groups.get(test.coverage) ?? {
      coverage: test.coverage,
      count: 0,
      timedOut: 0,
    };
    group.count += 1;
    if (test.verdict === 'tle') group.timedOut += 1;
    groups.set(test.coverage, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.coverage.localeCompare(b.coverage),
  );
}
