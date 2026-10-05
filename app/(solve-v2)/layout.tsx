/**
 * The v2 solve route's layout (C2): the same authenticated shell as `(app)`,
 * WITHOUT the layout timer bar.
 *
 * Only `/problems/[slug]/solve/v2` lives in this group, and middleware rewrites
 * `/problems/[slug]/solve` to it only while FEATURE_SOLVE_V2 is on (see
 * `lib/solve-v2/rewrite.ts`). The page draws its own session strip, so the
 * timer bar must not exist here at all: one "Solve session timer", one set of
 * controls, one heartbeat.
 *
 * No `loading.tsx` and no Suspense boundary in this group either (D39);
 * `tests/app/no-loading-boundary.test.ts` covers it.
 */
import { AppShell } from '@/app/_shell/AppShell';

export default function SolveV2Layout({ children }: { children: React.ReactNode }) {
  return <AppShell timerBar={false}>{children}</AppShell>;
}
