/**
 * The attempt timeline, and the "your last attempt" panel above it.
 *
 * A server component: nothing here is interactive, and the data is already on
 * the server that renders the page.
 *
 * ## What is not on it
 *
 * The ticket lists "hints used" as a column. Nothing in the target build
 * produces a hint — F3.4 `ai-gateway` is cut — so the column would be empty for
 * every row forever. An always-blank column is not a feature, it is a promise
 * the product cannot keep, so it is recorded as DEFERRED in the acceptance
 * status instead of rendered.
 */
import { type AttemptView, OUTCOME_LABELS } from '@/lib/reflection/attempt-view';
import { MISTAKE_CATEGORY_LABELS, STUCK_CATEGORY_LABELS } from '@/lib/reflection/taxonomy';
import { formatElapsed } from '@/lib/session/timer-bar-state';
import { formatDay } from '@/lib/time/format-day';

export function LastAttemptPanel({ attempt }: { attempt: AttemptView }) {
  return (
    <section className="mb-8 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-3 text-base font-semibold">Your last attempt</h2>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[var(--text-muted)]">Outcome</dt>
          <dd>{OUTCOME_LABELS[attempt.outcome]}</dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Active time</dt>
          <dd className="font-mono tabular-nums">
            {formatElapsed(attempt.activeDurationSeconds)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Confidence</dt>
          <dd>{attempt.confidence ?? '—'}</dd>
        </div>
      </dl>

      {attempt.approach ? (
        <p className="mt-3 text-sm">
          <span className="text-[var(--text-muted)]">Approach: </span>
          {attempt.approach}
        </p>
      ) : null}

      {attempt.mistakes.length > 0 ? (
        <p className="mt-2 text-sm">
          <span className="text-[var(--text-muted)]">Watch out for: </span>
          {attempt.mistakes.map((mistake) => MISTAKE_CATEGORY_LABELS[mistake]).join(', ')}
        </p>
      ) : null}

      {/*
        Only shown when the reflection was skipped, and only as an offer. The
        session is finished and counted either way — nothing here is a warning.
      */}
      {!attempt.hasReflection && attempt.outcome !== 'abandoned' ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          You skipped the reflection for this one.{' '}
          <a className="underline" href={`/sessions/${attempt.sessionId}/reflect`}>
            Add it now
          </a>
          .
        </p>
      ) : null}
    </section>
  );
}

export function AttemptHistory({
  attempts,
  timeZone,
}: {
  attempts: AttemptView[];
  /**
   * The reader's stored timezone. Each attempt's date is formatted in it, so the
   * list agrees with the streak calendar and with "Last attempted" — a bare
   * `toLocaleDateString()` used the server's zone and could be a day off.
   */
  timeZone: string;
}) {
  if (attempts.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        You haven&apos;t finished a session on this problem yet.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {attempts.map((attempt) => (
        <li
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
          key={attempt.sessionId}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium">
              {attempt.attemptNumber === null
                ? 'Abandoned sitting'
                : `Attempt ${attempt.attemptNumber}`}
            </span>
            <span className="text-[var(--text-muted)]">
              {formatDay(attempt.startedAt, timeZone)}
            </span>
            <span className="font-mono tabular-nums">
              {formatElapsed(attempt.activeDurationSeconds)}
            </span>
            <span>{OUTCOME_LABELS[attempt.outcome]}</span>
            {attempt.confidence ? (
              <span className="text-[var(--text-muted)]">confidence: {attempt.confidence}</span>
            ) : null}
          </div>

          {attempt.stuckMarkers.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-[var(--text-muted)]">
              {attempt.stuckMarkers.map((marker, index) => (
                <li key={`${attempt.sessionId}-${index}`}>
                  <span className="font-mono tabular-nums">
                    {formatElapsed(marker.elapsedSeconds)}
                  </span>{' '}
                  stuck on {STUCK_CATEGORY_LABELS[marker.category]}
                  {marker.note ? ` — ${marker.note}` : ''}
                </li>
              ))}
            </ul>
          ) : null}

          {attempt.mistakes.length > 0 ? (
            <p className="mt-2 text-[var(--text-muted)]">
              {attempt.mistakes.map((mistake) => MISTAKE_CATEGORY_LABELS[mistake]).join(', ')}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
