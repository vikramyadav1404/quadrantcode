'use client';

/**
 * One provider, and the button that attaches or detaches it.
 *
 * `connectedAt` arrives as an ISO string rather than a Date. A Date crossing
 * the server/client boundary is serialised anyway; taking the string makes the
 * formatting explicit and keeps the rendered value stable, instead of depending
 * on whichever locale the runtime happens to pick.
 */
import { useState, useTransition } from 'react';
import { connectProviderAction, disconnectProviderAction } from './actions';

export function ProviderRow({
  provider,
  title,
  connected,
  connectedAt,
}: {
  provider: string;
  title: string;
  connected: boolean;
  connectedAt: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (provider: string) => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action(provider);
      if (!result.ok) setError(result.message ?? 'That did not work.');
      setConfirming(false);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-[var(--text-muted)]">
          {connected
            ? `Connected${connectedAt ? ` on ${connectedAt.slice(0, 10)}` : ''}`
            : 'Not connected'}
        </p>
        {error ? (
          <p className="mt-1 text-sm text-[var(--danger)]" role="status">
            {error}
          </p>
        ) : null}
      </div>

      {connected ? (
        confirming ? (
          /*
           * A confirm step, not a `window.confirm`. Unlinking is reversible —
           * you can reconnect — so this is a speed bump against a misclick
           * rather than a serious gate, and a native dialog is both unstyleable
           * and awkward for a screen reader mid-list.
           */
          <span className="flex items-center gap-2">
            <button
              className="rounded-[var(--radius)] border border-[var(--danger)] px-3 py-1.5 text-sm text-[var(--danger)] disabled:opacity-60"
              disabled={pending}
              onClick={() => run(disconnectProviderAction)}
              type="button"
            >
              {pending ? 'Removing…' : `Yes, disconnect ${title}`}
            </button>
            <button
              className="text-sm text-[var(--text-muted)] underline"
              onClick={() => setConfirming(false)}
              type="button"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm"
            onClick={() => setConfirming(true)}
            type="button"
          >
            Disconnect
          </button>
        )
      ) : (
        <button
          className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] disabled:opacity-60"
          disabled={pending}
          onClick={() => run(connectProviderAction)}
          type="button"
        >
          {pending ? 'Redirecting…' : `Connect ${title}`}
        </button>
      )}
    </li>
  );
}
