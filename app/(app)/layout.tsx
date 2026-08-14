/**
 * Authenticated application shell (F0.4).
 *
 * Streak and goal values are placeholders passed as props — F1.3 replaces the
 * constants below with real reads. The shell itself never queries them, which
 * is what lets F1.3 land without touching this file's structure.
 */
import { unauthorized } from 'next/navigation';
import { BottomNav } from '@/components/shell/BottomNav';
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import { ToastProvider } from '@/components/ui/Toast';
import { getCurrentUser } from '@/server/services/auth/session';
import { getDb } from '@/server/db';
import { getProfile } from '@/server/services/profile';

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

  // One read for the whole shell; `getProfile` supplies the initials fallback
  // so the avatar renders identically whether or not an image is set.
  const profile = await getProfile(getDb(), user.id);

  // F1.3 (streak-engine) supplies these; typed mock data until then.
  const shellState = { streakDays: 0, streakAtRisk: false, goalCompleted: 0, goalTarget: 2 };

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
