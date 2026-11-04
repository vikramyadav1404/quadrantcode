/**
 * The v2 "recurring for you" chip (step C4): the mistake the user keeps making
 * on this problem's topics.
 *
 * A server component, and adds no client code. Its data comes from
 * `readPatterns`, which only reads; the pre-solve warning's `warningFor` is
 * never called, because it writes a row each time (the v2 plan's rule).
 *
 * Worded by the tone rule in `components/mistakes/RecurringPanel.tsx`: a count
 * and a direction, no praise, no advice.
 *
 * Not rendered for a signed-out user, with no match, or in a blind revision
 * sitting. In a blind sitting the page skips the query too, rather than
 * loading and hiding (the F2.2 rule).
 *
 * Imported only by SolveShellV2 (v2 rule). `data-solve-v2-recurring` is the
 * marker the flag-off check looks for.
 */
import Link from 'next/link';
import { TREND_LABELS } from '@/lib/mistakes/trends';
import { readableCategory } from '@/lib/mistakes/view';
import type { RecurringChipData } from '@/lib/solve-v2/recurring';

export function RecurringChipV2({ data }: { data: RecurringChipData }) {
  return (
    <section
      aria-label="Recurring for you"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
      data-solve-v2-recurring=""
    >
      <h2 className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        Recurring for you
      </h2>
      <p className="mt-1.5">
        <span className="font-medium">{readableCategory(data.category)}</span>
        <span className="text-[var(--text-muted)]">
          {' '}
          · {data.topic} · {data.occurrences} times · {TREND_LABELS[data.trend]}
        </span>
      </p>
      <Link className="mt-1 inline-block text-xs underline" href="/mistakes">
        All your mistakes
      </Link>
    </section>
  );
}
