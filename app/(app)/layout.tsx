/**
 * Authenticated application shell (F0.4).
 *
 * Streak and goal values still arrive as props. The layout reads them once,
 * through `summariseForShell` (F1.3), and the shell components query nothing —
 * which is what let the real numbers land without changing their shape.
 */
import { headers } from 'next/headers';
import { redirect, unauthorized } from 'next/navigation';
import { PATHNAME_HEADER } from '@/lib/auth/pathname-header';
import { validateReturnTo } from '@/lib/auth/return-to';
import { getServerEnv } from '@/server/env';
import { BottomNav } from '@/components/shell/BottomNav';
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import { ToastProvider } from '@/components/ui/Toast';
import { getCurrentUser } from '@/server/services/auth/session';
import { getDb } from '@/server/db';
import { getProfile, isProfileComplete } from '@/server/services/profile';
import { localDateFor, summariseForShell } from '@/server/services/streak';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  /*
   * `unauthorized()` rather than a thrown AuthenticationError.
   *
   * Middleware only checks that a session COOKIE exists, not that it is valid.
   * A stale or revoked cookie therefore reaches this layout, where a thrown
   * error became an uncaught 500 — every user with an expired session got
   * "Something went wrong" instead of a sign-in prompt. Found by
   * scripts/verify-admin-403.ts hitting the route with a bad cookie.
   */
  const user = await getCurrentUser();
  if (!user) unauthorized();

  const db = getDb();

  // One read for the whole shell; `getProfile` supplies the initials fallback
  // so the avatar renders identically whether or not an image is set.
  const profile = await getProfile(db, user.id);

  /*
   * Onboarding is unskippable on first sign-in.
   *
   * `isProfileComplete` is the SAME predicate /onboarding uses to decide it has
   * already been done — via its `hasCompletedProfile` wrapper — so the two
   * cannot disagree and produce a redirect loop. Evaluated on the profile
   * already loaded above, so it costs no extra query.
   *
   * The destination the user actually asked for is carried forward, so that
   * finishing onboarding lands them where they were going rather than always
   * on the default. It is re-validated here through the same allowlist any
   * other returnTo goes through — the header is set by our own middleware, but
   * "we set it" is not a reason to skip validation.
   */
  if (!isProfileComplete(profile)) {
    const requested = (await headers()).get(PATHNAME_HEADER);
    const intended = validateReturnTo(requested, getServerEnv().NEXT_PUBLIC_APP_URL);
    redirect(intended ? `/onboarding?returnTo=${encodeURIComponent(intended)}` : '/onboarding');
  }

  /*
   * The badge and the ring, resolved in the USER's timezone — the server's zone
   * appears nowhere, which is the whole point of `day.ts`. Read after the
   * onboarding gate above, so it never runs for a user who has not yet
   * confirmed one.
   */
  const shellState = await summariseForShell(
    db,
    user.id,
    localDateFor(new Date(), user.timezone),
  );

  return (
    <ToastProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-[var(--surface-raised)] focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>

      <div className="flex min-h-dvh flex-col">
        <TopBar
          {...shellState}
          avatarAppearance={profile.appearance}
          avatarUrl={profile.avatarUrl}
        />

        <div className="flex flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 px-4 pt-6 pb-20 md:px-6 md:pb-6" id="main">
            {children}
          </main>
        </div>

        <BottomNav />
      </div>
    </ToastProvider>
  );
}
