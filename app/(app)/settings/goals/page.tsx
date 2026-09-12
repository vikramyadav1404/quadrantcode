/**
 * F1.3 · /settings/goals — daily goal, timezone, and the activity heatmap.
 *
 * Every day boundary on this page is resolved in the USER's timezone. The
 * server's zone appears nowhere, which is the entire point of `day.ts`.
 */
import type { Metadata } from 'next';
import { and, desc, eq } from 'drizzle-orm';
import { Heatmap } from '@/components/heatmap/Heatmap';
import { getDb } from '@/server/db';
import { dailyGoals } from '@/server/db/schema';
import { requireCurrentUser } from '@/server/services/auth/session';
import { buildHeatmap, localDateFor, recomputeStreak } from '@/server/services/streak';
import { GoalsForm } from './GoalsForm';

export const metadata: Metadata = { title: 'Daily goals · Quadrantcode' };

export default async function GoalsPage() {
  const user = await requireCurrentUser();
  const db = getDb();

  const today = localDateFor(new Date(), user.timezone);

  /*
   * The recompute runs on page load rather than on a schedule. F2.3 is cut, so
   * nothing is going to run it for us (D17) — and it is cheap and idempotent,
   * so doing it here is the honest version of "kept up to date" rather than a
   * value that silently ages.
   */
  const [[goal], streak, days] = await Promise.all([
    db
      .select()
      .from(dailyGoals)
      .where(and(eq(dailyGoals.userId, user.id), eq(dailyGoals.active, true)))
      .orderBy(desc(dailyGoals.effectiveFrom))
      .limit(1),
    recomputeStreak(db, user.id, today),
    buildHeatmap(db, user.id, today),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold">Daily goals</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A day counts when you hit your target, or solve at least one problem alongside two
          revisions.
        </p>
      </header>

      <section className="flex gap-8 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div>
          <p className="text-2xl font-semibold">{streak.currentStreak}</p>
          <p className="text-sm text-[var(--text-muted)]">Current streak</p>
        </div>
        <div>
          <p className="text-2xl font-semibold">{streak.longestStreak}</p>
          <p className="text-sm text-[var(--text-muted)]">Longest</p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Last 365 days</h2>
        <Heatmap days={days} />
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Settings</h2>
        <GoalsForm
          initial={{
            targetProblems: goal?.targetProblems ?? 2,
            minMedium: goal?.minMedium ?? 0,
            reminderTimeLocal: (goal?.reminderTimeLocal ?? '20:00:00').slice(0, 5),
            timezone: user.timezone,
          }}
        />
      </section>
    </div>
  );
}
