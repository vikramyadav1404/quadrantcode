/**
 * The request header middleware uses to tell server components which path was
 * actually requested.
 *
 * It lives here rather than in `middleware.ts` so the layout can import the
 * name without importing the middleware module itself — that module pulls in
 * `next/server`, which belongs to the edge runtime, not the app bundle.
 *
 * REQUEST header only. It is set on the inbound request via
 * `NextResponse.next({ request: { headers } })`, so it never reaches the
 * browser and is never something a client can forge on a normal navigation.
 * Consumers re-validate it anyway.
 */
export const PATHNAME_HEADER = 'x-quadrantcode-pathname';
