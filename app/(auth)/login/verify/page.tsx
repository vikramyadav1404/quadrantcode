/**
 * /login/verify — the four link states, each with its own remedy.
 *
 * A valid link is forwarded to Auth.js's callback, which performs the actual
 * single-use redemption. This page never consumes a token; splitting redemption
 * across two code paths is how single-use guarantees rot.
 */
import { redirect } from 'next/navigation';
import { validateReturnTo } from '@/lib/auth/return-to';
import { getDb } from '@/server/db';
import { getAuthSecret, getServerEnv } from '@/server/env';
import { inspectMagicLink } from '@/server/services/auth/verify-link';
import { ResendPanel } from './ResendPanel';

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  const email = typeof params.email === 'string' ? params.email : '';
  const callbackUrl = typeof params.callbackUrl === 'string' ? params.callbackUrl : undefined;

  const env = getServerEnv();

  if (!token || !email) {
    return (
      <VerifyState
        title="That link isn't complete"
        body="Some email clients cut long links in half. Copy the whole link from the email, or request a new one."
        email=""
      />
    );
  }

  const { state } = await inspectMagicLink(getDb(), {
    token,
    identifier: email,
    secret: getAuthSecret(env),
  });

  if (state === 'valid') {
    // Hand off to Auth.js, which consumes the token atomically and sets the
    // session cookie. returnTo is re-validated here rather than trusted.
    const safeReturnTo = validateReturnTo(callbackUrl, env.NEXT_PUBLIC_APP_URL) ?? '/dashboard';
    const target = new URL('/api/auth/callback/resend', env.NEXT_PUBLIC_APP_URL);
    target.searchParams.set('token', token);
    target.searchParams.set('email', email);
    target.searchParams.set('callbackUrl', safeReturnTo);
    redirect(target.toString());
  }

  if (state === 'expired') {
    return (
      <VerifyState
        title="This link has expired"
        body="Sign-in links last 15 minutes, so a link left in an inbox stops working. Send yourself a fresh one."
        email={email}
      />
    );
  }

  if (state === 'used') {
    return (
      <VerifyState
        title="This link has already been used"
        body="Each sign-in link works once. If you're already signed in on another tab you're all set — otherwise request a new link. If this wasn't you, request a link and sign in to review your account."
        email={email}
      />
    );
  }

  return (
    <VerifyState
      title="This link isn't valid"
      body="It may have been copied incompletely, or it may be old enough that we no longer have a record of it. Requesting a new one will work."
      email={email}
    />
  );
}

function VerifyState({ title, body, email }: { title: string; body: string; email: string }) {
  return (
    <section>
      <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-[var(--surface)] text-[var(--warning)]">
        <svg aria-hidden="true" fill="none" height="23" viewBox="0 0 24 24" width="23">
          <path
            d="M12 8v5M12 16.5v.1"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <path
            d="M10.3 4.3 3.2 17a2 2 0 0 0 1.75 3h14.1a2 2 0 0 0 1.75-3L13.7 4.3a1.95 1.95 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{title}</h1>
      <p className="mt-2 mb-7 text-sm leading-6 text-[var(--text-muted)]">{body}</p>
      <ResendPanel email={email} />
    </section>
  );
}
