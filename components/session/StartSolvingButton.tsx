'use client';

/**
 * "Start solving" on a problem page.
 *
 * The conflict case is the whole reason this is a component rather than a form
 * post: starting a second session while one is live is refused, and the refusal
 * carries the running session. The ticket's wording is "prompts to finish or
 * abandon the existing one" — so the message says which, and links to it.
 */
import { useState } from 'react';
import Link from 'next/link';

type StartResult = {
  ok: boolean;
  message?: string;
  conflictWith?: { id: string; problemId: string };
};

export function StartSolvingButton({
  problemId,
  onStart,
}: {
  problemId: string;
  onStart: (input: { problemId: string }) => Promise<StartResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StartResult | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        aria-disabled={busy}
        className="self-start rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] aria-disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          setResult(await onStart({ problemId }));
          setBusy(false);
        }}
        type="button"
      >
        {busy ? 'Starting…' : 'Start solving'}
      </button>

      {result && !result.ok ? (
        <p className="text-sm text-[var(--text-muted)]" role="status">
          {result.message}{' '}
          {result.conflictWith ? (
            /*
             * The timer bar is already on screen with its own controls, so this
             * only has to point at it rather than duplicate finish and abandon.
             */
            <span>Use the timer at the top of the page to finish or abandon it.</span>
          ) : null}
        </p>
      ) : null}

      {result?.ok ? (
        <p className="text-sm text-[var(--text-muted)]" role="status">
          Session started — the timer is at the top of the page.{' '}
          <Link className="underline" href="/dashboard">
            Go to your dashboard
          </Link>
        </p>
      ) : null}
    </div>
  );
}
