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
import { type DueItemView, formatDueness, formatInterval } from '@/lib/revision/view';

type Outcome = 'clean' | 'struggled' | 'failed';

const OUTCOMES: { value: Outcome; label: string; hint: string }[] = [
  { value: 'clean', label: 'Got it', hint: 'Solved it without trouble' },
  { value: 'struggled', label: 'Struggled', hint: 'Got there, but it was hard' },
  { value: 'failed', label: 'Lost it', hint: "Couldn't do it this time" },
];

export function DueList({
  items,
  onRecord,
}: {
  items: DueItemView[];
  onRecord: (input: { problemId: string; outcome: Outcome }) => Promise<{
    ok: boolean;
    message?: string;
    nextInDays?: number;
  }>;
}) {
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
