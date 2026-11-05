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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ConfidencePicker } from '@/components/session/ConfidencePicker';
import type { Confidence } from '@/lib/session/confidence';
import type { StuckCategory } from '@/lib/reflection/taxonomy';
import { type TimerBarState, formatElapsed, seedElapsed } from '@/lib/session/timer-bar-state';

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
  onComplete: (input: {
    sessionId: string;
    outcome: 'solved' | 'stuck';
    confidence?: Confidence;
  }) => Promise<{
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
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  /** Solved was pressed; the confidence row is showing. Not a confirmation gate. */
  const [askingConfidence, setAskingConfidence] = useState(false);

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
  const finish = async (outcome: 'solved' | 'stuck', confidence?: Confidence) => {
    const ok = await run(() =>
      onComplete({ sessionId, outcome, ...(confidence ? { confidence } : {}) }),
    );
    if (ok) router.push(`/sessions/${sessionId}/reflect`);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-1.5 text-sm"
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

      <div className="ml-auto flex items-center gap-1.5">
        {status === 'active' ? (
          <button
            aria-disabled={busy}
            className={outlineButton}
            onClick={() => run(() => onPause({ sessionId }))}
            type="button"
          >
            Pause
          </button>
        ) : (
          <button
            aria-disabled={busy}
            className={outlineButton}
            onClick={() => run(() => onResume({ sessionId }))}
            type="button"
          >
            Resume
          </button>
        )}

        {/* Available for as long as the session is live, paused included. */}
        <StuckButton onMark={onMarkStuck} sessionId={sessionId} />

        {/*
          The one solid fill on the bar, and it is `--success` rather than
          `--accent` now that `accent-foreground on success` is a measured pair.
          Before this every filled button in the app was the same blue — the
          one that means "finish successfully" looked identical to the one that
          means "discard this sitting".
        */}
        <button
          aria-disabled={busy}
          className="rounded-[var(--radius)] bg-[var(--success)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60"
          onClick={() => setAskingConfidence(true)}
          type="button"
        >
          Solved
        </button>

        {/*
          "Give up", not "Stuck". The old label sat beside "I'm stuck" and did
          something almost opposite: "I'm stuck" records a marker and the
          session carries on, this ENDS the session. Two adjacent buttons whose
          names differ by an apostrophe, one of them terminal, is a trap rather
          than a vocabulary.
        */}
        <button
          aria-disabled={busy}
          className={quietButton}
          onClick={() => void finish('stuck')}
          type="button"
        >
          Give up
        </button>

        {/* A rule, because what follows destroys the sitting rather than ending it. */}
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border)]" />

        <button
          aria-disabled={busy}
          className="rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60"
          onClick={() => setConfirmingAbandon(true)}
          type="button"
        >
          Abandon
        </button>
      </div>

      {/*
        The confidence row, revealed by Solved.

        Deliberately NOT a ConfirmDialog. The comment below records why Solved
        is unconfirmed, and that reasoning still holds — this is not a
        confirm/cancel gate in front of the success path. Every option here,
        Skip included, completes the session; it asks a question on the way past
        rather than standing in the doorway.

        It earns the extra click because confidence is the ladder's strongest
        signal — 'low' picks the compressed ladder, 'high' is a precondition of
        the only rule that lengthens a gap — and until now nothing collected it
        before the schedule was written.
      */}
      {askingConfidence ? (
        <div className="flex w-full flex-wrap items-center gap-2 pt-0.5">
          <ConfidencePicker
            busy={busy}
            onChoose={(confidence) => {
              setAskingConfidence(false);
              void finish('solved', confidence);
            }}
          />
        </div>
      ) : null}

      {/*
        Abandon is the only one of the five that DISCARDS. A solved or
        given-up sitting is kept, numbered and shown on the reflection page, so
        a mis-click there is visible and costs nothing; an abandoned one is not
        even numbered as an attempt. It fired on a single click, from a button
        identical to Pause, until now.

        Solved and Give up are deliberately left unconfirmed: a dialog in front
        of the ordinary success path is the thing that teaches people to dismiss
        dialogs without reading them, which would blunt this one.
      */}
      <ConfirmDialog
        confirmLabel="Abandon it"
        description="This sitting is discarded. It will not be counted as an attempt, and the time on it is not kept."
        destructive
        onCancel={() => setConfirmingAbandon(false)}
        onConfirm={() => {
          setConfirmingAbandon(false);
          void run(() => onAbandon({ sessionId }));
        }}
        open={confirmingAbandon}
        title="Abandon this session?"
      />

      {error ? (
        <p className="w-full text-[var(--danger)]" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/*
 * Three weights, not one.
 *
 * Every button on this bar used to share `buttonClass`, so Pause (reversible),
 * Solved (terminal, success) and Abandon (terminal, destructive) were the same
 * pill. The weight now matches the consequence: solid for the one that
 * finishes, outline for the reversible pair, text-only for the two that end or
 * discard.
 */
const outlineButton =
  'rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors hover:border-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60';

const quietButton =
  'rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60';
