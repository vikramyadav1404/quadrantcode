/**
 * The console's testcase tabs, as data.
 *
 * Extracted from the component because this repo has no jsdom and no React
 * testing library: logic left inside `ConsoleTabs` could only be checked by a
 * browser test, and the interesting part here is not the markup — it is which
 * stdin a Run actually sends, which is easy to get subtly wrong and invisible
 * when it is.
 *
 * ## The rule that matters
 *
 * The server already does the right thing with an EMPTY stdin: it runs the
 * problem's stored visible tests and returns a verdict per case. That is
 * exactly "Run against the examples", and it is better than anything the client
 * can assemble, because the stored cases carry expected outputs and a
 * hand-typed one cannot.
 *
 * So pristine cases send nothing and let the server run all of them. Only once
 * the person has actually changed something does the active case's text get
 * sent as a custom single run. Pre-filling the boxes must not silently downgrade
 * a three-case graded run into a one-case unjudged one.
 */

export type TestCaseTab = {
  /** What the box currently holds. */
  value: string;
  /** What the problem's example held, or null for a case the user added. */
  original: string | null;
};

/** One tab per worked example, in the order the statement shows them. */
export function initialCases(exampleInputs: readonly string[]): TestCaseTab[] {
  if (exampleInputs.length === 0) return [{ value: '', original: null }];
  return exampleInputs.map((input) => ({ value: input, original: input }));
}

/** A case the user added is `original: null`, so it can never read as pristine. */
export function addCase(cases: readonly TestCaseTab[]): TestCaseTab[] {
  return [...cases, { value: '', original: null }];
}

export function editCase(
  cases: readonly TestCaseTab[],
  index: number,
  value: string,
): TestCaseTab[] {
  if (index < 0 || index >= cases.length) return [...cases];
  return cases.map((entry, position) => (position === index ? { ...entry, value } : entry));
}

/**
 * True only when every tab still holds exactly what the example gave it.
 *
 * Whitespace is NOT normalised: stdin is whitespace-separated, so a trailing
 * space is a real edit to a real payload. Treating it as pristine would send
 * the stored cases while the screen showed something else.
 */
export function isPristine(cases: readonly TestCaseTab[]): boolean {
  return cases.every((entry) => entry.original !== null && entry.value === entry.original);
}

/**
 * The stdin a Run should carry.
 *
 * Empty means "use the stored visible cases", which the server understands and
 * which yields per-case Accepted/Wrong Answer. A non-empty string is a single
 * custom run with no expected output to compare against.
 */
export function stdinForRun(cases: readonly TestCaseTab[], activeIndex: number): string {
  if (isPristine(cases)) return '';
  return cases[activeIndex]?.value ?? '';
}

/** `Case 1`, `Case 2`, … — one-based, because the result panel labels them that way. */
export function caseLabel(index: number): string {
  return `Case ${index + 1}`;
}
