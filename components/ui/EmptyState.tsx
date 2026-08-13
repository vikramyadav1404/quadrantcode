'use client';

/** Shown instead of an empty table or list — never a blank panel. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-[var(--border)] px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--text-muted)]">{description}</p>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
