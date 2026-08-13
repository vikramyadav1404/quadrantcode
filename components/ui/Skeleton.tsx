import { cn } from '@/lib/utils';

/** Shimmer placeholder. Every list and card shape has one (F0.4 criterion). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-[var(--surface-raised)]', className)}
    />
  );
}

/** Card-shaped skeleton, matching StatCard's box so layout does not jump. */
export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

/** Grid of stat cards, used by every dashboard-shaped loading.tsx. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}
