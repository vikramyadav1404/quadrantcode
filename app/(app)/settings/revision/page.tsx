/**
 * Which scheduler decides when a solved problem comes back: the fixed ladder
 * (default) or FSRS (opt-in). See `server/services/revision/fsrs.ts`.
 */
import { eq } from 'drizzle-orm';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { userProfiles } from '@/server/db/schema';
import { requireCurrentUser } from '@/server/services/auth/session';
import { setSchedulerAction } from './actions';

const OPTIONS = [
  {
    value: 'ladder',
    title: 'Fixed ladder (default)',
    description:
      'Gaps of 1 · 3 · 7 · 14 · 30 days (1 · 2 · 5 · 10 · 21 when you were unsure). A clean revision moves up a step, a struggle repeats it, a miss goes back to one day.',
  },
  {
    value: 'fsrs',
    title: 'FSRS (adaptive)',
    description:
      'Learns from each solve and revision how well you hold each problem, and schedules it for when you are about 90% likely to still remember it. Gaps can grow well past 30 days for problems you keep getting right, and shrink fast for ones you miss.',
  },
] as const;

export default async function RevisionSettingsPage() {
  const user = await requireCurrentUser();
  const [profile] = await getDb()
    .select({ scheduler: userProfiles.revisionScheduler })
    .from(userProfiles)
    .where(eq(userProfiles.userId, user.id))
    .limit(1);
  const current = profile?.scheduler === 'fsrs' ? 'fsrs' : 'ladder';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="How Quadrantcode decides when a solved problem comes back for revision."
        title="Revision scheduler"
      />
      <form action={setSchedulerAction} className="flex flex-col gap-3">
        {OPTIONS.map((option) => (
          <label
            className="flex gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
            key={option.value}
          >
            <input
              defaultChecked={current === option.value}
              name="scheduler"
              type="radio"
              value={option.value}
            />
            <span>
              <span className="block font-medium">{option.title}</span>
              <span className="mt-1 block text-sm text-[var(--text-muted)]">
                {option.description}
              </span>
            </span>
          </label>
        ))}
        <p className="text-sm text-[var(--text-muted)]">
          Switching never moves a date already set. The scheduler you choose takes over for each
          problem at its next solve or revision, and you can switch back any time.
        </p>
        <button
          className="self-start rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)]"
          type="submit"
        >
          Save
        </button>
      </form>
    </div>
  );
}
