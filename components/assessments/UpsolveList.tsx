/**
 * F4.5 · problems an assessment left unsolved, until they are solved.
 *
 * Presentational: the list arrives from `getUpsolveQueue`, which derives it
 * from finished attempts and later solves. Each item links to the problem's
 * solve page; solving it there is what takes it off the list.
 */
import Link from 'next/link';
import type { UpsolveItemView } from '@/lib/assessments/upsolve-view';

export function UpsolveList({
  items,
  heading,
  showPaper = true,
}: {
  items: UpsolveItemView[];
  heading: string;
  /** Off on an attempt's own report, where the paper is already the page. */
  showPaper?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label={heading}
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-medium">{heading}</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Left unsolved in an assessment. Each one leaves this list once you solve it.
      </p>
      <ol className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <li
            className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
            key={item.problemId}
          >
            <Link className="font-medium underline" href={`/problems/${item.slug}/solve`}>
              {item.title}
            </Link>
            <span className="text-[var(--text-muted)]">
              {item.difficulty}
              {item.attempted ? ' · attempted' : ' · not opened'}
              {showPaper ? ` · ${item.paperTitle}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
