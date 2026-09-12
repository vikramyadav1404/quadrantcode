'use client';

/**
 * The persistent solve timer, on every authenticated screen while a session is
 * live.
 *
 * ## The clock here is decoration; the server holds the time
 *
 * The bar ticks once a second so the number moves, but that tick is display
 * only. Every heartbeat response overwrites the count with the server's, so the
 * two can differ by at most one heartbeat interval and always in the direction
 * of "the display is slightly behind". Nothing here is ever sent back: the
 * heartbeat body is a session id.
 *
 * That is why a refresh, a tab close or a machine with the wrong clock changes
 * nothing — the value came from timestamps the server wrote.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StuckButton } from '@/components/session/StuckButton';
import type { StuckCategory } from '@/lib/reflection/taxonomy';
import { type TimerBarState, formatElapsed } from '@/lib/session/timer-bar-state';

const HEARTBEAT_MS = 30_000;

type Action = (input: { sessionId: string }) => Promise<{ ok: boolean; message?: string }>;

export function TimerBar({
  state,
  onPause,
  onResume,
  onComplete,
  onAbandon,
  onMarkStuck,
}: {
  state: TimerBarState;
  onPause: Action;
  onResume: Action;
  onAbandon: Action;
  onComplete: (input: { sessionId: string; outcome: 'solved' | 'stuck' }) => Promise<{
    ok: boolean;
    message?: string;
  }>;
  onMarkStuck: (input: {
    sessionId: string;
    category: StuckCategory;
    note?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const { sessionId, status } = state;
  const router = useRouter();

  /*
   * Seeded from the server's number and the instant it was true, so a page that
   * sat in a background tab for a minute before hydrating shows the right value
   * immediately rather than counting up from a stale zero.
   */
  const [elapsed, setElapsed] = useState(() => seedElapsed(state));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the server sends a new state (a pause, a resume, a
  // navigation): the prop is the authority, not the last thing we counted to.
  const asOf = state.asOf;
  useEffect(() => {
    setElapsed(seedElapsed(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed on server updates only
  }, [asOf, state.activeDurationSeconds, status]);

  // The display tick. Stops while paused, because a paused session accrues
  // nothing and a moving number would say otherwise.
  useEffect(() => {
    if (status !== 'active') return;

    const id = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // The heartbeat, and the resync that comes back with it.
  useEffect(() => {
    if (status !== 'active') return;

    const send = async () => {
      try {
        const response = await fetch('/api/session/heartbeat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (!response.ok) return;

        const body: { activeDurationSeconds?: number } = await response.json();
        if (typeof body.activeDurationSeconds === 'number') {
          setElapsed(body.activeDurationSeconds);
        }
      } catch {
        /*
         * A missed heartbeat is not an error worth showing. The consequence is
         * already designed for: enough of them and the server pauses the
         * session from the last one it received.
         */
      }
    };

    const id = setInterval(send, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [sessionId, status]);

  const run = async (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.message ?? 'That did not work.');
    setBusy(false);
    return result.ok;
  };

  /**
   * Finishing takes the user to the reflection — **the nudge, and the whole of
   * it** (F1.5). A page they have to leave is harder to miss than a prompt, and
   * skipping still costs one click, which is what keeps the answers worth
   * having: a form nobody can escape is answered to get past it.
   */
  const finish = async (outcome: 'solved' | 'stuck') => {
    const ok = await run(() => onComplete({ sessionId, outcome }));
    if (ok) router.push(`/sessions/${sessionId}/reflect`);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm"
      role="region"
      aria-label="Solve session timer"
    >
      <span className="font-medium">
        {status === 'paused' ? 'Paused' : 'Solving'}{' '}
        <Link className="underline" href={`/problems/${state.problemSlug}`}>
          {state.problemTitle}
        </Link>
      </span>

      {/*
        Not an aria-live region. A value that changes every second would be
        announced every second, which makes a screen reader unusable; the label
        names it and the status changes around it are what actually matter.
      */}
      <span
        className="font-mono tabular-nums"
        aria-label={`Active time ${formatElapsed(elapsed)}`}
      >
        {formatElapsed(elapsed)}
      </span>

      <div className="ml-auto flex items-center gap-2">
        {status === 'active' ? (
          <button
            aria-disabled={busy}
            className={buttonClass}
            onClick={() => run(() => onPause({ sessionId }))}
            type="button"
          >
            Pause
          </button>
        ) : (
          <button
            aria-disabled={busy}
            className={buttonClass}
            onClick={() => run(() => onResume({ sessionId }))}
            type="button"
          >
            Resume
          </button>
        )}

        {/* Available for as long as the session is live, paused included. */}
        <StuckButton onMark={onMarkStuck} sessionId={sessionId} />

        <button
          aria-disabled={busy}
          className={buttonClass}
          onClick={() => void finish('solved')}
          type="button"
        >
          Solved
        </button>

        <button
          aria-disabled={busy}
          className={buttonClass}
          onClick={() => void finish('stuck')}
          type="button"
        >
          Stuck
        </button>

        <button
          aria-disabled={busy}
          className={buttonClass}
          onClick={() => run(() => onAbandon({ sessionId }))}
          type="button"
        >
          Abandon
        </button>
      </div>

      {error ? (
        <p className="w-full text-[var(--danger)]" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const buttonClass =
  'rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-xs font-medium aria-disabled:opacity-60';

/**
 * The server's count plus however long ago it was true.
 *
 * A paused session takes the number as-is: no time has passed for it, whatever
 * the wall clock did.
 */
function seedElapsed(state: TimerBarState): number {
  if (state.status !== 'active') return state.activeDurationSeconds;

  const sinceAsOf = Math.max(
    0,
    Math.floor((Date.now() - new Date(state.asOf).getTime()) / 1000),
  );
  return state.activeDurationSeconds + sinceAsOf;
}
