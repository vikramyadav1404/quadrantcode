/**
 * F1.6 · the analytics dashboard.
 *
 * ## Every number here was computed before you asked for it
 *
 * The page reads `analytics_*_daily` and nothing else — no raw session is
 * touched on a page load, which is what keeps it fast at six months of history
 * (measured at 4.7ms over 235 sessions in `tests/analytics/dashboard.test.ts`).
 *
 * The cost of that is staleness, and the page says so rather than pretending
 * otherwise. `ensureFreshRollup` tops up this user's stale days first — in
 * steady state that is one day, today — and whatever it could not reach is
 * reported in the same line as the timestamp.
 *
 * There is no nightly job to do it instead: F2.3 is cut (D17), so the request
 * path and `npm run analytics:rollup` are the two things that keep the rollup
 * current.
 */
import type { Metadata } from 'next';
import { DifficultySplit } from '@/components/analytics/DifficultySplit';
import { SpeedTrend } from '@/components/analytics/SpeedTrend';
import { StuckDistribution } from '@/components/analytics/StuckDistribution';
import { TopicTable } from '@/components/analytics/TopicTable';
import { WeakTopics } from '@/components/analytics/WeakTopics';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { formatAsOf, formatDuration } from '@/lib/analytics/view';
import { getDb } from '@/server/db';
import { ensureFreshRollup, readDashboard } from '@/server/services/analytics';
import { requireCurrentUser } from '@/server/services/auth/session';
import { localDateFor } from '@/server/services/streak';

export const metadata: Metadata = { title: 'Analytics · Quadrantcode' };

export default async function AnalyticsPage() {
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
    <div className="flex flex-col gap-8">
      <div>
        <PageHeader
          title="Analytics"
          description="What you have solved, how long it takes, and where it goes wrong."
        />
        {/*
          Stated, not implied. These are precomputed totals, and a dashboard that
          shows them as though they were live is the failure the ticket's
          performance section names.
        */}
        <p className="text-xs text-[var(--text-muted)]">
          Figures {formatAsOf(data.asOf, now)}
          {data.catchingUp ? ' · still catching up on older days' : ''}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          hint="Days in a row"
          label="Current streak"
          value={data.headline.currentStreak}
        />
        <StatCard hint="Your best" label="Longest streak" value={data.headline.longestStreak} />
        <StatCard label="Solved this week" value={data.headline.solvedThisWeek} />
        <StatCard
          hint="Active time per session"
          label="Average session"
          value={formatDuration(data.headline.averageActiveSeconds)}
        />
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Worth attention next</h2>
        <WeakTopics topics={data.weakTopics} />
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          A 0–100 score from four things you have already done: how long since you practised,
          how often a sitting ended stuck, how confident you said you were, and how the time
          compares with the estimate. The full formula is in <code>docs/scoring.md</code>.
        </p>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-base font-semibold">
            Solved by difficulty{' '}
            <span className="font-normal text-[var(--text-muted)]">
              ({data.headline.totalSolved} total)
            </span>
          </h2>
          <DifficultySplit split={data.difficulty} />
        </div>

        <div>
          <h2 className="mb-3 text-base font-semibold">Minutes per solve, last 12 weeks</h2>
          <SpeedTrend trend={data.trend} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">By topic</h2>
        <TopicTable topics={data.topics} />
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Where you get stuck</h2>
        <StuckDistribution rows={data.stuckDistribution} />
      </section>
    </div>
  );
}
