/**
 * The CSP `connect-src` list: every origin the browser itself is allowed to
 * fetch from.
 *
 * Imported by `next.config.ts` by relative path, so this file must stay free of
 * `@/` aliases and of anything server-only.
 *
 * ## Two origins were missing, and both failed silently
 *
 * **Sentry.** The list allowed `https://*.ingest.sentry.io`. A CSP wildcard
 * covers exactly one leading label run ending in that suffix, and Sentry DSNs
 * issued since 2024 carry a region: `o123.ingest.us.sentry.io` ends in
 * `.us.sentry.io`, not `.ingest.sentry.io`. The production browser DSN is that
 * shape (checked 2026-11-09 in the served bundle), so every browser-side event
 * was refused by the CSP before it left the page. Server-side events were
 * unaffected, which is why "monitoring configured" looked true.
 *
 * **Avatar storage.** `AvatarUploader` PUTs the file straight to a presigned
 * S3/R2 URL. That is a cross-origin `fetch`, so the bucket's endpoint has to be
 * listed too, or the upload is blocked in the browser even with valid keys.
 * The S3 client signs path-style URLs (`forcePathStyle: true`), so the origin
 * of `S3_ENDPOINT` is exactly the origin the browser will hit.
 */
export const SENTRY_INGEST_ORIGINS = [
  'https://*.ingest.sentry.io',
  'https://*.ingest.us.sentry.io',
  'https://*.ingest.de.sentry.io',
] as const;

/** The origin of an https endpoint, or null for anything else. */
export function httpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function connectSrc(env: { S3_ENDPOINT?: string | undefined }): string {
  const storage = httpsOrigin(env.S3_ENDPOINT);
  return ["'self'", ...SENTRY_INGEST_ORIGINS, ...(storage ? [storage] : [])].join(' ');
}
