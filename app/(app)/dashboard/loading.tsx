import { StatGridSkeleton } from '@/components/ui/Skeleton';

/**
 * Skeleton for the dashboard's stat grid.
 *
 * Removed on 2026-10-05 (D39): under Next 15.5 a boundary above the timer bar
 * dropped server-action renders. Restored on 2026-11-05: on Next 16.4.5 the
 * same boundary dropped none in the D39 revisit. `no-loading-boundary.test.ts`
 * allows it only on that version or later.
 */
export default function DashboardLoading() {
  return <StatGridSkeleton />;
}
