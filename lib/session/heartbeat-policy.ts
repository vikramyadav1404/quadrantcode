/**
 * When the client beats, and what it does with the reply.
 *
 * ## A hidden tab does not beat
 *
 * Until this existed the heartbeat fired every 30 seconds for as long as the
 * page was open, visible or not. Browsers throttle background timers but do not
 * stop them, so a backgrounded tab or a minimised window kept a sitting
 * `active` indefinitely: the server's idle autopause (`IDLE_TIMEOUT_SECONDS`)
 * never fired, the forgotten sitting kept accruing time, and the Neon compute
 * never got to suspend.
 *
 * Now a hidden page sends nothing. The server already knows what to do with
 * silence: after five minutes without a beat the sitting is paused, stamped at
 * the last beat it received — so time spent away is not counted. A short trip
 * to another tab (under the idle threshold) is unaffected, which is the point
 * of using the existing threshold rather than pausing on every tab switch.
 *
 * ## Coming back
 *
 * The page beats once immediately when it becomes visible again, rather than
 * waiting up to 30 seconds. If the server answers that the sitting is no longer
 * active — autopaused while away, or closed by the six-hour sweep — the page
 * refreshes so the bar shows the server's state instead of a clock still
 * counting.
 */
export function shouldSendHeartbeat(
  visibilityState: DocumentVisibilityState | undefined,
): boolean {
  return visibilityState !== 'hidden';
}

/** The reply's status means the bar on screen is out of date. */
export function heartbeatEndedActivity(status: unknown): boolean {
  return typeof status === 'string' && status !== 'active';
}
