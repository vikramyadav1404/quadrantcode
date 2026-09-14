'use client';

/**
 * "I'm stuck" — in the timer bar, available for as long as the session is live.
 *
 * The dialog asks for a category and, optionally, a sentence. It does **not**
 * ask how long they have been stuck: that number is the session's own elapsed
 * time, which the server already knows and the client is not trusted to report
 * (D20).
 *
 * Built on `<dialog>` for the same reason `ConfirmDialog` is: focus trapping,
 * Escape-to-close and inertness of the rest of the page come from the platform
 * rather than from keyboard handling nobody will maintain.
 */
import { useEffect, useRef, useState } from 'react';
import {
  STUCK_CATEGORIES,
  STUCK_CATEGORY_LABELS,
  type StuckCategory,
} from '@/lib/reflection/taxonomy';

export function StuckButton({
  sessionId,
  onMark,
}: {
  sessionId: string;
  onMark: (input: {
    sessionId: string;
    category: StuckCategory;
    note?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<StuckCategory>('approach');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);

    const result = await onMark({
      sessionId,
      category,
      ...(note.trim() ? { note: note.trim() } : {}),
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.message ?? 'That did not save.');
      return;
    }

    // Reset for the next one: the ticket allows several per session, and
    // leaving the last note in the box invites it being submitted twice.
    setNote('');
    setOpen(false);
    setMarked(true);
  };

  return (
    <>
      <button
        // Matches `outlineButton` in TimerBar: this is a non-terminal action
        // like Pause, and it must not read as heavier than the one that ends
        // the session two buttons along.
        className="rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors hover:border-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        onClick={() => {
          setMarked(false);
          setOpen(true);
        }}
        type="button"
      >
        I&apos;m stuck
      </button>

      {/*
        Confirmation lives outside the dialog because the dialog closes on
        success — a message inside it would disappear with it.
      */}
      {marked ? (
        <span className="text-xs text-[var(--text-muted)]" role="status">
          Marked.
        </span>
      ) : null}

      <dialog
        aria-label="Mark where you are stuck"
        className="m-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-[var(--text-primary)] backdrop:bg-black/60"
        onClose={() => setOpen(false)}
        ref={dialog}
      >
        <form
          className="flex w-72 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 className="text-sm font-semibold">Where are you stuck?</h2>

          <div>
            <label className="mb-1 block text-xs" htmlFor="stuck-category">
              Category
            </label>
            <select
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              id="stuck-category"
              onChange={(event) => setCategory(event.target.value as StuckCategory)}
              value={category}
            >
              {STUCK_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {STUCK_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs" htmlFor="stuck-note">
              Note <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <textarea
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              id="stuck-note"
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              value={note}
            />
          </div>

          {error ? (
            <p className="text-xs text-[var(--danger)]" role="status">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-xs"
              onClick={() => setOpen(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-disabled={busy}
              className="rounded-[var(--radius)] bg-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--accent-foreground)] aria-disabled:opacity-60"
              type="submit"
            >
              {busy ? 'Saving…' : 'Mark it'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
