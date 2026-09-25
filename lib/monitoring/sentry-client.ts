/**
 * The browser's one door to Sentry, loaded by dynamic import (F4.7b, D36).
 *
 * `@sentry/nextjs` in the browser is ~410 KiB. Imported statically — from
 * `instrumentation-client.ts` and the two error boundaries — it was parsed
 * before first paint on every page, and on the landing page it was the whole
 * difference between a mobile Lighthouse score in the 80s and 95+. So nothing
 * in the browser imports it statically any more; everything comes through here.
 *
 * - `loadSentry()` imports and initialises once, however many callers ask.
 * - `captureException()` loads first if it has to, so an error reported before
 *   the SDK arrived is still sent — it is delayed, not dropped.
 *
 * When the SDK is initialised is the caller's choice: immediately inside the
 * app, after idle on public pages. See `instrumentation-client.ts`.
 */
// Type-only: erased at build time, so it adds nothing to the bundle.
import type * as SentryNamespace from '@sentry/nextjs';

type SentryModule = typeof SentryNamespace;

let loading: Promise<SentryModule> | null = null;
let loaded: SentryModule | null = null;

export function loadSentry(): Promise<SentryModule> {
  loading ??= import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
    });
    loaded = Sentry;
    return Sentry;
  });
  return loading;
}

/** The module if it has already loaded, else null. Never triggers a load. */
export function sentryIfLoaded(): SentryModule | null {
  return loaded;
}

export function captureException(
  error: unknown,
  context?: { tags?: Record<string, string> },
): void {
  void loadSentry().then((Sentry) => Sentry.captureException(error, context));
}
