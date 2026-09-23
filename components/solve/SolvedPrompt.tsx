'use client';

import { useEffect, useState } from 'react';
import { ConfidencePicker } from '@/components/session/ConfidencePicker';
import { isPending, type ExecutionResultView } from '@/lib/execution/view';
import type { Confidence } from '@/lib/session/confidence';

/**
 * "Accepted — finish this sitting?", after a verified Submit inside a session.
 *
 * ## Why a prompt and not an auto-stop
 *
 * Solving the problem and closing the sitting are different facts and are
 * allowed to disagree. An accepted Submit already sets
 * `user_problems.status = 'solved'` server-side, and it stays solved whether or
 * not this prompt is answered — declining means "I am not done sitting here",
 * not "that did not count".
 *
 * Stopping the timer automatically would be wrong twice over. It destroys the
 * ordinary case of submitting, passing, and carrying on to tidy the solution;
 * and the timer is server-authoritative, so a client-observed event ending it
 * would put the browser in charge of a duration the server owns.
 *
 * ## Why it carries the confidence picker
 *
 * `scheduleAfterSolve` reads confidence harder than any other signal, and
 * nothing collected it before the schedule row was written — `ReflectionForm`
 * asks afterwards, and no path re-schedules. This is the moment the answer is
 * cheapest to give and most useful to have.
 */
export function SolvedPrompt({
  jobId,
  onComplete,
  result,
}: {
  /** Resets the prompt per run, so dismissing one does not silence the next. */
  jobId: string;
  onComplete: (
    confidence: Confidence | undefined,
  ) => Promise<{ ok: boolean; message?: string }>;
  result: ExecutionResultView;
}) {
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new job is a new question. Without this, dismissing once would suppress
  // the prompt for every later submission in the same sitting.
  useEffect(() => {
    setError(null);
  }, [jobId]);

  const offer =
    result.mode === 'submit' &&
    result.verdict === 'accepted' &&
    !isPending(result.status) &&
    dismissedFor !== jobId;

  if (!offer) return null;

  return (
    <div
      className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--surface-raised)] p-3"
      data-testid="solved-prompt"
      role="status"
    >
      <p className="text-sm font-medium">
        Accepted. Mark this sitting solved and stop the timer?
      </p>
      <ConfidencePicker
        busy={busy}
        onChoose={(confidence) => {
          setBusy(true);
          setError(null);
          void onComplete(confidence)
            .then((outcome) => {
              if (!outcome.ok) setError(outcome.message ?? 'That did not go through.');
            })
            .finally(() => setBusy(false));
        }}
      />
      <div className="flex items-center gap-3">
        <button
          aria-disabled={busy}
          className="rounded-[var(--radius)] px-2 py-1 text-xs text-[var(--text-muted)] underline-offset-2 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60"
          onClick={() => setDismissedFor(jobId)}
          type="button"
        >
          Keep working
        </button>
        {/*
          Said plainly, because the two facts diverging is the point. Someone
          who keeps working should not be left wondering whether their accepted
          submission counted.
        */}
        <span className="text-xs text-[var(--text-muted)]">
          The problem stays marked solved either way.
        </span>
      </div>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
