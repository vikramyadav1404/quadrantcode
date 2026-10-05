/**
 * Edge middleware — AUTHENTICATION only.
 *
 * The split matters and is deliberate:
 *
 *   middleware (edge)  → "is there a session at all?"  → redirect to /sign-in
 *   /admin layout (node) → "is this user an admin?"    → 403
 *
 * Role lives in Postgres and edge middleware has no database connection, so a
 * role check here would need either a JWT claim (which cannot be revoked when
 * an admin is demoted) or a network hop per request. More importantly, the
 * acceptance criterion requires a signed-in non-admin to receive **403, not a
 * redirect** — redirecting an authenticated user to sign-in is exactly the
 * redirect loop the ticket calls out. So middleware never redirects a request
 * that carries a session; it lets it through and the layout answers 403.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { REQUEST_ID_HEADER, resolveRequestId } from '@/server/lib/observability/request-id';
import { PATHNAME_HEADER } from '@/lib/auth/pathname-header';
import { isFeatureEnabled } from '@/lib/flags';
import { solveV2Rewrite } from '@/lib/solve-v2/rewrite';

const SESSION_COOKIES = ['__Secure-quadrantcode.session', 'quadrantcode.session'];

/**
 * Every signed-in-only page prefix.
 *
 * **`/analytics` and `/mistakes` were missing** — added by F1.6 and F3.5, never
 * added here. Neither leaked data: both pages call `requireCurrentUser()`,
 * which throws before any query runs. But an anonymous visitor got a 500 error
 * page instead of a redirect to login, and the first layer of defence was
 * absent on two routes.
 *
 * Found by F4.8's route enumeration, which is exactly the kind of drift a
 * hand-maintained list acquires. `tests/security/routes.test.ts` now compares
 * this array against the routes that exist on disk, so the next omission fails
 * a test rather than waiting for an audit.
 */
const PROTECTED_PREFIXES = [
  '/admin',
  // /onboarding is signed-in-only despite living in the (auth) group.
  '/onboarding',
  '/analytics',
  '/assessments',
  '/companies',
  '/dashboard',
  '/mistakes',
  '/problems',
  '/sessions',
  '/revision',
  '/settings',
  '/tracks',
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  /*
   * F4.6 · every request gets an id, before anything else happens.
   *
   * Here rather than in each route handler for the same reason redaction is in
   * the logger: a rule applied per handler holds until somebody adds a handler.
   * Middleware runs first and runs for everything.
   *
   * An id supplied upstream is honoured so a trace can start before us, and
   * `resolveRequestId` caps and strips it — the value lands in every log line
   * for the request, so an unbounded one is a way to write megabytes into a log
   * file with a single call.
   */
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  /** Attach the id to a response, so a caller can quote it in a bug report. */
  const withId = (response: NextResponse): NextResponse => {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return withId(NextResponse.next({ request: { headers } }));
  }

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) {
    /*
     * Hand the requested path down to the (app) layout.
     *
     * That layout redirects an un-onboarded user to /onboarding, and
     * /onboarding honours `returnTo` — but a Next layout is not given the
     * pathname, so without this header the gate could only ever send everyone
     * to the default destination. A first-time user clicking a magic link to
     * /problems would silently land on /dashboard instead.
     *
     * It is a REQUEST header, so it is not observable by the browser, and the
     * layout re-validates it through lib/auth/return-to.ts regardless — same
     * rule as the returnTo below: middleware attaches, it is not trusted.
     */
    const headers = new Headers(request.headers);
    headers.set(PATHNAME_HEADER, `${pathname}${request.nextUrl.search}`);
    headers.set(REQUEST_ID_HEADER, requestId);

    /*
     * C2 · the v2 solve screen. While FEATURE_SOLVE_V2 is on, /problems/[slug]/solve
     * is served by the internal route /problems/[slug]/solve/v2: a rewrite, so
     * the URL in the browser does not change. Off, `solveV2Rewrite` returns
     * null and this request goes exactly where it always did. Read per request,
     * from the runtime environment (see lib/solve-v2/rewrite.ts for why v2 is
     * its own route).
     */
    const v2 = solveV2Rewrite(pathname, isFeatureEnabled('FEATURE_SOLVE_V2'));
    if (v2) {
      return withId(
        NextResponse.rewrite(new URL(`${v2}${request.nextUrl.search}`, request.url), {
          request: { headers },
        }),
      );
    }

    return withId(NextResponse.next({ request: { headers } }));
  }

  /*
   * `returnTo` carries only the PATH, and it is re-validated server-side by
   * lib/auth/return-to.ts before any redirect uses it. Middleware attaches it;
   * middleware does not get to be trusted about it.
   */
  const login = new URL('/login', request.url);
  login.searchParams.set('returnTo', `${pathname}${request.nextUrl.search}`);
  return withId(NextResponse.redirect(login));
}

export const config = {
  // Everything except Next internals, the auth endpoints themselves (which
  // must stay reachable while signed out) and static assets.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)'],
};
