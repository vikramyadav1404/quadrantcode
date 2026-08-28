'use client';

/**
 * The editor, its controls, and the result.
 *
 * ## The state machine is visible here, not just enforced in the database
 *
 * One of this ticket's criteria is that the state machine is *visible in the
 * UI*. `queued`, `running`, `completed` and `failed` each render differently
 * and the button reflects which one is current — a spinner that means all four
 * states at once is how a user ends up unable to tell "still going" from
 * "stopped and nobody noticed".
 *
 * ## Polling, because there is nothing to subscribe to
 *
 * F2.3 is cut (D17), so there is no queue and no channel to listen on. The
 * client polls the job row until it reaches a terminal status, and gives up
 * after a bounded number of attempts rather than spinning forever — a job the
 * runner abandoned is swept server-side, and the UI should say so rather than
 * wait for a result that is not coming.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EXECUTION_LANGUAGES,
  EXECUTION_LANGUAGE_LABELS,
  LANGUAGE_STARTERS,
  isExecutionLanguage,
  type ExecutionLanguage,
} from '@/lib/execution/languages';
import { draftKey, isPending, type ExecutionResultView } from '@/lib/execution/view';
import { CodeEditor } from './CodeEditor';
import { RunOutput } from './RunOutput';

const POLL_INTERVAL_MS = 700;

/** ~35 s of polling. Past that the job is stalled, and the sweep will say so. */
const MAX_POLLS = 50;

type SubmitResult = { ok: true; jobId: string } | { ok: false; message: string };

export function RunPanel({
  problemId,
  defaultLanguage,
  onSubmit,
}: {
  problemId: string;
  defaultLanguage: ExecutionLanguage;
  onSubmit: (input: {
    problemId: string;
    language: ExecutionLanguage;
    source: string;
    stdin: string;
  }) => Promise<SubmitResult>;
}) {
  const [language, setLanguage] = useState<ExecutionLanguage>(defaultLanguage);
  const [source, setSource] = useState<string>(LANGUAGE_STARTERS[defaultLanguage]);
  const [stdin, setStdin] = useState('');
  const [result, setResult] = useState<ExecutionResultView | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Why a run was refused — the rate-limit message, which names the time.
   * Kept apart from `result` because a refusal produced no job at all.
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Drafts are per problem AND per language, so switching to C++ to check
   * something does not overwrite the Python you were halfway through.
   *
   * localStorage only. The ticket also asks for a server snapshot every 60s;
   * F3.2 owns server-side code storage, and building a second home for the
   * user's code here would guarantee the two disagree. Recorded as DEFERRED
   * with that reason rather than done twice.
   */
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(draftKey(problemId, language));
    } catch {
      // Private mode, or storage disabled. A missing draft is not an error.
    }
    setSource(stored ?? LANGUAGE_STARTERS[language]);
  }, [problemId, language]);

  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey(problemId, language), source);
      } catch {
        // Out of quota or blocked. Losing a draft is bad; crashing the editor
        // over it is worse.
      }
    }, 500);

    return () => clearTimeout(handle);
  }, [problemId, language, source]);

  // A poll in flight must not outlive the page.
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const poll = useCallback(
    (jobId: string, attempt: number) => {
      pollTimer.current = setTimeout(async () => {
        const response = await fetch(`/api/execution/${jobId}`, { cache: 'no-store' });

        if (!response.ok) {
          setResult({
            jobId,
            status: 'failed',
            language,
            scratchpad: true,
            verdict: null,
            runtimeMs: null,
            memoryKb: null,
            testsPassed: null,
            testsTotal: null,
            stdout: null,
            stderr: null,
            compileOutput: null,
            error: 'Lost contact with the run.',
          });
          setBusy(false);
          return;
        }

        const next = (await response.json()) as ExecutionResultView;
        setResult(next);

        if (!isPending(next.status)) {
          setBusy(false);
          return;
        }

        if (attempt >= MAX_POLLS) {
          /*
           * Stop, and say why. The job row is still live and the server-side
           * sweep will fail it — which matters more than the spinner, because a
           * stuck `running` row counts against the concurrency cap until then.
           */
          setResult({
            ...next,
            status: 'failed',
            error: 'This run stopped responding. It will be cleared shortly.',
          });
          setBusy(false);
          return;
        }

        poll(jobId, attempt + 1);
      }, POLL_INTERVAL_MS);
    },
    [language],
  );

  async function run() {
    setBusy(true);
    setRefusal(null);
    setResult(null);

    const submitted = await onSubmit({ problemId, language, source, stdin });

    if (!submitted.ok) {
      // A refused submission wrote no row, so there is nothing to poll.
      setRefusal(submitted.message);
      setBusy(false);
      return;
    }

    setResult({
      jobId: submitted.jobId,
      status: 'queued',
      language,
      scratchpad: true,
      verdict: null,
      runtimeMs: null,
      memoryKb: null,
      testsPassed: null,
      testsTotal: null,
      stdout: null,
      stderr: null,
      compileOutput: null,
      error: null,
    });

    poll(submitted.jobId, 0);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm" htmlFor="run-language">
          Language
        </label>
        <select
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          id="run-language"
          onChange={(event) => {
            const next = event.target.value;
            if (isExecutionLanguage(next)) setLanguage(next);
          }}
          value={language}
        >
          {EXECUTION_LANGUAGES.map((value) => (
            <option key={value} value={value}>
              {EXECUTION_LANGUAGE_LABELS[value]}
            </option>
          ))}
        </select>

        <button
          className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] disabled:opacity-60"
          disabled={busy || source.trim().length === 0}
          onClick={run}
          type="button"
        >
          {/* The button says which state the run is in — not one word for all four. */}
          {!busy ? 'Run' : result?.status === 'running' ? 'Running…' : 'Queued…'}
        </button>
      </div>

      <CodeEditor language={language} onChange={setSource} value={source} />

      <div>
        <label className="mb-1 block text-sm" htmlFor="run-stdin">
          Input (stdin)
        </label>
        <textarea
          className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
          id="run-stdin"
          onChange={(event) => setStdin(event.target.value)}
          rows={3}
          value={stdin}
        />
      </div>

      {refusal ? (
        <p
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm"
          data-testid="run-refusal"
          role="status"
        >
          {refusal}
        </p>
      ) : null}

      <RunOutput result={result} />
    </div>
  );
}
