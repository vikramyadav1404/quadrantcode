/**
 * /login — one page for sign-in and sign-up.
 *
 * A magic link makes them the same operation: we do not know, and do not need
 * to know, whether the address has an account until the link is clicked. That
 * is also why the response is identical either way.
 *
 * F0.3b added two more ways in, and both are decided HERE rather than in the
 * browser. `getServerEnv()` reads secrets, so the client cannot be asked
 * whether GitHub is configured — it is told, as a boolean, and never learns the
 * id. The phone tab is gated the same way on `FEATURE_PHONE_OTP`, so a flag
 * that is off means the option is absent rather than present and broken.
 *
 * ## The session gate lives here, not in middleware
 *
 * Middleware is EDGE and has no database connection — see its header, which
 * draws exactly this line: middleware answers "is there a session at all?",
 * Node layers answer questions about WHO. Telling the demo account apart from a
 * real one means reading `users.email`, so middleware could not do it.
 *
 * The stronger reason is that a cookie-presence check up there would redirect
 * anyone holding a STALE cookie away from the one page that can clear it,
 * making this bug worse. `getCurrentUser()` resolves the cookie against the
 * database and returns null for a session that no longer exists, so the gate
 * fires only on a session that is genuinely valid.
 *
 * The branch itself is `resolveLoginView`, kept pure so it can be tested
 * without a browser — same split as F0.3's `isProfileComplete`.
 */
import { redirect } from 'next/navigation';
import { resolveLoginView } from '@/lib/auth/login-gate';
import { isFeatureEnabled } from '@/lib/flags';
import { getServerEnv } from '@/server/env';
import { getCurrentUser } from '@/server/services/auth/session';
import { LoginPanel } from './LoginPanel';
import { signOutAndContinueWithGitHubAction } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : undefined;

  const env = getServerEnv();
  const view = resolveLoginView(
    await getCurrentUser(),
    params.error,
    returnTo,
    env.NEXT_PUBLIC_APP_URL,
  );

  // `resolveLoginView` is what guarantees this target is a known app route on
  // our own origin; it never echoes the caller's string.
  if (view.kind === 'redirect') redirect(view.to);

  /*
   * One button, two placements: the signed-in notice leads with it, and the
   * form shows it above the providers when the failure was one that retrying
   * cannot fix. `bind` rather than an arrow because this is a server component
   * — an inline closure would force the whole page to the client.
   */
  const signOutButton = (
    <form action={signOutAndContinueWithGitHubAction.bind(null, returnTo)}>
      <button className="auth-oauth-button" type="submit">
        Sign out and continue with GitHub
      </button>
    </form>
  );

  const errorNotice = view.error ? (
    <p className="mb-5 text-sm text-[var(--danger)]" role="alert">
      {view.error}
    </p>
  ) : null;

  if (view.kind === 'signed-in') {
    return (
      <>
        <div className="mb-7 text-center">
          <h1 className="text-[1.75rem] leading-tight font-normal tracking-[-0.035em]">
            {view.demo ? "You're signed in as the demo account" : "You're already signed in"}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {view.demo
              ? 'Sign out to continue with your own GitHub account.'
              : 'Sign out to sign in as someone else.'}
          </p>
        </div>

        {errorNotice}
        {signOutButton}
      </>
    );
  }

  // Both halves, because one without the other is a provider Auth.js refuses.
  const github = Boolean(env.GITHUB_ID && env.GITHUB_SECRET);
  const email = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  const phone = Boolean(
    isFeatureEnabled('FEATURE_PHONE_OTP') &&
    ((env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID) ||
      (env.NODE_ENV === 'production' && env.ALLOW_CONSOLE_OTP === '1') ||
      env.NODE_ENV !== 'production'),
  );

  return (
    <>
      <div className="mb-7 text-center">
        <h1 className="text-[1.75rem] leading-tight font-normal tracking-[-0.035em]">
          Continue your practice
          <span className="sr-only"> — Sign in to Quadrantcode</span>
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          Sign in to pick up where you left off.
        </p>
      </div>

      {errorNotice}
      {/*
        No session this server can see, but the browser is still sending a
        cookie — the `auth_sessions` row is gone and only signing out clears it.
      */}
      {view.offerSignOut ? <div className="mb-5">{signOutButton}</div> : null}

      <LoginPanel email={email} github={github} phone={phone} returnTo={returnTo} />
    </>
  );
}
