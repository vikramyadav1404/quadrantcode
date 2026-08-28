/**
 * What you keep getting wrong, and what to do about it this week.
 *
 * The aggregate runs on read — there is no queue (D17), it is a handful of
 * grouped queries over data this page loads anyway, and `rebuildPatterns`
 * deletes and rewrites so running it on every visit cannot double anything.
 */
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { RecurringPanel } from '@/components/mistakes/RecurringPanel';
import { WeeklyPlan } from '@/components/mistakes/WeeklyPlan';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { buildWeeklyPlan, rebuildPatterns } from '@/server/services/mistakes';
import type { PatternView } from '@/lib/mistakes/view';

export default async function MistakesPage() {
  const user = await requireCurrentUser();
  const now = new Date();

  const rows = await rebuildPatterns(getDb(), { userId: user.id, now });

  const patterns: PatternView[] = rows.map((row) => ({
    category: row.category,
    topic: row.topic,
    occurrences: row.occurrences,
    confirmedStuckCount: row.confirmedStuckCount,
    trend: row.trend,
    lastSeenOn: row.lastSeenOn,
  }));

  const plan = buildWeeklyPlan(rows, now);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Built from your own reflections and the stuck points you confirmed."
        title="Mistakes"
      />

      <section>
        <h2 className="mb-2 text-sm font-medium">This week</h2>
        <WeeklyPlan note={plan.note} recommendations={plan.recommendations} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Recurring</h2>
        <RecurringPanel patterns={patterns} />
      </section>

      <p className="text-sm">
        <Link className="underline" href="/mistakes/report">
          Monthly report
        </Link>
      </p>
    </div>
  );
}
