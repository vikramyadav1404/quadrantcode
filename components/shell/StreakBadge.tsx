/**
 * Streak badge. Takes its value as a PROP — F0.4 explicitly forbids querying
 * here; F1.3 supplies the number.
 */
export function StreakBadge({ days, atRisk = false }: { days: number; atRisk?: boolean }) {
  const label =
    days === 0 ? 'No streak yet' : `${days} day streak${atRisk ? ', at risk today' : ''}`;

  return (
    <span
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums ${
        atRisk
          ? 'border-[var(--warning)] text-[var(--warning)]'
          : 'border-[var(--border)] text-[var(--text-primary)]'
      }`}
    >
      <span aria-hidden="true">▲</span>
      {days}
    </span>
  );
}
