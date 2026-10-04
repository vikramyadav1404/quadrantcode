import { PageHeader } from '@/components/ui/PageHeader';
import { TableSkeleton } from '@/components/ui/DataTable';

/**
 * Skeleton for the catalog list.
 *
 * This closes the F0.4 criterion "every list route has a skeleton state",
 * which was recorded DEFERRED because Phase 0 had no list route to attach one
 * to. /problems is the first.
 */
export default function ProblemsLoading() {
  return (
    <>
      <PageHeader title="Problems" description="Loading the catalog…" />
      <TableSkeleton columns={5} rows={8} />
    </>
  );
}
