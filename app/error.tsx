'use client';

/**
 * Typed root error boundary.
 *
 * Reports to Sentry when F4.6 wires it; until then it logs structurally and
 * shows the digest, which is the id that appears in server logs — so a user
 * can quote it in a bug report instead of "it broke".
 */
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'app' } });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-[var(--text-muted)]">
        This has been logged. Try again — if it keeps happening, quote reference{' '}
        <code className="rounded bg-[var(--surface)] px-1">{error.digest ?? 'n/a'}</code>.
      </p>
      <button
        type="button"
        onClick={reset}
        className="self-start rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)]"
      >
        Try again
      </button>
    </main>
  );
}
