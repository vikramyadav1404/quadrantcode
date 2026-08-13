/**
 * Authenticated application shell (F0.4).
 *
 * Streak and goal values are placeholders passed as props — F1.3 replaces the
 * constants below with real reads. The shell itself never queries them, which
 * is what lets F1.3 land without touching this file's structure.
 */
import { BottomNav } from '@/components/shell/BottomNav';
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import { ToastProvider } from '@/components/ui/Toast';
import { requireCurrentUser } from '@/server/services/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireCurrentUser();

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
        <TopBar {...shellState} />

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
