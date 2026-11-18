'use client';

/**
 * "Find a small failing case" — offered under a failed Submit.
 *
 * The input shown is one the search just generated, never a hidden test.
 * Everything renders through `{value}` (escaped text), like `RunOutput`: the
 * "actual" line is bytes the user's program wrote.
 */
import { useState } from 'react';
import type { FailingCaseResult, StressSearchResult } from '@/lib/execution/failing-case';
import { VERDICT_LABELS } from '@/lib/execution/languages';

export type FindFailingCase = (input: { jobId: string }) => Promise<FailingCaseResult>;

export function SmallFailingCase({
  jobId,
  onFind,
}: {
  jobId: string;
  onFind: FindFailingCase;
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'done'; result: StressSearchResult; remainingToday: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function search() {
    setState({ kind: 'busy' });
    try {
      const response = await onFind({ jobId });
      setState(
        response.ok
          ? { kind: 'done', result: response.result, remainingToday: response.remainingToday }
          : { kind: 'error', message: response.message },
      );
    } catch {
      setState({
        kind: 'error',
        message: 'The search could not finish. Try again in a moment.',
      });
    }
  }

  return (
    <section
      className="rounded-[var(--radius)] border border-[var(--border)] p-2 text-xs"
      data-testid="failing-case"
    >
      {state.kind === 'idle' || state.kind === 'error' ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 font-medium hover:bg-[var(--surface-raised)]"
            data-testid="failing-case-button"
            onClick={search}
            title="Tries small random inputs against our reference solution and shows the smallest one your code gets wrong. Hidden tests stay hidden. A few searches per day."
            type="button"
          >
            Find a small failing case
          </button>
          {state.kind === 'error' ? (
            <span className="text-[var(--text-muted)]" role="status">
              {state.message}
            </span>
          ) : null}
        </div>
      ) : null}

      {state.kind === 'busy' ? (
        <p aria-live="polite" className="text-[var(--text-muted)]">
          Trying small inputs… this can take up to a minute.
        </p>
      ) : null}

      {state.kind === 'done' ? (
        <div aria-live="polite">
          {state.result.found ? (
            <>
              <p className="font-medium">
                A small input your code gets wrong ({VERDICT_LABELS[state.result.verdict]}):
              </p>
              <pre
                className="mt-1 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface-raised)] p-2"
                data-testid="failing-case-result"
              >
                Input: {state.result.input || '(empty)'}
                {`\nExpected: ${state.result.expected}`}
                {`\nYour output: ${state.result.actual ?? '—'}`}
              </pre>
              <p className="mt-1 text-[var(--text-muted)]">
                Generated just now, not one of the hidden tests. Paste it into a case tab to
                debug.
              </p>
            </>
          ) : (
            <p className="text-[var(--text-muted)]">
              No small input broke your code. The failing tests are likely large — check the
              time limit and overflow.
            </p>
          )}
          <p className="mt-1 text-[var(--text-muted)]">
            {state.remainingToday} {state.remainingToday === 1 ? 'search' : 'searches'} left
            today.
          </p>
        </div>
      ) : null}
    </section>
  );
}
