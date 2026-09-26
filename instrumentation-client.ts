/**
 * Browser-side Sentry, loaded through `lib/monitoring/sentry-client.ts`.
 *
 * Inside the app it starts loading at once, as before. On the PUBLIC pages —
 * the landing page and `/u/*` — it waits for the browser to go idle, so the
 * ~410 KiB SDK is not parsed before first paint for a visitor who has not
 * signed in (F4.7b, D36). The trade: an error in a public page's first moments
 * is reported once the SDK arrives rather than instantly; the error boundaries
 * still load it on demand, so nothing they catch is dropped.
 */
import type { captureRouterTransitionStart } from '@sentry/nextjs';
import { loadSentry, sentryIfLoaded } from '@/lib/monitoring/sentry-client';

const PUBLIC_PATHS = [/^\/$/, /^\/u\//];

if (typeof window !== 'undefined') {
  const isPublic = PUBLIC_PATHS.some((pattern) => pattern.test(window.location.pathname));
  if (isPublic) {
    const whenIdle =
      window.requestIdleCallback ??
      ((callback: () => void) => window.setTimeout(callback, 2_000));
    whenIdle(() => void loadSentry(), { timeout: 5_000 });
  } else {
    void loadSentry();
  }
}

/** Forwarded once the SDK is loaded; a transition before then is not traced. */
export function onRouterTransitionStart(
  ...args: Parameters<typeof captureRouterTransitionStart>
): void {
  sentryIfLoaded()?.captureRouterTransitionStart(...args);
}
