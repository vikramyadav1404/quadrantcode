/**
 * Auth.js sign-in error codes → one line a person can act on.
 *
 * Auth.js redirects a failed sign-in to `pages.signIn` with `?error=<code>`.
 * `/login` read only `returnTo`, so every one of these failed SILENTLY — which
 * is why OAuthAccountNotLinked needed a trip through the production logs to
 * diagnose rather than being readable on screen.
 *
 * ## The raw parameter is never rendered
 *
 * `?error=` is attacker-controlled: anyone can send someone a link to
 * `/login?error=<anything>`. This module MAPS rather than echoes, so an
 * unrecognised code produces the generic line below and the supplied string
 * never reaches the DOM. React would escape it, but escaping is not the point —
 * arbitrary attacker text rendered as our own copy is the problem, and not
 * rendering it at all is the fix.
 */

/**
 * The codes worth their own remedy. Everything else gets `DEFAULT_MESSAGE`:
 * Auth.js defines a dozen more, and a wall of near-identical lines helps nobody.
 */
export const SIGNIN_ERROR_MESSAGES = {
  OAuthAccountNotLinked:
    'That GitHub account belongs to a different Quadrantcode user. Sign out below, then continue with GitHub again.',
  AccessDenied: 'Sign-in was declined before it completed. Try again to approve access.',
  Configuration:
    'Sign-in is misconfigured on our side. Try another method, or contact support.',
} as const;

export type SignInErrorCode = keyof typeof SIGNIN_ERROR_MESSAGES;

/** Shown for any code not named above, including ones Auth.js adds later. */
export const DEFAULT_SIGNIN_ERROR = 'Something went wrong signing you in. Try again.';

/**
 * A repeated query key arrives as `string[]`, so both shapes are normalised
 * here rather than at each call site.
 */
function normaliseCode(code: unknown): string | null {
  const raw = Array.isArray(code) ? code[0] : code;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** `null` when there is no error to report — not an empty string, which renders. */
export function signInErrorMessage(code: unknown): string | null {
  const raw = normaliseCode(code);
  if (raw === null) return null;

  return SIGNIN_ERROR_MESSAGES[raw as SignInErrorCode] ?? DEFAULT_SIGNIN_ERROR;
}

/**
 * The one failure whose remedy is clearing the session rather than retrying.
 *
 * True even when there is no session this server can see: the cookie can
 * outlive its `auth_sessions` row, and signing out is what clears it.
 */
export function needsSignOut(code: unknown): boolean {
  return normaliseCode(code) === 'OAuthAccountNotLinked';
}
