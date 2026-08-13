import { cn } from '@/lib/utils';

export type StatTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<StatTone, string> = {
  neutral: 'text-[var(--text-primary)]',
  success: 'text-[var(--success)]',
  warning: 'text-[var(--warning)]',
  danger: 'text-[var(--danger)]',
};

/**
 * A single number with a label. Takes its value as a prop — it never queries.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: StatTone;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', TONE_CLASS[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}
