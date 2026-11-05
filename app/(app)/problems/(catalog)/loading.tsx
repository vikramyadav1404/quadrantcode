import { PageHeader } from '@/components/ui/PageHeader';
import { TableSkeleton } from '@/components/ui/DataTable';

/**
 * Skeleton for the catalog list.
 *
 * This closes the F0.4 criterion "every list route has a skeleton state",
 * which was recorded DEFERRED because Phase 0 had no list route to attach one
 * to. /problems is the first.
 *
 * Removed on 2026-10-05 (D39) and restored on 2026-11-05, once Next 16.4.5
 * was shown not to drop server-action renders under a boundary. It stays in
 * the `(catalog)` group, so it wraps the list only, not `/problems/[slug]`.
 */
export default function ProblemsLoading() {
  return (
    <>
      <PageHeader title="Problems" description="Loading the catalog…" />
      <TableSkeleton columns={5} rows={8} />
    </>
  );
}
