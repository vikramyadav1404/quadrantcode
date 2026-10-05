/**
 * What the timer bar needs to render, in the client-safe layer.
 *
 * `components/` may not import from `server/` (deny-by-default, F0.1), and this
 * is the contract between the layout's read and the bar that draws it — the
 * same reason `lib/streak/heatmap-day.ts` exists.
 *
 * Note what crosses the boundary: **a number and the instant it was true**, not
 * a running clock. The client may tick the display forward from `asOf` for
 * smoothness, but every heartbeat replaces the number with the server's, so the
 * displayed value can never drift away from the authoritative one for longer
 * than one heartbeat interval.
 */
export type TimerBarState = {
  sessionId: string;
  problemId: string;
  problemTitle: string;
  problemSlug: string;
  status: 'active' | 'paused';
  /** Active seconds, as computed by the server at `asOf`. */
  activeDurationSeconds: number;
  /** ISO instant the count above was true. */
  asOf: string;
};

/** `HH:MM:SS`, or `MM:SS` under an hour. Pure, so it is testable on its own. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));

  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * The server's count plus however long ago it was true.
 *
 * A paused session takes the number as-is: no time has passed for it, whatever
 * the wall clock did.
 *
 * Moved here unchanged from `TimerBar.tsx` (step C2) so the v2 session strip
 * seeds its display with the same arithmetic instead of a copy. `nowMs` is a
 * parameter only so a test can pin the clock.
 */
export function seedElapsed(state: TimerBarState, nowMs: number = Date.now()): number {
  if (state.status !== 'active') return state.activeDurationSeconds;

  const sinceAsOf = Math.max(0, Math.floor((nowMs - new Date(state.asOf).getTime()) / 1000));
  return state.activeDurationSeconds + sinceAsOf;
}
