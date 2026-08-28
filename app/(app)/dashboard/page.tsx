/**
 * The landing screen: the three numbers worth knowing before you start.
 *
 * Reads the same rollup the analytics page does (F1.6), so it costs the same
 * three cheap queries and can never disagree with the fuller view — two
 * independent reads of "solved this week" is exactly how two screens start
 * showing different numbers.
 *
 * "Due for revision" is deliberately absent rather than shown as zero. F2.1
 * owns the revision queue and there is nothing to count yet; a `0` would be a
 * claim that nothing is due, which is a different statement from "this does not
 * exist yet".
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { formatAsOf, formatDuration } from '@/lib/analytics/view';
import { getDb } from '@/server/db';
import { ensureFreshRollup, readDashboard } from '@/server/services/analytics';
import { requireCurrentUser } from '@/server/services/auth/session';
import { localDateFor } from '@/server/services/streak';

export const metadata: Metadata = { title: 'Dashboard · TraceLoop' };

export default async function DashboardPage() {
  const user = await requireCurrentUser();
  const db = getDb();

  const now = new Date();
  const today = localDateFor(now, user.timezone);

  const status = await ensureFreshRollup(db, { userId: user.id, today, now });
  const data = await readDashboard(db, {
    userId: user.id,
    today,
    asOf: status.asOf,
    catchingUp: status.catchingUp,
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your streak, this week's solving, and where to look next."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          hint="Days in a row"
          label="Current streak"
          value={data.headline.currentStreak}
        />
        <StatCard label="Solved this week" value={data.headline.solvedThisWeek} />
        <StatCard label="Solved in total" value={data.headline.totalSolved} />
        <StatCard
          hint="Active time per session"
          label="Average session"
          value={formatDuration(data.headline.averageActiveSeconds)}
        />
      </div>

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Figures {formatAsOf(data.asOf, now)}
        {data.catchingUp ? ' · still catching up on older days' : ''} ·{' '}
        <Link className="underline" href="/analytics">
          See the full breakdown
        </Link>
      </p>

      {data.weakTopics.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Worth attention next</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {data.weakTopics.slice(0, 3).map((topic) => (
              <li key={topic.topic}>
                <span className="font-medium">{topic.topic}</span>
                <span className="text-[var(--text-muted)]"> — {topic.reasons[0]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
