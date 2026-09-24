'use client';

/**
 * Today's revisions, highest risk first.
 *
 * Each row carries the sentences that put it where it is — the score alone is a
 * number the user cannot argue with, and an order nobody can argue with is an
 * order nobody trusts.
 *
 * A client component only because the three outcome buttons need to be pressed.
 * Everything it renders arrives as props; it computes nothing.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type DueItemContextView,
  type DueItemView,
  formatDueness,
  formatInterval,
} from '@/lib/revision/view';
import { REVISION_MODES, REVISION_MODE_LABELS, type RevisionMode } from '@/lib/revision/modes';

type Outcome = 'clean' | 'struggled' | 'failed';

const OUTCOMES: { value: Outcome; label: string; hint: string }[] = [
  { value: 'clean', label: 'Got it', hint: 'Solved it without trouble' },
  { value: 'struggled', label: 'Struggled', hint: 'Got there, but it was hard' },
  { value: 'failed', label: 'Lost it', hint: "Couldn't do it this time" },
];

export function DueList({
  items,
  onRecord,
  context,
  onStartMode,
}: {
  items: DueItemView[];
  onRecord: (input: { problemId: string; outcome: Outcome }) => Promise<{
    ok: boolean;
    message?: string;
    nextInDays?: number;
  }>;
  /** F2.2 · present only when revision modes are enabled. */
  context?: Record<string, DueItemContextView>;
  /** F2.2 · present only when revision modes are enabled. */
  onStartMode?: (input: {
    problemId: string;
    mode: RevisionMode;
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const router = useRouter();
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <ol aria-label="Revisions due today" className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
          key={item.problemId}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link className="font-medium underline" href={`/problems/${item.slug}`}>
              {item.title}
            </Link>
            <span className="text-sm text-[var(--text-muted)]">
              {formatDueness(item.daysOverdue)}
            </span>
          </div>

          {/*
            Never the score on its own — but never the same sentence twice
            either. How overdue it is already sits in the line above, and a row
            that reads "9 days overdue · 9 days overdue" makes the reader
            wonder which one is wrong.
          */}
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {item.risk.factors
              .filter((factor) => factor.key !== 'overdue')
              .map((factor) => factor.label)
              .join(' · ')}
          </p>

          {context?.[item.problemId] ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {describeContext(context[item.problemId]!)}
            </p>
          ) : null}

          {onStartMode && !done[item.problemId] ? (
            <div
              aria-label={`Revise ${item.title} in a mode`}
              className="mt-3 flex flex-wrap gap-2"
              role="group"
            >
              {REVISION_MODES.map((mode) => (
                <button
                  aria-disabled={busy === item.problemId}
                  className="rounded-[var(--radius)] border border-[var(--accent)] px-3 py-1 text-sm text-[var(--accent)] aria-disabled:opacity-60"
                  key={mode}
                  onClick={async () => {
                    if (busy) return;
                    setBusy(item.problemId);
                    setError(null);
                    const result = await onStartMode({ problemId: item.problemId, mode });
                    setBusy(null);
                    if (!result.ok) {
                      setError(result.message ?? 'That revision did not start.');
                      return;
                    }
                    router.push(`/problems/${item.slug}/solve`);
                  }}
                  title={REVISION_MODE_LABELS[mode].description}
                  type="button"
                >
                  {REVISION_MODE_LABELS[mode].label}
                </button>
              ))}
            </div>
          ) : null}

          {done[item.problemId] ? (
            <p className="mt-3 text-sm" role="status">
              {done[item.problemId]}
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {OUTCOMES.map((outcome) => (
                <button
                  aria-disabled={busy === item.problemId}
                  className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm aria-disabled:opacity-60"
                  key={outcome.value}
                  onClick={async () => {
                    setBusy(item.problemId);
                    setError(null);

                    const result = await onRecord({
                      problemId: item.problemId,
                      outcome: outcome.value,
                    });

                    setBusy(null);

                    if (!result.ok) {
                      setError(result.message ?? 'That did not save.');
                      return;
                    }

                    /*
                     * The row stays and says what happened, rather than
                     * vanishing. A list that empties as you work it gives no
                     * sense of what you just did, and the next interval is the
                     * most useful thing to know at that moment.
                     */
                    setDone((current) => ({
                      ...current,
                      [item.problemId]:
                        result.nextInDays === undefined
                          ? 'Recorded.'
                          : `Recorded — back ${formatInterval(result.nextInDays)}.`,
                    }));
                  }}
                  title={outcome.hint}
                  type="button"
                >
                  {outcome.label}
                </button>
              ))}
            </div>
          )}
        </li>
      ))}

      {error ? (
        <li className="text-sm text-[var(--danger)]" role="status">
          {error}
        </li>
      ) : null}
    </ol>
  );
}

/** "Last attempted 3 Sep 2026 · stuck · mistakes: off-by-one, wrong data structure" */
function describeContext(context: DueItemContextView): string {
  const parts = [
    context.lastAttempted
      ? `Last attempted ${context.lastAttempted}`
      : 'No finished attempt yet',
  ];
  if (context.lastOutcome)
    parts.push(context.lastOutcome === 'solved' ? 'solved' : 'got stuck');
  parts.push(
    context.mistakes.length > 0
      ? `mistakes: ${context.mistakes.join(', ')}`
      : 'no mistakes recorded',
  );
  return parts.join(' · ');
}
