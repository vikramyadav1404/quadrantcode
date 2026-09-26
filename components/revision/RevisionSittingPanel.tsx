/**
 * F2.2 · what the live revision mode shows above the statement.
 *
 * Presentational only: every field arrives from `sittingView`, which loads per
 * mode exactly what that mode may show. A blind sitting's view carries nothing
 * but its name, so there is nothing here that could leak.
 */
import Link from 'next/link';
import { REVISION_MODE_LABELS, type RevisionSittingView } from '@/lib/revision/modes';
import { formatElapsed } from '@/lib/session/timer-bar-state';
import { SpeedCountdown } from './SpeedCountdown';

export function RevisionSittingPanel({
  sitting,
  elapsedSeconds,
  paused,
  lastAttemptedLabel,
}: {
  sitting: RevisionSittingView;
  elapsedSeconds: number;
  paused: boolean;
  /** Formatted on the server in the user's timezone; see the solve page's `formatDay`. */
  lastAttemptedLabel: string | null;
}) {
  const { label } = REVISION_MODE_LABELS[sitting.mode];

  return (
    <section
      aria-label={`${label} revision`}
      className="rounded-[var(--radius)] border border-[var(--accent)] bg-[var(--surface-raised)] p-3 text-sm"
    >
      <p className="text-xs font-medium tracking-wide text-[var(--accent)] uppercase">
        {label} revision
      </p>

      {sitting.mode === 'blind' ? (
        <p className="mt-1.5 text-[var(--text-muted)]">
          No notes and no previous code this time. Your earlier attempts come back once you
          finish.
        </p>
      ) : null}

      {sitting.mode === 'speed' ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p>
            Target <span className="font-mono">{formatElapsed(sitting.targetSeconds)}</span>
          </p>
          <SpeedCountdown
            elapsedSeconds={elapsedSeconds}
            paused={paused}
            targetSeconds={sitting.targetSeconds}
          />
          <p className="w-full text-xs text-[var(--text-muted)]">
            The lower of your best time and the estimate. Hit or miss is recorded when you
            finish.
          </p>
        </div>
      ) : null}

      {sitting.mode === 'mistake_first' ? (
        <div className="mt-1.5 flex flex-col gap-2">
          <p className="text-[var(--text-muted)]">
            {lastAttemptedLabel
              ? `Last attempted ${lastAttemptedLabel}.`
              : 'No earlier attempt recorded.'}
          </p>
          {sitting.mistakes.length > 0 ? (
            <div>
              <p className="font-medium">Mistakes you have made on this problem</p>
              <ul className="mt-1 list-disc pl-5">
                {sitting.mistakes.map((mistake) => (
                  <li key={mistake}>{mistake}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p>No mistakes were recorded on your earlier attempts.</p>
          )}
          {sitting.stuckPoints.length > 0 ? (
            <div>
              <p className="font-medium">Where you got stuck last time</p>
              <ul className="mt-1 list-disc pl-5">
                {sitting.stuckPoints.map((point, index) => (
                  <li key={index}>
                    {point.category} at {formatElapsed(point.atSeconds)}
                    {point.note ? ` — “${point.note}”` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {sitting.mode === 'pattern' ? (
        <div className="mt-1.5">
          {sitting.pattern && sitting.related.length > 0 ? (
            <>
              <p>
                Also revise these, which share the{' '}
                <span className="font-medium">{sitting.pattern}</span> pattern:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {sitting.related.map((problem) => (
                  <li key={problem.slug}>
                    <Link
                      className="underline"
                      href={`/problems/${problem.slug}`}
                      prefetch={false}
                    >
                      {problem.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[var(--text-muted)]">
              {sitting.pattern
                ? `No other problems share the ${sitting.pattern} pattern yet.`
                : 'This problem has no pattern tag, so there is no set to revise it with.'}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
