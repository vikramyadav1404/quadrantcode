/**
 * F4.2 · one track: progress, the next problem, time left, and locked sections.
 *
 * A locked section lists its problems without links: the path stays visible,
 * but it cannot be entered until its prerequisites are complete.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CompanyDisclaimer } from '@/components/companies/CompanyDisclaimer';
import { PageHeader } from '@/components/ui/PageHeader';
import { LinkPending } from '@/components/ui/LinkPending';
import { isFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { TrackNotFoundError, getTrack } from '@/server/services/tracks';

export const metadata: Metadata = { title: 'Track · Quadrantcode' };

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export default async function TrackPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isFeatureEnabled('FEATURE_TRACKS')) notFound();
  const user = await requireCurrentUser();
  const { slug } = await params;

  let track;
  try {
    track = await getTrack(getDb(), { userId: user.id, slug });
  } catch (error) {
    if (error instanceof TrackNotFoundError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={track.title} description={track.description} />
      <CompanyDisclaimer />

      <section
        aria-label="Progress"
        className="grid gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-3"
      >
        <div>
          <p className="text-xs text-[var(--text-muted)]">Complete</p>
          <p className="text-2xl font-semibold tabular-nums">{track.percent}%</p>
          <p className="text-xs text-[var(--text-muted)]">
            {track.solved} of {track.total} solved
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Time remaining</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatMinutes(track.remainingMinutes)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {track.estimateFromDefaults
              ? 'From the problem estimates — solve a few to make this yours.'
              : 'From your own speed on problems of the same difficulty.'}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Next</p>
          {track.next ? (
            <Link className="font-medium underline" href={`/problems/${track.next.slug}/solve`}>
              {track.next.title}
              <LinkPending />
            </Link>
          ) : (
            <p className="font-medium">Track complete</p>
          )}
        </div>
      </section>

      {track.unavailable > 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          {track.unavailable} problem{track.unavailable === 1 ? ' is' : 's are'} not in the
          catalog yet and {track.unavailable === 1 ? 'is' : 'are'} not counted.
        </p>
      ) : null}

      <ol className="flex flex-col gap-4">
        {track.sections.map((section) => (
          <li
            aria-label={section.title}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
            key={section.id}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">{section.title}</h2>
              <span className="text-sm tabular-nums text-[var(--text-muted)]">
                {section.complete
                  ? 'Complete'
                  : `${section.solved} of ${section.problems.length}`}
              </span>
            </div>
            {!section.unlocked ? (
              <p className="mt-1 text-sm text-[var(--text-muted)]" role="note">
                Locked — finish {section.requires.join(' and ')} first.
              </p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-1.5">
              {section.problems.map((problem) => (
                <li className="flex justify-between gap-3 text-sm" key={problem.slug}>
                  {section.unlocked ? (
                    <Link className="underline" href={`/problems/${problem.slug}/solve`}>
                      {problem.title}
                      <LinkPending />
                    </Link>
                  ) : (
                    <span className="text-[var(--text-muted)]">{problem.title}</span>
                  )}
                  <span className="text-[var(--text-muted)]">
                    {problem.difficulty}
                    {problem.solved ? ' · solved' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
