/**
 * The monthly report.
 *
 * ## The PDF is this page, printed — not a second renderer
 *
 * The criterion is *"Monthly report PDF generates and matches the HTML
 * content"*. A separate PDF library would be a second renderer that can drift
 * from the HTML, which is precisely the risk the criterion is written against —
 * so the print stylesheet makes them **the same document**, and the match is
 * structural rather than something a test has to keep checking.
 *
 * The cost, stated plainly: no server-generated file. The user presses the
 * button and their browser writes the PDF. Recorded as a deviation rather than
 * as the criterion met in the way it was imagined.
 */
import { PageHeader } from '@/components/ui/PageHeader';
import { PrintButton } from '@/components/mistakes/PrintButton';
import { RecurringPanel } from '@/components/mistakes/RecurringPanel';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { rebuildPatterns } from '@/server/services/mistakes';
import { ensureFreshRollup, readDashboard } from '@/server/services/analytics';
import { localDateFor } from '@/server/services/streak';
import type { PatternView } from '@/lib/mistakes/view';

export default async function MonthlyReportPage() {
  const user = await requireCurrentUser();
  const now = new Date();

  const today = localDateFor(now, user.timezone);

  const rows = await rebuildPatterns(getDb(), { userId: user.id, now });

  /*
   * The same read the analytics page makes, and the same freshness handling.
   * A report that quietly showed staler numbers than the dashboard would be two
   * answers to one question.
   */
  const status = await ensureFreshRollup(getDb(), { userId: user.id, today, now });
  const dashboard = await readDashboard(getDb(), {
    userId: user.id,
    today,
    asOf: status.asOf,
    catchingUp: status.catchingUp,
  });

  const patterns: PatternView[] = rows.map((row) => ({
    category: row.category,
    topic: row.topic,
    occurrences: row.occurrences,
    confirmedStuckCount: row.confirmedStuckCount,
    trend: row.trend,
    lastSeenOn: row.lastSeenOn,
  }));

  const improved = rows.filter((row) => row.trend === 'improving').length;

  return (
    <div className="report flex flex-col gap-6">
      <PageHeader
        description={
          /*
           * The "as of" line F1.6 made non-negotiable. A precomputed number
           * shown as if it were live is the failure that ticket named.
           */
          dashboard.asOf
            ? `Numbers as of ${dashboard.asOf.toISOString().slice(0, 16).replace('T', ' ')}.`
            : 'Nothing has been rolled up yet.'
        }
        title="Monthly report"
      />

      {/* Hidden when printing — a button in a PDF is a smudge. */}
      <div className="no-print">
        <PrintButton />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium">Solving</h2>
        <ul className="text-sm text-[var(--text-muted)]">
          <li>· {dashboard.headline.totalSolved} problems solved</li>
          <li>· {dashboard.headline.solvedThisWeek} of them this week</li>
          <li>· longest streak: {dashboard.headline.longestStreak} days</li>
          <li>· mistakes getting rarer: {improved}</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Recurring mistakes</h2>
        <RecurringPanel patterns={patterns} />
      </section>
    </div>
  );
}
