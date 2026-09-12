/**
 * The request id, in the one form the Edge runtime can load.
 *
 * ## Why this is a separate file from `trace.ts`
 *
 * Middleware runs on the Edge runtime, which has no `node:async_hooks` and no
 * `node:crypto`. Importing `trace.ts` there fails the BUILD — not at runtime,
 * which is the good news: `UnhandledSchemeError: Reading from "node:crypto" is
 * not handled`. And it fails because of the whole module, not the one function
 * used, since the bundler pulls in everything the file imports.
 *
 * So the two pieces that middleware needs live here, using the global Web
 * Crypto that both runtimes have, and `trace.ts` imports them back. Nothing in
 * this file may import from `node:`.
 */

/** The header a proxy or a client may supply, so a trace can start upstream. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Take the incoming id, or make one.
 *
 * Bounded and stripped: an id from a header is user input, and it ends up in
 * every log line for that request. An unbounded one is a way to write megabytes
 * into a log file with a single request.
 */
export function resolveRequestId(headerValue: string | null | undefined): string {
  if (!headerValue) return crypto.randomUUID();

  const cleaned = headerValue.replace(/[^\w-]/g, '').slice(0, 64);
  return cleaned.length >= 8 ? cleaned : crypto.randomUUID();
}
