/**
 * F3.1 · the console's testcase tabs.
 *
 * The behaviour worth protecting is not the tabs — it is that pre-filling them
 * does not silently turn a graded multi-case Run into a single unjudged one.
 * The server runs every stored visible case when stdin is empty and compares
 * against expected output; a hand-typed case has nothing to compare against.
 * So "pristine" has to mean pristine.
 */
import { describe, expect, it } from 'vitest';
import {
  addCase,
  caseLabel,
  editCase,
  initialCases,
  isPristine,
  stdinForRun,
} from '@/lib/execution/testcases';

const EXAMPLES = ['11 4 11 7 11 4', '4 4 2 7 7 7', '5 2 8'];

describe('F3.1 · initialCases', () => {
  it('makes one tab per worked example, in order', () => {
    const cases = initialCases(EXAMPLES);
    expect(cases).toHaveLength(3);
    expect(cases.map((c) => c.value)).toEqual(EXAMPLES);
    expect(cases.every((c) => c.original === c.value)).toBe(true);
  });

  it('still gives one empty tab when a problem has no examples', () => {
    // An external-link problem has none; the box must not vanish.
    const cases = initialCases([]);
    expect(cases).toEqual([{ value: '', original: null }]);
  });
});

describe('F3.1 · stdinForRun — the rule that matters', () => {
  it('sends NOTHING while every tab is untouched, so the server grades all cases', () => {
    const cases = initialCases(EXAMPLES);
    for (let index = 0; index < cases.length; index++) {
      expect(stdinForRun(cases, index)).toBe('');
    }
  });

  it('sends the active tab once anything has been edited', () => {
    const cases = editCase(initialCases(EXAMPLES), 1, '9 9 9');
    expect(stdinForRun(cases, 1)).toBe('9 9 9');
  });

  it('sends the ACTIVE tab, not the edited one', () => {
    // Editing case 2 then running while looking at case 1 must run case 1.
    const cases = editCase(initialCases(EXAMPLES), 1, '9 9 9');
    expect(stdinForRun(cases, 0)).toBe(EXAMPLES[0]);
  });

  it('an added-but-empty case still counts as dirty', () => {
    // Otherwise adding a case would send '' and the run would grade the stored
    // cases instead — the screen and the run disagreeing.
    const cases = addCase(initialCases(EXAMPLES));
    expect(isPristine(cases)).toBe(false);
    expect(stdinForRun(cases, 3)).toBe('');
    expect(stdinForRun(cases, 0)).toBe(EXAMPLES[0]);
  });

  it('treats whitespace as a real edit', () => {
    // stdin is whitespace-separated: a trailing space is a different payload.
    const cases = editCase(initialCases(EXAMPLES), 0, `${EXAMPLES[0]} `);
    expect(isPristine(cases)).toBe(false);
    expect(stdinForRun(cases, 0)).toBe(`${EXAMPLES[0]} `);
  });

  it('returns to pristine when an edit is undone', () => {
    const edited = editCase(initialCases(EXAMPLES), 0, 'nonsense');
    expect(isPristine(edited)).toBe(false);
    const restored = editCase(edited, 0, EXAMPLES[0]!);
    expect(isPristine(restored)).toBe(true);
    expect(stdinForRun(restored, 0)).toBe('');
  });

  it('a problem with no examples is dirty from the start', () => {
    // There are no stored visible cases to fall back on, so whatever is typed
    // is the only input there is.
    const cases = initialCases([]);
    expect(isPristine(cases)).toBe(false);
    expect(stdinForRun(editCase(cases, 0, '1 2 3'), 0)).toBe('1 2 3');
  });

  it('is safe when the active index is out of range', () => {
    const cases = addCase(initialCases(EXAMPLES));
    expect(stdinForRun(cases, 99)).toBe('');
    expect(stdinForRun(cases, -1)).toBe('');
  });
});

describe('F3.1 · addCase and editCase do not mutate', () => {
  it('addCase appends an empty, user-owned tab', () => {
    const before = initialCases(EXAMPLES);
    const after = addCase(before);
    expect(before).toHaveLength(3);
    expect(after).toHaveLength(4);
    expect(after[3]).toEqual({ value: '', original: null });
  });

  it('editCase leaves the input array alone', () => {
    const before = initialCases(EXAMPLES);
    const after = editCase(before, 0, 'changed');
    expect(before[0]!.value).toBe(EXAMPLES[0]);
    expect(after[0]!.value).toBe('changed');
    expect(after[0]!.original).toBe(EXAMPLES[0]);
  });

  it('editCase ignores an index that does not exist', () => {
    const before = initialCases(EXAMPLES);
    expect(editCase(before, 9, 'x')).toEqual(before);
    expect(editCase(before, -1, 'x')).toEqual(before);
  });
});

describe('F3.1 · caseLabel matches the result panel', () => {
  it('is one-based', () => {
    // RunOutput prints `Case ${test.ordinal}`; tabs must not be zero-based
    // beside it or the two panels disagree about which case is which.
    expect(caseLabel(0)).toBe('Case 1');
    expect(caseLabel(2)).toBe('Case 3');
  });
});
