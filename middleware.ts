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

const SESSION_COOKIES = ['__Secure-traceloop.session', 'traceloop.session'];

const PROTECTED_PREFIXES = [
  '/admin',
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
  if (hasSession) return NextResponse.next();

  const signIn = new URL('/sign-in', request.url);
  signIn.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Everything except Next internals, the auth endpoints themselves (which
  // must stay reachable while signed out) and static assets.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)'],
};
