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
import { Heatmap } from '@/components/heatmap/Heatmap';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkPending } from '@/components/ui/LinkPending';
import { StatCard } from '@/components/ui/StatCard';
import { formatAsOf, formatDuration } from '@/lib/analytics/view';
import { isFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { ensureFreshRollup, readDashboard } from '@/server/services/analytics';
import { requireCurrentUser } from '@/server/services/auth/session';
import { buildHeatmap, localDateFor } from '@/server/services/streak';

export const metadata: Metadata = { title: 'Dashboard · Quadrantcode' };

export default async function DashboardPage() {
  const user = await requireCurrentUser();
  const db = getDb();

  const now = new Date();
  const today = localDateFor(now, user.timezone);

  /*
   * The heatmap read runs ALONGSIDE the rollup, not after it.
   *
   * `readDashboard` needs `status`, so those two are genuinely sequential.
   * `buildHeatmap` needs neither, and chaining it would add its latency to a
   * page that is the first thing a signed-in user sees. That is not a
   * hypothetical cost here: adding a second read to the problem page earlier
   * measurably worsened the cold-start flake in `e2e/session.spec.ts`, because
   * every test there navigates and clicks immediately.
   */
  const [status, days] = await Promise.all([
    ensureFreshRollup(db, { userId: user.id, today, now }),
    buildHeatmap(db, user.id, today),
  ]);

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
          <LinkPending />
        </Link>
        {/* F4.2 · the only way in to /tracks, and only while it is switched on. */}
        {isFeatureEnabled('FEATURE_TRACKS') ? (
          <>
            {' · '}
            <Link className="underline" href="/tracks">
              Preparation tracks
              <LinkPending />
            </Link>
          </>
        ) : null}
      </p>

      {/*
        The heatmap belongs here, not only on /settings/goals.

        It is the most legible thing the product makes — a year of practice in
        one glance — and it was rendered on a settings page, behind a goal form,
        which almost nobody opens. The dashboard is where a signed-in user
        lands, and the four stat cards left most of it empty.

        It stays on /settings/goals too: there it is feedback on the goal being
        edited a few lines below, which is a different job from being the
        landing screen's headline.
      */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Last 365 days</h2>
          <Link className="text-xs underline" href="/settings/goals">
            Change your daily goal
            <LinkPending />
          </Link>
        </div>
        <Heatmap days={days} />
      </section>

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
