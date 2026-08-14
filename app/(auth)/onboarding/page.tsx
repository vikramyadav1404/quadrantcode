/**
 * /onboarding — shown once, after first sign-in, before the dashboard.
 *
 * "Already completed" is decided by `hasCompletedProfile`, which is a wrapper
 * over the same `isProfileComplete` predicate the authenticated layout uses.
 * One rule, two call sites, no second check to drift.
 */
import { redirect } from 'next/navigation';
import { getDb } from '@/server/db';
import { getProfile, hasCompletedProfile } from '@/server/services/profile';
import { getCurrentUser } from '@/server/services/auth/session';
import { OnboardingForm } from './OnboardingForm';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * /onboarding lives in the signed-out (auth) group, which has no layout
   * guard — so it needs its own. `requireCurrentUser()` was wrong here: it
   * throws AuthenticationError, which surfaces as a 500 rather than sending an
   * anonymous visitor anywhere useful. Found by navigating to the URL directly
   * rather than arriving through the flow.
   */
  const user = await getCurrentUser();
  if (!user) redirect('/login?returnTo=%2Fonboarding');

  const params = await searchParams;

  // Unreachable a second time. Not a redirect loop: the (app) layout only
  // sends users HERE when this returns false.
  if (await hasCompletedProfile(getDb(), user.id)) redirect('/dashboard');

  const profile = await getProfile(getDb(), user.id);
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to TraceLoop</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--text-muted)]">
        Three things and you&apos;re in. You can change all of them later.
      </p>
      <OnboardingForm
        defaultTimezone={profile.timezone}
        returnTo={returnTo}
        suggestedName={profile.email.split('@')[0] ?? ''}
      />
    </>
  );
}
