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
 */
import { isFeatureEnabled } from '@/lib/flags';
import { getServerEnv } from '@/server/env';
import { LoginPanel } from './LoginPanel';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : undefined;

  const env = getServerEnv();
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
      <LoginPanel email={email} github={github} phone={phone} returnTo={returnTo} />
    </>
  );
}
