'use client';

/**
 * What the run produced.
 *
 * ## Why this file is separate from the panel around it
 *
 * This is the only component in the project that renders bytes a program wrote.
 * A user's C++ can print `<script>fetch('/api/…')</script>` and this is where it
 * arrives. It is its own file so that the rule below has somewhere to live
 * where a reviewer will find it before changing anything.
 *
 * **Everything here goes through `{value}`, which React escapes into a text
 * node. There is no `dangerouslySetInnerHTML` in this file, and adding one
 * would turn every user into an author of markup on this page.**
 *
 * Note what this is NOT: it is not sanitising. Nothing strips tags, nothing
 * allowlists elements. `<script>` survives to the screen intact and inert,
 * which is the correct behaviour — a program that prints a tag should see the
 * tag it printed, and a scratchpad that quietly rewrites your output is worse
 * than one that shows it.
 *
 * `whitespace-pre-wrap` keeps the program's own line breaks. `break-words`
 * stops a single long line from widening the page.
 */
import {
  type ExecutionResultView,
  formatMemory,
  formatRuntime,
  isPending,
} from '@/lib/execution/view';
import { VERDICT_LABELS } from '@/lib/execution/languages';

/** Which token a verdict borrows. Colour is never the only signal — the label is words. */
const VERDICT_TOKEN: Record<string, string> = {
  accepted: 'var(--success)',
  wrong_answer: 'var(--danger)',
  tle: 'var(--warning)',
  mle: 'var(--warning)',
  runtime_error: 'var(--danger)',
  compile_error: 'var(--danger)',
  internal_error: 'var(--text-muted)',
};

export function RunOutput({ result }: { result: ExecutionResultView | null }) {
  if (!result) {
    return (
      <p className="text-sm text-[var(--text-muted)]">Run your code to see its output here.</p>
    );
  }

  if (isPending(result.status)) {
    return (
      <p aria-live="polite" className="text-sm text-[var(--text-muted)]">
        {result.status === 'queued' ? 'Queued…' : 'Running…'}
      </p>
    );
  }

  /*
   * A failed JOB is not a verdict. The provider was unreachable, or the runner
   * stopped — neither is a statement about the user's program, and this branch
   * exists so that nothing here can be mistaken for one.
   */
  if (result.status === 'failed') {
    return (
      <div
        aria-live="polite"
        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-3"
      >
        <p className="text-sm font-medium">This run didn&rsquo;t complete.</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {result.error ?? 'The run stopped before it produced a result.'}
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Nothing about your code was checked. Run it again when you&rsquo;re ready.
        </p>
      </div>
    );
  }

  const submitted = result.mode === 'submit';

  return (
    <div aria-live="polite" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {/*
          Say WHICH action produced this.
          `mode` was on the result all along and rendered nowhere, so an
          accepted Submit and an accepted Run were byte-identical on screen —
          the submission landed, the problem was marked solved, and the only
          way to find out was to reload the page. "No visible submitted state"
          was reported as a lost submission; it was a missing sentence.
        */}
        <span
          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-[var(--text-muted)]"
          data-testid="run-mode"
        >
          {submitted ? 'Submitted' : 'Ran'}
        </span>

        {result.verdict ? (
          <span
            className="font-medium"
            data-testid="run-verdict"
            style={{ color: VERDICT_TOKEN[result.verdict] ?? 'var(--text-primary)' }}
          >
            {VERDICT_LABELS[result.verdict]}
          </span>
        ) : null}

        <span className="text-sm text-[var(--text-muted)]">
          {formatRuntime(result.runtimeMs)} · {formatMemory(result.memoryKb)}
        </span>

        {/*
          Test counts only when there are tests. C1 means an external problem
          has none, and `0 / 0` there would read as a failure rather than as
          "there was nothing to check".
        */}
        {result.testsTotal !== null ? (
          <span className="text-sm text-[var(--text-muted)]">
            {result.testsPassed} / {result.testsTotal} tests
          </span>
        ) : null}
      </div>

      {/*
        The consequence, not just the verdict.
        An accepted Submit sets `user_problems.status = 'solved'` server-side.
        Saying so here is the difference between "my code passed" and "this is
        recorded" — and the second is what the user was looking for and could
        not find.

        Scoped to a verified submit: a Run that happens to pass every visible
        case changes nothing, and claiming otherwise would be worse than silence.
      */}
      {submitted && result.verdict === 'accepted' && !result.scratchpad ? (
        <p className="text-sm text-[var(--success)]" data-testid="run-solved-note">
          Recorded — this problem is marked solved.
        </p>
      ) : null}

      {result.compilerRuntimeVersion ? (
        <p className="text-xs text-[var(--text-muted)]">
          Runtime: {result.compilerRuntimeVersion}
        </p>
      ) : null}

      {result.scratchpad ? (
        <p className="text-sm text-[var(--text-muted)]">
          This problem lives on another site, so nothing here is checked against its tests — the
          editor is a scratchpad. Submit on the original platform.
        </p>
      ) : null}

      {result.testResults?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {result.testResults.map((test) => (
            <div
              className="rounded-[var(--radius)] border border-[var(--border)] p-2 text-xs"
              key={`${test.visibility}-${test.ordinal}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {test.visibility === 'hidden'
                    ? `Hidden case ${test.ordinal}`
                    : test.visibility === 'custom'
                      ? 'Custom case'
                      : `Case ${test.ordinal}`}
                </span>
                <span>{VERDICT_LABELS[test.verdict]}</span>
              </div>
              {test.visibility !== 'hidden' && test.input !== undefined ? (
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-raised)] p-2">
                  Input: {test.input}
                  {test.expectedOutput !== undefined
                    ? `\nExpected: ${test.expectedOutput}`
                    : ''}
                  {test.actualOutput !== undefined
                    ? `\nActual: ${test.actualOutput ?? '—'}`
                    : ''}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <OutputBlock label="Output" value={result.stdout} />
      <OutputBlock label="Errors" value={result.stderr} />
      <OutputBlock label="Compiler" value={result.compileOutput} />
    </div>
  );
}

/**
 * One stream of program output.
 *
 * `{value}` and nothing else. See the file header before changing this.
 */
function OutputBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </h3>
      <pre
        className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 font-mono text-xs"
        data-testid={`run-output-${label.toLowerCase()}`}
      >
        {value}
      </pre>
    </div>
  );
}
