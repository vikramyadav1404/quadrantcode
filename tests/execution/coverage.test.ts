import { describe, expect, it } from 'vitest';
import { COVERAGE_ADVICE, COVERAGE_LABELS, failedByCoverage } from '@/lib/execution/coverage';
import { TEST_CASE_COVERAGE } from '@/lib/native/constants';
import type { SafeTestResultView } from '@/lib/execution/view';

const test = (
  verdict: SafeTestResultView['verdict'],
  coverage?: SafeTestResultView['coverage'],
): SafeTestResultView => ({
  ordinal: 1,
  visibility: 'hidden',
  verdict,
  runtimeMs: null,
  memoryKb: null,
  ...(coverage ? { coverage } : {}),
});

describe('failedByCoverage', () => {
  it('groups failures by kind, most first, and counts timeouts', () => {
    const groups = failedByCoverage([
      test('accepted', 'maximum'),
      test('tle', 'maximum'),
      test('wrong_answer', 'maximum'),
      test('wrong_answer', 'duplicates'),
      test('accepted', 'minimum'),
    ]);
    expect(groups).toEqual([
      { coverage: 'maximum', count: 2, timedOut: 1 },
      { coverage: 'duplicates', count: 1, timedOut: 0 },
    ]);
  });

  it('is empty when everything passed, and ignores unlabelled results', () => {
    expect(failedByCoverage([test('accepted', 'typical')])).toEqual([]);
    expect(failedByCoverage([test('wrong_answer')])).toEqual([]);
  });

  it('has a label and advice for every coverage kind', () => {
    for (const kind of TEST_CASE_COVERAGE) {
      expect(COVERAGE_LABELS[kind].length).toBeGreaterThan(0);
      expect(COVERAGE_ADVICE[kind].length).toBeGreaterThan(0);
    }
  });
});
