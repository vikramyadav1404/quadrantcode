/**
 * The v2 history card (step C3): how this problem has gone for you, and when it
 * comes back.
 *
 * A server component: every value arrives preformatted (dates in the user's
 * timezone, durations through `formatElapsed`), so nothing here formats a Date
 * and no client code is added. Built from data the solve screen already loads
 * (the record and the attempt history), plus the one approved read-only
 * function, `getNextRevisionDate`.
 *
 * Not rendered at all in a blind revision sitting: the page skips it, and
 * skips the queries, rather than loading and hiding (the F2.2 rule).
 *
 * Imported only by SolveShellV2 (v2 rule). `data-solve-v2-history` is the
 * marker the flag-off check looks for.
 */
export type HistoryCardData = {
  attempts: number;
  /** `MM:SS`, or null when the problem has never been solved. */
  bestTime: string | null;
  /** In the user's timezone, or null when never attempted. */
  lastAttempted: string | null;
  /** The newest finished attempt's outcome label, or null. */
  lastOutcome: string | null;
  /** The next revision date, formatted; null when nothing is scheduled. */
  nextRevision: string | null;
};

export function HistoryCardV2({ data }: { data: HistoryCardData }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Attempts', value: String(data.attempts) },
  ];
  if (data.lastOutcome) rows.push({ label: 'Last outcome', value: data.lastOutcome });
  if (data.bestTime) rows.push({ label: 'Best time', value: data.bestTime });
  if (data.lastAttempted) rows.push({ label: 'Last attempted', value: data.lastAttempted });
  rows.push({ label: 'Next revision', value: data.nextRevision ?? 'Not scheduled yet' });

  return (
    <section
      aria-label="Your history on this problem"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
      data-solve-v2-history=""
    >
      <h2 className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        History
      </h2>
      {data.attempts === 0 ? (
        <p className="mt-1 text-[var(--text-muted)]">No finished attempts yet.</p>
      ) : null}
      <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
        {rows.map((row) => (
          <div className="flex gap-1.5" key={row.label}>
            <dt className="text-[var(--text-muted)]">{row.label}</dt>
            <dd className="font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
