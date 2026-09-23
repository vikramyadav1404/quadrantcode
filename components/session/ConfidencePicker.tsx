'use client';

import {
  CONFIDENCE_LABELS,
  CONFIDENCE_LEVELS,
  type Confidence,
} from '@/lib/session/confidence';

/**
 * How sure the user was, asked at the moment a solve is recorded.
 *
 * ## Why this exists at all
 *
 * `confidence` is accepted by `completeSessionSchema`, carried by
 * `completeSession`, and read by `scheduleAfterSolve` — where it does more than
 * any other signal: `'low'` picks the compressed ladder outright, and `'high'`
 * is a precondition of `clean-and-quick`, the one rule that lengthens a gap.
 *
 * Nothing collected it. `ReflectionForm` asks, but on `/sessions/[id]/reflect`,
 * which runs AFTER the schedule row has already been written, and no path
 * re-schedules. So two of the ladder's five rules had never fired in
 * production. This is the control that makes them reachable.
 *
 * ## Why it is not a confirmation dialog
 *
 * `TimerBar` records a deliberate decision that Solved is unconfirmed: "a
 * dialog in front of the ordinary success path is the thing that teaches people
 * to dismiss dialogs without reading them". That reasoning is sound and this
 * does not overturn it.
 *
 * So this is not a confirm/cancel gate. Every option — including Skip —
 * completes the action. It asks a question on the way past rather than standing
 * in front of the door, and Skip sends `undefined`, which is the honest value
 * when someone declines to answer rather than a middle rating standing in for
 * silence.
 */

export function ConfidencePicker({
  busy = false,
  onChoose,
  prompt = 'How confident are you in this solution?',
}: {
  busy?: boolean;
  /** `undefined` means the user declined to say — never coerced to a rating. */
  onChoose: (confidence: Confidence | undefined) => void;
  prompt?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="confidence-picker">
      <span className="text-xs text-[var(--text-muted)]">{prompt}</span>
      {CONFIDENCE_LEVELS.map((value) => (
        <button
          aria-disabled={busy}
          className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60"
          key={value}
          onClick={() => onChoose(value)}
          type="button"
        >
          {CONFIDENCE_LABELS[value]}
        </button>
      ))}
      <button
        aria-disabled={busy}
        className="rounded-[var(--radius)] px-2 py-1 text-xs text-[var(--text-muted)] underline-offset-2 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60"
        onClick={() => onChoose(undefined)}
        type="button"
      >
        Skip
      </button>
    </div>
  );
}
