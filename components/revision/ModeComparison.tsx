/**
 * F2.2 · which mode is working, stated with its sample size or not at all.
 *
 * Below the minimum this renders "not enough data" and the count — never a
 * percentage. Above it, every rate sits beside the number it came from.
 */
import { REVISION_MODE_LABELS, type ModeComparisonView } from '@/lib/revision/modes';

export function ModeComparison({ comparison }: { comparison: ModeComparisonView }) {
  return (
    <section
      aria-label="Revision mode comparison"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
    >
      {/*
        Not "Which revision mode…": the page's own heading is "Revision", and a
        second heading containing the word made F2.1's heading lookup ambiguous.
      */}
      <h2 className="font-medium">Which mode is working for you</h2>

      {!comparison.enough ? (
        <p className="mt-1 text-[var(--text-muted)]">
          Not enough data yet — {comparison.measured} of {comparison.minimum} measured
          revisions. A revision is measured once you attempt the same problem again afterwards.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[var(--text-muted)]">
            Retained means the next attempt after the revision was solved. Based on{' '}
            {comparison.measured} measured revisions.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {comparison.modes.map((stat) => (
              <li className="flex justify-between gap-3" key={stat.mode}>
                <span>
                  {REVISION_MODE_LABELS[stat.mode].label}
                  {comparison.best === stat.mode ? (
                    <span className="ml-2 text-xs text-[var(--accent)]">best so far</span>
                  ) : null}
                </span>
                <span className="font-mono tabular-nums">
                  {stat.measured === 0
                    ? 'not tried'
                    : `${Math.round((stat.retained / stat.measured) * 100)}% of ${stat.measured}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
