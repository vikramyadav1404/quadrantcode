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
  EXECUTION_RUNTIME_CAVEATS,
  EXECUTION_RUNTIME_LABELS,
  LANGUAGE_STARTERS,
  isExecutionLanguage,
  type ExecutionLanguage,
} from '@/lib/execution/languages';
import { draftKey, isPending, type ExecutionResultView } from '@/lib/execution/view';
import { CodeEditor } from './CodeEditor';
import { ConsoleTabs } from '@/components/solve/ConsoleTabs';

const POLL_INTERVAL_MS = 700;

/** ~35 s of polling. Past that the job is stalled, and the sweep will say so. */
const MAX_POLLS = 50;

type SubmitResult = { ok: true; jobId: string } | { ok: false; message: string };

export function RunPanel({
  problemId,
  sessionId,
  defaultLanguage,
  onSubmit,
  allowSubmit = true,
  starters,
}: {
  problemId: string;
  /**
   * The sitting this run belongs to, resolved on the server.
   *
   * Passed through untouched — the panel never invents or edits it. Null means
   * the editor is open outside a timed session, which is allowed and means the
   * run leaves no snapshot (F3.2).
   */
  sessionId: string | null;
  defaultLanguage: ExecutionLanguage;
  allowSubmit?: boolean;
  starters?: Partial<Record<ExecutionLanguage, string>>;
  onSubmit: (input: {
    problemId: string;
    sessionId: string | null;
    language: ExecutionLanguage;
    mode: 'run' | 'submit';
    source: string;
    stdin: string;
  }) => Promise<SubmitResult>;
}) {
  const [language, setLanguage] = useState<ExecutionLanguage>(defaultLanguage);
  const [source, setSource] = useState<string>(
    starters?.[defaultLanguage] ?? LANGUAGE_STARTERS[defaultLanguage],
  );
  const [stdin, setStdin] = useState('');
  const [result, setResult] = useState<ExecutionResultView | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingMode, setPendingMode] = useState<'run' | 'submit'>('run');

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
   * localStorage holds the DRAFT — the latest text, per browser, so a reload
   * does not lose work. F3.2's `code_snapshots` holds the HISTORY, server-side,
   * and the two are different things rather than two copies of one: a draft is
   * overwritten constantly and belongs to a device, a snapshot is immutable and
   * belongs to a sitting.
   *
   * The 60-second interval capture is F3.2b's, from the editor. Today a
   * snapshot is taken on every run.
   */
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(draftKey(problemId, language));
    } catch {
      // Private mode, or storage disabled. A missing draft is not an error.
    }
    setSource(stored ?? starters?.[language] ?? LANGUAGE_STARTERS[language]);
  }, [problemId, language, starters]);

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
            compilerRuntimeVersion: null,
            testResults: null,
            mode: pendingMode,
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
    [language, pendingMode],
  );

  async function execute(mode: 'run' | 'submit') {
    setBusy(true);
    setPendingMode(mode);
    setRefusal(null);
    setResult(null);

    const submitted = await onSubmit({ problemId, sessionId, language, mode, source, stdin });

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
      mode,
      scratchpad: true,
      verdict: null,
      runtimeMs: null,
      memoryKb: null,
      testsPassed: null,
      testsTotal: null,
      stdout: null,
      stderr: null,
      compileOutput: null,
      compilerRuntimeVersion: null,
      testResults: null,
      error: null,
    });

    poll(submitted.jobId, 0);
  }

  /*
   * Three stacked bands: a toolbar, the editor, and the console.
   *
   * The editor takes the space that is left (`flex-1 min-h-0`) rather than a
   * fixed height, so the pane a user drags wider actually gives the editor the
   * room. `min-h-0` is doing real work — without it a flex child refuses to
   * shrink below its content and the console gets pushed off the bottom.
   *
   * Every label and test id below is unchanged from the vertical layout. The
   * arrangement moved; what the tests reach for did not.
   */
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        One control height (h-7) and one border language across the row.

        This was a `py-1` bordered select, a `py-1.5` borderless ghost and a
        `py-1.5` bordered button — three different vertical rhythms and three
        different treatments sitting on one line, which is what made the header
        read as assembled rather than designed.
      */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <label className="sr-only" htmlFor="run-language">
          Language
        </label>
        <select
          // The runtime and its caveat describe what this control selects, so
          // a screen reader hears "Python 3 … Python 3.8.1 … no match
          // statements" rather than the version being visual-only.
          aria-describedby={
            EXECUTION_RUNTIME_CAVEATS[language]
              ? 'run-language-runtime run-language-caveat'
              : 'run-language-runtime'
          }
          className="h-7 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 text-[0.8125rem] transition-colors hover:border-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          id="run-language"
          onChange={(event) => {
            const next = event.target.value;
            if (isExecutionLanguage(next)) setLanguage(next);
          }}
          value={language}
        >
          {EXECUTION_LANGUAGES.filter((value) => !starters || starters[value]).map((value) => (
            <option key={value} value={value}>
              {EXECUTION_LANGUAGE_LABELS[value]}
            </option>
          ))}
        </select>

        {/*
          The runtime, next to the picker rather than buried in docs.

          Judge0's language set has not moved since 2020 and there is no
          release that moves it, so "Python 3" in the dropdown is a promise the
          executor cannot keep for anything after 3.8. Without this line a
          `match` statement is a compile error with no explanation, and the
          obvious reading is that our executor is broken.
        */}
        <span className="text-[0.75rem] text-[var(--text-muted)]" id="run-language-runtime">
          {EXECUTION_RUNTIME_LABELS[language]}
        </span>

        <button
          className="h-7 rounded-[var(--radius)] px-2.5 text-[0.8125rem] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          onClick={() => setSource(starters?.[language] ?? LANGUAGE_STARTERS[language])}
          type="button"
        >
          Reset code
        </button>

        <button
          className="ml-auto h-7 rounded-[var(--radius)] border border-[var(--border)] px-3 text-[0.8125rem] font-medium transition-colors hover:border-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-60"
          disabled={busy || source.trim().length === 0}
          onClick={() => execute('run')}
          type="button"
        >
          {/* The button says which state the run is in — not one word for all four. */}
          {!busy || pendingMode !== 'run'
            ? 'Run code'
            : result?.status === 'running'
              ? 'Running…'
              : 'Queued…'}
        </button>
        {allowSubmit ? (
          <button
            className="h-7 rounded-[var(--radius)] bg-[var(--accent)] px-3 text-[0.8125rem] font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-60"
            disabled={busy || source.trim().length === 0}
            onClick={() => execute('submit')}
            type="button"
          >
            {!busy || pendingMode !== 'submit'
              ? 'Submit'
              : result?.status === 'running'
                ? 'Submitting…'
                : 'Queued…'}
          </button>
        ) : null}
      </div>

      {/*
        The caveat sits on its own line rather than in the control row: it is a
        sentence, and the row is a flex-wrap of h-7 controls that it would
        break. Only the two languages old enough to reject current syntax get
        one, so this is usually absent.
      */}
      {EXECUTION_RUNTIME_CAVEATS[language] ? (
        <p
          className="border-b border-[var(--border)] px-3 py-1.5 text-[0.75rem] text-[var(--text-muted)]"
          id="run-language-caveat"
        >
          {EXECUTION_RUNTIME_CAVEATS[language]}
        </p>
      ) : null}

      {/*
        `min-h-[45vh]` below the breakpoint, released at `md`.

        Without it the editor is FOUR PIXELS TALL on a phone. Above `md` the
        split pane has a definite height (inherited from the layout's flex
        column) and `flex-1` divides it; below `md` the panes stack with no
        height, so `flex-1` has nothing to be a fraction OF and Monaco's
        `height="100%"` resolves against zero.

        The viewport spec asserted stacking ORDER and caught none of this — a
        collapsed editor stacks perfectly well. It now measures the editor.
      */}
      <div className="min-h-[45vh] flex-1 md:min-h-0">
        <CodeEditor language={language} onChange={setSource} value={source} />
      </div>

      {refusal ? (
        <p
          className="border-t border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm"
          data-testid="run-refusal"
          role="status"
        >
          {refusal}
        </p>
      ) : null}

      <ConsoleTabs onStdinChange={setStdin} result={result} stdin={stdin} />
    </div>
  );
}
