'use client';

/**
 * "Start solving" on a problem page.
 *
 * The conflict case is the whole reason this is a component rather than a form
 * post: starting a second session while one is live is refused, and the refusal
 * carries the running session. The ticket's wording is "prompts to finish or
 * abandon the existing one" — so the message says which, and links to it.
 *
 * ## Why the notices are checked against the live session
 *
 * Both messages below are claims about a session — "it started", "one is
 * already running" — and they used to live in client state alone. Client state
 * is exactly what `revalidatePath` does NOT clear: abandoning from the timer
 * bar re-rendered this page and took the bar off screen, and the paragraph
 * stayed behind pointing at a bar that was no longer there.
 *
 * So the claim is checked against the thing it claims. The live session comes
 * from the shell's context, which the layout already resolved — no query here,
 * and no prop threaded through the page. A message about a session that is no
 * longer the live one is not shown. A message that makes no such claim — "that
 * problem is not valid" — is unaffected, because it is about the request.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActiveSessionId } from '@/components/session/ActiveSessionContext';

// DIAGNOSTIC BRANCH ONLY (issue #26, experiment E5). Inlined at build time.
const DIAG_REFRESH_WORKAROUND = process.env.NEXT_PUBLIC_DIAG_REFRESH_WORKAROUND === '1';

type StartResult = {
  ok: boolean;
  message?: string;
  /** The session that was started. Absent on every failure. */
  session?: { id: string } | null;
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
  const activeSessionId = useActiveSessionId();

  /*
   * Which session the held result is about: the one it started, or the running
   * one that blocked it. Null means it asserts nothing about session state.
   */
  const claimedSessionId = result?.ok
    ? (result.session?.id ?? null)
    : (result?.conflictWith?.id ?? null);

  const current =
    claimedSessionId !== null && claimedSessionId !== activeSessionId ? null : result;

  // E5: the action succeeded but the layout still shows no new session → refresh once.
  const router = useRouter();
  const latestActive = useRef(activeSessionId);
  latestActive.current = activeSessionId;
  const refreshed = useRef<string | null>(null);
  const startedId = result?.ok ? (result.session?.id ?? null) : null;
  useEffect(() => {
    if (!DIAG_REFRESH_WORKAROUND || !startedId || refreshed.current === startedId) return;
    const handle = setTimeout(() => {
      if (latestActive.current === startedId) return;
      refreshed.current = startedId;
      console.warn('DIAG refresh-workaround fired');
      router.refresh();
    }, 750);
    return () => clearTimeout(handle);
  }, [startedId, router]);

  return (
    <div className="flex flex-col gap-2">
      {/*
        The one solid fill on this page, and it belongs here: starting a sitting
        is what this page is FOR. Opening the problem on its platform is a way
        out of the page, and is an outline for that reason — see the header.
      */}
      <button
        aria-disabled={busy}
        className="self-start rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          setResult(await onStart({ problemId }));
          setBusy(false);
        }}
        type="button"
      >
        {busy ? 'Starting…' : 'Start solving'}
      </button>

      {current && !current.ok ? (
        <p className="text-sm text-[var(--text-muted)]" role="status">
          {current.message}{' '}
          {current.conflictWith ? (
            /*
             * The timer bar is already on screen with its own controls, so this
             * only has to point at it rather than duplicate finish and abandon.
             */
            <span>Use the timer at the top of the page to finish or abandon it.</span>
          ) : null}
        </p>
      ) : null}

      {current?.ok ? (
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
