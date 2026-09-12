/**
 * Where solving stalls, by category.
 *
 * Two counts per row, kept apart: a marker dropped DURING a session is what the
 * user felt at the time, and a category ticked afterwards is what they
 * concluded. Merging them would lose the difference between noticing a problem
 * and remembering it — and F3.3 will add a third kind, inferred, which must not
 * be able to hide inside either.
 */
import { STUCK_CATEGORY_LABELS, isStuckCategory } from '@/lib/reflection/taxonomy';
import type { StuckDistributionRow } from '@/lib/analytics/view';

export function StuckDistribution({ rows }: { rows: StuckDistributionRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Nothing recorded yet. Mark where you are stuck during a session, or say so in a
        reflection, and it appears here.
      </p>
    );
  }

  const peak = Math.max(...rows.map((row) => row.marked + row.reflected));

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const total = row.marked + row.reflected;
        const label = isStuckCategory(row.category)
          ? STUCK_CATEGORY_LABELS[row.category]
          : row.category;

        return (
          <li className="text-sm" key={row.category}>
            <div className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="tabular-nums text-[var(--text-muted)]">
                {row.marked} marked · {row.reflected} in reflections
              </span>
            </div>

            <div
              aria-hidden="true"
              className="mt-1 h-2 rounded-full bg-[var(--surface-raised)]"
            >
              <div
                className="h-2 rounded-full bg-[var(--accent)]"
                style={{ width: `${(total / peak) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
