'use client';

/**
 * The console under the editor: what you feed the program, and what came back.
 *
 * ## Why these are tabs and not two stacked boxes
 *
 * They are used at different moments. Before a run you are editing stdin;
 * after it you are reading output. Stacking both means each is half-height
 * whichever one you actually need — which is why every editor that ships this
 * layout tabs them.
 *
 * **Switching to Result on its own is not enough**, though: a tab that changes
 * under you while you are typing in the other one is worse than no tab. It
 * switches only when a run STARTS, which is a moment the user caused.
 *
 * ## Case 1 / Case 2 / … come from the problem's own examples
 *
 * One tab per worked example, pre-filled and editable, plus one to add your
 * own. No new query: `getPublicNativeProblem` already returns the examples the
 * statement renders, so this is the same data shown twice.
 *
 * Which stdin a Run actually sends is decided by `lib/execution/testcases.ts`,
 * not here — see that file for why pristine tabs deliberately send nothing.
 *
 * ## Output is still a text node
 *
 * `RunOutput` does the rendering and the rule lives there: program output
 * reaches the screen through `{value}` and nothing else. This component moved
 * where it sits; it did not change what it does.
 */
import { useEffect, useState } from 'react';
import { RunOutput } from '@/components/editor/RunOutput';
import {
  type TestCaseTab,
  addCase,
  caseLabel,
  editCase,
  initialCases,
  isPristine,
  stdinForRun,
} from '@/lib/execution/testcases';
import { isPending, type ExecutionResultView } from '@/lib/execution/view';

type Tab = 'testcase' | 'result';

export function ConsoleTabs({
  exampleInputs,
  onStdinChange,
  result,
}: {
  /** One per worked example, in statement order. Empty for external problems. */
  exampleInputs: readonly string[];
  onStdinChange: (next: string) => void;
  result: ExecutionResultView | null;
}) {
  const [tab, setTab] = useState<Tab>('testcase');
  const [cases, setCases] = useState<TestCaseTab[]>(() => initialCases(exampleInputs));
  const [active, setActive] = useState(0);

  const jobId = result?.jobId ?? null;

  /*
   * Follow the run when it starts, and then stop following.
   *
   * The dependency is the job id, not the result object — otherwise every poll
   * tick re-runs this and drags the user back to Result each time they try to
   * click away.
   */
  useEffect(() => {
    if (jobId) setTab('result');
  }, [jobId]);

  /** The parent holds the stdin that gets submitted; this keeps it in step. */
  function commit(next: TestCaseTab[], nextActive: number) {
    setCases(next);
    setActive(nextActive);
    onStdinChange(stdinForRun(next, nextActive));
  }

  const pristine = isPristine(cases);

  return (
    <div className="flex max-h-[45%] min-h-[9rem] flex-col border-t border-[var(--border)]">
      <div className="flex gap-1 px-3">
        {(['testcase', 'result'] as const).map((value) => (
          <button
            aria-current={tab === value}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === value
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)]'
            }`}
            key={value}
            onClick={() => setTab(value)}
            type="button"
          >
            {value === 'testcase' ? 'Testcase' : 'Result'}
            {/* A quiet dot while a run is in flight, so switching away is safe. */}
            {value === 'result' && result && isPending(result.status) ? (
              <span aria-hidden="true" className="ml-1 text-[var(--accent)]">
                ·
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {tab === 'testcase' ? (
          <div>
            <div aria-label="Test cases" className="mb-2 flex flex-wrap gap-1" role="tablist">
              {cases.map((entry, index) => (
                <button
                  aria-controls="run-stdin"
                  aria-selected={active === index}
                  className={`rounded-[var(--radius)] px-2.5 py-1 text-xs transition-colors ${
                    active === index
                      ? 'bg-[var(--surface-raised)] text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                  key={`case-${index}`}
                  onClick={() => commit(cases, index)}
                  role="tab"
                  tabIndex={active === index ? 0 : -1}
                  type="button"
                >
                  {caseLabel(index)}
                  {entry.original === null || entry.value !== entry.original ? (
                    <span aria-label=" (edited)" className="ml-1 text-[var(--accent)]">
                      •
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                className="rounded-[var(--radius)] px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                onClick={() => commit(addCase(cases), cases.length)}
                type="button"
              >
                + Add case
              </button>
            </div>

            <label className="sr-only" htmlFor="run-stdin">
              {caseLabel(active)} input
            </label>
            <textarea
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
              id="run-stdin"
              onChange={(event) => commit(editCase(cases, active, event.target.value), active)}
              rows={4}
              value={cases[active]?.value ?? ''}
            />

            {/*
              Say which run they are about to get. Untouched cases are graded
              against stored expected output; an edited one cannot be, and a
              user who does not know that reads "no verdict" as a bug.
            */}
            <p className="mt-1.5 text-[0.7rem] text-[var(--text-muted)]">
              {pristine
                ? 'Run checks every case above against its expected output.'
                : 'Edited — Run executes this case only, with no expected output to check against.'}
            </p>
          </div>
        ) : (
          <RunOutput result={result} />
        )}
      </div>
    </div>
  );
}
