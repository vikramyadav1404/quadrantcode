/**
 * What `/login` should DO for this visitor — decided once, purely.
 *
 * Extracted from the page rather than written inline because this repo has no
 * jsdom and no React testing library: a decision embedded in a server component
 * can only be checked by a browser test, and three of these four branches are
 * cheap to get wrong and slow to notice. Same shape as F0.3's
 * `isProfileComplete` — a pure predicate the page is a thin adapter over.
 *
 * ## The ERROR branch outranks the redirect, deliberately
 *
 * `OAuthAccountNotLinked` is thrown PRECISELY because a valid session for
 * somebody else is already present (`@auth/core` handle-login: the account
 * lookup succeeded and its user is not the session's user). So the signed-in
 * visitor and the visitor who needs to read the error are the SAME person.
 * Redirecting first would send them to /dashboard, discard the error, and loop
 * them back into the confusion it was reporting — turning the fix into the bug.
 *
 * Only a visitor with a valid session and nothing to report is sent on.
 */
import { isDemoUser } from './demo';
import { type ReturnToRole, resolveReturnTo } from './return-to';
import { needsSignOut, signInErrorMessage } from './signin-error';

/** The slice of the session user this decision needs. */
export type LoginGateUser = { email: string; role: ReturnToRole };

export type LoginView =
  /** Valid session, nothing to say: go where they were going. */
  | { kind: 'redirect'; to: string }
  /**
   * Signed in, but the page is shown anyway — the demo notice, a sign-in error,
   * or both. Sign-out is always offered here; it is the only way forward.
   */
  | { kind: 'signed-in'; demo: boolean; error: string | null }
  /** Anonymous: the sign-in form, with a banner when something failed. */
  | { kind: 'form'; error: string | null; offerSignOut: boolean };

/**
 * `appOrigin` is threaded through to `resolveReturnTo`, which is what keeps
 * this from becoming an open redirect: it re-parses the candidate, requires the
 * origin to match, and requires the normalised path to be a known app route.
 * A rejected candidate becomes `/dashboard`, never the caller's string.
 */
export function resolveLoginView(
  user: LoginGateUser | null,
  errorCode: unknown,
  returnTo: unknown,
  appOrigin: string,
): LoginView {
  const error = signInErrorMessage(errorCode);

  if (!user) {
    return { kind: 'form', error, offerSignOut: needsSignOut(errorCode) };
  }

  const demo = isDemoUser(user.email);
  if (error !== null || demo) return { kind: 'signed-in', demo, error };

  return { kind: 'redirect', to: resolveReturnTo(returnTo, appOrigin, user.role) };
}
