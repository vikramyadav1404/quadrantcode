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
 * ## Output is still a text node
 *
 * `RunOutput` does the rendering and the rule lives there: program output
 * reaches the screen through `{value}` and nothing else. This component moved
 * where it sits; it did not change what it does.
 */
import { useEffect, useState } from 'react';
import { RunOutput } from '@/components/editor/RunOutput';
import { isPending, type ExecutionResultView } from '@/lib/execution/view';

type Tab = 'testcase' | 'result';

export function ConsoleTabs({
  stdin,
  onStdinChange,
  result,
}: {
  stdin: string;
  onStdinChange: (next: string) => void;
  result: ExecutionResultView | null;
}) {
  const [tab, setTab] = useState<Tab>('testcase');

  /*
   * Follow the run when it starts, and then stop following.
   *
   * The dependency is the job id, not the result object — otherwise every poll
   * tick re-runs this and drags the user back to Result each time they try to
   * click away.
   */
  const jobId = result?.jobId ?? null;

  useEffect(() => {
    if (jobId) setTab('result');
  }, [jobId]);

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
            <label className="mb-1 block text-sm" htmlFor="run-stdin">
              Input (stdin)
            </label>
            <textarea
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
              id="run-stdin"
              onChange={(event) => onStdinChange(event.target.value)}
              rows={4}
              value={stdin}
            />
          </div>
        ) : (
          <RunOutput result={result} />
        )}
      </div>
    </div>
  );
}
