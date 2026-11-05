'use client';

/**
 * The session strip on /solve (step C2): the live sitting's clock, its
 * controls, and what has happened in it so far, above the editor.
 *
 * ## Same controls, same names, same behaviour as the timer bar
 *
 * Every control TimerBar has is here under the same accessible name, so every
 * spec that drives the timer bar drives this on /solve unchanged: the region
 * "Solve session timer", Pause/Resume, "I'm stuck" (the shared StuckButton),
 * Solved with its confidence picker, Give up, and Abandon behind the same
 * "Abandon it" confirmation. Finishing goes to the reflection page.
 *
 * The clock, the heartbeat and those control flows are `useSessionControls`,
 * shared with TimerBar (#40 part 2). Until then this file held its own copy.
 *
 * ## The only timer on this page, so it sends the heartbeat
 *
 * The solve route's layout renders no layout timer bar
 * (`app/(solve)/layout.tsx`), so this strip is the one "Solve session timer"
 * and the one heartbeat. Without it the server would idle-autopause a sitting
 * someone is actively working on.
 *
 * Imported only by SolveShellV2. `data-solve-v2-strip` is the marker the strip
 * spec finds it by.
 */
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ConfidencePicker } from '@/components/session/ConfidencePicker';
import { StuckButton } from '@/components/session/StuckButton';
import {
  type SessionControlActions,
  useSessionControls,
} from '@/components/session/useSessionControls';
import { VERDICT_LABELS } from '@/lib/execution/languages';
import { STUCK_CATEGORY_LABELS } from '@/lib/reflection/taxonomy';
import { type TimerBarState, formatElapsed } from '@/lib/session/timer-bar-state';
import type { StuckCategory } from '@/lib/reflection/taxonomy';
import type { StripEventView } from '@/lib/solve-v2/strip-view';

/** How many of the most recent events the strip lists; the rest are counted. */
const SHOWN = 6;

export function SessionStripV2({
  state,
  events,
  onPause,
  onResume,
  onComplete,
  onAbandon,
  onMarkStuck,
}: { state: TimerBarState; events: StripEventView[] } & SessionControlActions) {
  const {
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
  } = useSessionControls(state, onComplete);

  const shown = events.slice(-SHOWN);
  const earlier = events.length - shown.length;

  return (
    <div
      aria-label="Solve session timer"
      className="mb-3 flex shrink-0 flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
      data-solve-v2-strip=""
      role="region"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-medium">
          {status === 'paused' ? 'Paused' : 'Solving'}{' '}
          <Link className="underline" href={`/problems/${state.problemSlug}`}>
            {state.problemTitle}
          </Link>
        </span>

        {/* Not aria-live: a per-second update would make a screen reader unusable. */}
        <span
          aria-label={`Active time ${formatElapsed(elapsed)}`}
          className="font-mono text-base tabular-nums"
        >
          {formatElapsed(elapsed)}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* Small on purpose (the plan's "Pause can be small"), but always there. */}
          {status === 'active' ? (
            <button
              aria-disabled={busy}
              className={smallButton}
              onClick={() => run(() => onPause({ sessionId }))}
              type="button"
            >
              Pause
            </button>
          ) : (
            <button
              aria-disabled={busy}
              className={smallButton}
              onClick={() => run(() => onResume({ sessionId }))}
              type="button"
            >
              Resume
            </button>
          )}

          <StuckButton onMark={onMarkStuck} sessionId={sessionId} />

          <button
            aria-disabled={busy}
            className="rounded-[var(--radius)] bg-[var(--success)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60"
            onClick={() => setAskingConfidence(true)}
            type="button"
          >
            Solved
          </button>

          <button
            aria-disabled={busy}
            className={quietButton}
            onClick={() => void finish('stuck')}
            type="button"
          >
            Give up
          </button>

          {/*
            The separator and Abandon wrap as one item. Apart, a narrow screen
            moved Abandon to the next line and left the separator hanging at
            the end of this one.
          */}
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="mx-0.5 h-4 w-px bg-[var(--border)]"
              data-solve-v2-strip-separator=""
            />

            <button
              aria-disabled={busy}
              className="rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60"
              onClick={() => setConfirmingAbandon(true)}
              type="button"
            >
              Abandon
            </button>
          </span>
        </div>
      </div>

      {askingConfidence ? (
        <div className="flex flex-wrap items-center gap-2">
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
        What has happened in this sitting, from the light server read
        (getSessionStrip): lifecycle, stuck marks and run verdicts. Code
        snapshots are left out; the run that made each one is listed instead.
      */}
      {events.length > 0 ? (
        <ol aria-label="Session events" className="flex flex-wrap items-center gap-1.5 text-xs">
          {earlier > 0 ? (
            <li className="text-[var(--text-muted)]">+{earlier} earlier</li>
          ) : null}
          {shown.map((event) => (
            <li
              className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)]"
              key={event.id}
            >
              <span className="font-mono tabular-nums">
                {formatElapsed(event.elapsedSeconds)}
              </span>{' '}
              {describe(event)}
            </li>
          ))}
        </ol>
      ) : null}

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
        <p className="text-[var(--danger)]" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One event, said the way the strip lists it. */
function describe(event: StripEventView): string {
  switch (event.type) {
    case 'session_started':
      return 'Started';
    case 'paused':
      return 'Paused';
    case 'resumed':
      return 'Resumed';
    case 'idle_autopause':
      return 'Paused (idle)';
    case 'stuck_marked':
      return `Stuck · ${
        (event.category && STUCK_CATEGORY_LABELS[event.category as StuckCategory]) ??
        event.category ??
        'unspecified'
      }`;
    case 'run_attempted':
      return `Run · ${
        (event.verdict && VERDICT_LABELS[event.verdict as keyof typeof VERDICT_LABELS]) ??
        event.verdict ??
        'no verdict'
      }`;
    default:
      return event.type.replace(/_/g, ' ');
  }
}

const smallButton =
  'rounded-[var(--radius)] border border-[var(--border)] px-2 py-0.5 text-xs font-medium transition-colors hover:border-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60';

const quietButton =
  'rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] aria-disabled:opacity-60';
