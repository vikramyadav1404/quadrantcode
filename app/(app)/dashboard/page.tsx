import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';

/** Placeholder dashboard. F1.6 (analytics-core) fills these with real numbers. */
export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your streak, today's goal and what to revise next."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Current streak" value={0} hint="Days in a row" />
        <StatCard label="Solved this week" value={0} />
        <StatCard label="Due for revision" value={0} tone="warning" />
        <StatCard label="Avg solve time" value="—" hint="Active minutes" />
      </div>
    </>
  );
}
