'use client';

/**
 * Confirmation dialog built on <dialog>, so focus trapping, Escape-to-close
 * and inertness of the rest of the page come from the platform rather than
 * from hand-rolled keyboard handling.
 */
import { useEffect, useRef } from 'react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-dialog-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-5 text-[var(--text-primary)] backdrop:bg-black/60"
    >
      <h2 className="text-lg font-semibold" id="confirm-dialog-title">
        {title}
      </h2>
      {description ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">{description}</p>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={
            destructive
              ? 'rounded-[var(--radius)] bg-[var(--danger)] px-3 py-2 text-sm font-medium text-[var(--background)]'
              : 'rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)]'
          }
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
