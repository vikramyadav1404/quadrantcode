/**
 * What you keep getting wrong, and which way it is going.
 *
 * A server component — nothing here needs a click. The one interactive thing in
 * this feature is the pre-solve warning's dismiss, which lives with the warning.
 *
 * ## The tone rule
 *
 * Every line is a count and a direction. No praise, no scolding, no advice the
 * user did not ask for. "Off by one — 7 times, last on 4 Aug, less often
 * lately" is something a person can act on; "Great progress on your off-by-one
 * errors!" is something they learn to skip.
 */
import { TREND_LABELS } from '@/lib/mistakes/trends';
import { formatSeen, readableCategory, type PatternView } from '@/lib/mistakes/view';

export function RecurringPanel({ patterns }: { patterns: PatternView[] }) {
  if (patterns.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Nothing has come up more than once yet. Reflections after a solve are what build this.
      </p>
    );
  }

  return (
    <ol aria-label="Your recurring mistakes" className="flex flex-col gap-2">
      {patterns.map((pattern) => (
        <li
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
          key={`${pattern.category}-${pattern.topic ?? 'none'}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">
              {readableCategory(pattern.category)}
              {pattern.topic ? (
                <span className="text-[var(--text-muted)]"> · {pattern.topic}</span>
              ) : null}
            </span>
            <span className="text-sm text-[var(--text-muted)]">
              {pattern.occurrences} {pattern.occurrences === 1 ? 'time' : 'times'} · last on{' '}
              {formatSeen(pattern.lastSeenOn)} · {TREND_LABELS[pattern.trend]}
            </span>
          </div>

          {/*
            The other axis, and only when it says something. F3.3's confirmed
            stuck points are "where the struggle was" — a different question
            from "what went wrong", so they are shown apart rather than added in.
          */}
          {pattern.confirmedStuckCount > 0 ? (
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              You confirmed {pattern.confirmedStuckCount} stuck{' '}
              {pattern.confirmedStuckCount === 1 ? 'point' : 'points'} in this topic.
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
