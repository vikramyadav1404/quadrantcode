'use client';

/**
 * The live sitting's clock and controls, shared by the two places that show
 * them (#40 part 2):
 *
 *   · `TimerBar`, the layout bar on every page under `(app)`
 *   · `SessionStripV2`, the strip on /solve, whose layout renders no bar
 *
 * Until #40 each held its own copy of this logic (the strip was v2's copy of
 * the bar). Both stay, because they look different and the strip also lists
 * the sitting's events, so the logic is shared here instead of one being
 * deleted. Only one of them is ever mounted on a page, so there is one clock
 * and one heartbeat.
 *
 * ## The clock is decoration; the server holds the time
 *
 * It ticks once a second so the number moves, but that tick is display only.
 * Every heartbeat reply overwrites the count with the server's, so the two can
 * differ by at most one heartbeat interval, always with the display slightly
 * behind. Nothing here is sent back: the heartbeat body is a session id. A
 * refresh, a closed tab or a wrong machine clock changes nothing, because the
 * value comes from timestamps the server wrote (D20).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Confidence } from '@/lib/session/confidence';
import type { StuckCategory } from '@/lib/reflection/taxonomy';
import { type TimerBarState, seedElapsed } from '@/lib/session/timer-bar-state';

/** Every 30 s while active. Without it the server idle-autopauses a live sitting. */
export const HEARTBEAT_MS = 30_000;

type Result = { ok: boolean; message?: string };

/** Pause, Resume and Abandon: the session id is all they take. */
export type SessionAction = (input: { sessionId: string }) => Promise<Result>;

/** Solved (with an optional confidence) and Give up. */
export type CompleteSessionAction = (input: {
  sessionId: string;
  outcome: 'solved' | 'stuck';
  confidence?: Confidence;
}) => Promise<Result>;

/** "I'm stuck": records a marker; the sitting carries on. */
export type MarkStuckAction = (input: {
  sessionId: string;
  category: StuckCategory;
  note?: string;
}) => Promise<Result>;

/** The server actions both the bar and the strip are given. */
export type SessionControlActions = {
  onPause: SessionAction;
  onResume: SessionAction;
  onAbandon: SessionAction;
  onComplete: CompleteSessionAction;
  onMarkStuck: MarkStuckAction;
};

export function useSessionControls(state: TimerBarState, onComplete: CompleteSessionAction) {
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

  /*
   * Re-seed whenever the server sends a new state (a pause, a resume, a
   * navigation): the prop is the authority, not the last thing we counted to.
   *
   * Adjusted during render rather than in an effect (#48): React's pattern for
   * state that follows a prop, so the new number is on screen in the same
   * render instead of one render late.
   */
  const seedKey = `${state.asOf}|${state.activeDurationSeconds}|${status}`;
  const [seededFor, setSeededFor] = useState(seedKey);
  if (seededFor !== seedKey) {
    setSeededFor(seedKey);
    setElapsed(seedElapsed(state));
  }

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

  const run = async (action: () => Promise<Result>) => {
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

  return {
    sessionId,
    status,
    elapsed,
    busy,
    error,
    confirmingAbandon,
    setConfirmingAbandon,
    askingConfidence,
    setAskingConfidence,
    run,
    finish,
  };
}
