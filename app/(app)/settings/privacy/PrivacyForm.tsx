'use client';

/**
 * The two controls: stop recording, and erase what was recorded.
 *
 * They are deliberately separate. Turning capture off does not delete anything
 * already saved, and deleting does not turn capture off — conflating them would
 * mean a user who wants to keep their history but stop adding to it has no way
 * to say so.
 *
 * The confirmation stays on screen after the delete. Nothing revalidates, for
 * the reason F2.1 recorded (D23): re-rendering would erase the one message that
 * tells the user what actually went.
 */
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Result = { ok: boolean; message: string };

export function PrivacyForm({
  enabled,
  onToggle,
  onDelete,
}: {
  enabled: boolean;
  onToggle: (input: { enabled: boolean }) => Promise<Result>;
  onDelete: () => Promise<Result>;
}) {
  const [capture, setCapture] = useState(enabled);
  const [status, setStatus] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    // Optimistic, then corrected — the switch should not lag behind the click.
    setCapture(next);

    const result = await onToggle({ enabled: next });
    if (!result.ok) setCapture(!next);

    setStatus(result.message);
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    setConfirming(false);

    const result = await onDelete();
    setDeleted(result.message);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">Code capture</h2>

        <label className="flex items-start gap-3 text-sm">
          <input
            checked={capture}
            className="mt-0.5"
            disabled={busy}
            onChange={(event) => void toggle(event.target.checked)}
            type="checkbox"
          />
          <span>
            Save snapshots of my code during a session
            <span className="block text-[var(--text-muted)]">
              Turning this off stops new snapshots. Code already saved stays until you delete it
              below.
            </span>
          </span>
        </label>

        {status ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]" role="status">
            {status}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Delete my solve history</h2>
        <p className="mb-2 text-sm text-[var(--text-muted)]">
          Erases every code snapshot and every timeline entry, for every session.{' '}
          <strong>This cannot be undone.</strong> Your sessions, streak, analytics and revision
          schedule are not affected — only the record of how each sitting went.
        </p>

        <button
          className="rounded-[var(--radius)] border border-[var(--danger)] px-3 py-1.5 text-sm font-medium text-[var(--danger)] disabled:opacity-60"
          disabled={busy}
          onClick={() => setConfirming(true)}
          type="button"
        >
          Delete my solve history
        </button>

        {deleted ? (
          <p className="mt-2 text-sm" data-testid="delete-result" role="status">
            {deleted}
          </p>
        ) : null}
      </section>

      <ConfirmDialog
        confirmLabel="Delete permanently"
        description="Every code snapshot and timeline entry will be erased. This cannot be undone."
        onCancel={() => setConfirming(false)}
        // Irreversible, and the dialog should look it.
        destructive
        onConfirm={remove}
        open={confirming}
        title="Delete your solve history?"
      />
    </div>
  );
}
