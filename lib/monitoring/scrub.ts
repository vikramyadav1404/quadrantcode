/**
 * Strips credentials from a Sentry event before it leaves the process.
 *
 * ## Why `sendDefaultPii: false` was not enough
 *
 * Every Sentry init in this app sets `sendDefaultPii: false`, and server events
 * still arrived carrying the raw `__Secure-quadrantcode.session` cookie: found
 * on 2026-11-14 in four issues (QUADRANTCODE-3, -4, -6, -A), each with a
 * 36-character session token beside 52 request headers. The request data comes
 * from Next's `onRequestError` hook (`Sentry.captureRequestError`), which hands
 * Sentry the incoming request as it is, and the PII switch does not reach it.
 * Sentry's own server-side scrubbing filtered passwords and bearer tokens but
 * not that cookie, because its name matches none of its default patterns.
 *
 * A session token is a login. Anyone who could read the issue could have
 * replayed it until the session expired. So this runs as `beforeSend` and
 * `beforeSendTransaction` in all three runtimes, and drops the material rather
 * than masking it.
 *
 * ## What it removes
 *
 *   - every cookie (`request.cookies`) — the app's cookies are sessions and
 *     CSRF tokens; none of them helps debug an error;
 *   - headers that carry credentials (`cookie`, `authorization`, anything
 *     naming a token, secret, signature or key);
 *   - query parameters that carry credentials or an address (`token`, `code`,
 *     `otp`, `email`, …) — the magic-link callback puts both in its URL;
 *   - the same parameters inside breadcrumb URLs.
 */

type Pairs = Array<[string, string]>;

/** Anything shaped like the parts of a Sentry event this touches. */
export type ScrubbableEvent = {
  request?: {
    url?: string;
    cookies?: unknown;
    headers?: Record<string, string> | Pairs;
    query_string?: string | Pairs | Record<string, string>;
    [key: string]: unknown;
  };
  breadcrumbs?: Array<{ data?: Record<string, unknown> | null; [key: string]: unknown }>;
  [key: string]: unknown;
};

const SENSITIVE_HEADER =
  /cookie|authorization|token|secret|signature|api[-_]?key|x-vercel-oidc/i;
const SENSITIVE_PARAM = /token|code|otp|email|secret|password|signature|key|session/i;
const FILTERED = '[Filtered]';

function scrubHeaders(headers: Record<string, string> | Pairs): Record<string, string> | Pairs {
  if (Array.isArray(headers)) {
    return headers.filter(([name]) => !SENSITIVE_HEADER.test(name));
  }
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_HEADER.test(name)),
  );
}

function scrubQueryString(query: string): string {
  if (!query) return query;
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  for (const name of [...params.keys()]) {
    if (SENSITIVE_PARAM.test(name)) params.set(name, FILTERED);
  }
  return params.toString();
}

/** Scrubs the query of a URL, absolute or relative, leaving the rest intact. */
export function scrubUrl(url: string): string {
  const mark = url.indexOf('?');
  if (mark === -1) return url;
  const hash = url.indexOf('#', mark);
  const query = url.slice(mark + 1, hash === -1 ? undefined : hash);
  const tail = hash === -1 ? '' : url.slice(hash);
  return `${url.slice(0, mark)}?${scrubQueryString(query)}${tail}`;
}

/**
 * Typed loosely on purpose: Sentry's `ErrorEvent` and `TransactionEvent` both
 * come through here, and its `RequestEventData` is narrower than the shapes
 * the SDKs actually send (cookies as pairs, headers as pairs). The event is
 * mutated in place and returned, as `beforeSend` expects.
 */
export function scrubSentryEvent<T extends object>(input: T): T {
  const event = input as ScrubbableEvent;
  const request = event.request;
  if (request) {
    delete request.cookies;
    if (request.headers) request.headers = scrubHeaders(request.headers);
    if (typeof request.url === 'string') request.url = scrubUrl(request.url);

    const query = request.query_string;
    if (typeof query === 'string') {
      request.query_string = scrubQueryString(query);
    } else if (Array.isArray(query)) {
      request.query_string = query.map(([name, value]) => [
        name,
        SENSITIVE_PARAM.test(name) ? FILTERED : value,
      ]);
    } else if (query && typeof query === 'object') {
      request.query_string = Object.fromEntries(
        Object.entries(query).map(([name, value]) => [
          name,
          SENSITIVE_PARAM.test(name) ? FILTERED : value,
        ]),
      );
    }
  }

  for (const crumb of event.breadcrumbs ?? []) {
    const url = crumb.data?.url;
    if (crumb.data && typeof url === 'string') crumb.data.url = scrubUrl(url);
  }

  return input;
}
