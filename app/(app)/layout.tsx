/**
 * Authenticated application shell (F0.4), with the timer bar.
 *
 * The shell itself lives in `app/_shell/AppShell.tsx` (moved unchanged in C2)
 * so the v2 solve route can use the same shell without the layout timer bar.
 * Every page under `(app)` renders exactly what it did before.
 */
import { AppShell } from '@/app/_shell/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell timerBar>{children}</AppShell>;
}
