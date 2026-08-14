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
import { PATHNAME_HEADER } from '@/lib/auth/pathname-header';

const SESSION_COOKIES = ['__Secure-traceloop.session', 'traceloop.session'];

const PROTECTED_PREFIXES = [
  '/admin',
  // /onboarding is signed-in-only despite living in the (auth) group.
  '/onboarding',
  '/dashboard',
  '/problems',
  '/sessions',
  '/revision',
  '/settings',
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

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
    return NextResponse.next({ request: { headers } });
  }

  /*
   * `returnTo` carries only the PATH, and it is re-validated server-side by
   * lib/auth/return-to.ts before any redirect uses it. Middleware attaches it;
   * middleware does not get to be trusted about it.
   */
  const login = new URL('/login', request.url);
  login.searchParams.set('returnTo', `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next internals, the auth endpoints themselves (which
  // must stay reachable while signed out) and static assets.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)'],
};
