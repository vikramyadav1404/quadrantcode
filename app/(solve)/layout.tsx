/**
 * The solve route's layout: the same authenticated shell as `(app)`, WITHOUT
 * the layout timer bar.
 *
 * Only `/problems/[slug]/solve` lives in this group. The page draws its own
 * session strip, so the timer bar must not exist here at all: one "Solve
 * session timer", one set of controls, one heartbeat.
 *
 * No `loading.tsx` and no Suspense boundary in this group (D39);
 * `tests/app/no-loading-boundary.test.ts` covers it.
 */
import { AppShell } from '@/app/_shell/AppShell';

export default function SolveLayout({ children }: { children: React.ReactNode }) {
  return <AppShell timerBar={false}>{children}</AppShell>;
}
