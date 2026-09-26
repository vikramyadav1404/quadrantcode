/**
 * F4.2 · the preparation tracks. Behind `FEATURE_TRACKS`; off is a 404.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CompanyDisclaimer } from '@/components/companies/CompanyDisclaimer';
import { PageHeader } from '@/components/ui/PageHeader';
import { isFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { listTracks } from '@/server/services/tracks';

export const metadata: Metadata = { title: 'Tracks · Quadrantcode' };

export default async function TracksPage() {
  if (!isFeatureEnabled('FEATURE_TRACKS')) notFound();
  const user = await requireCurrentUser();
  const tracks = await listTracks(getDb(), { userId: user.id });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tracks"
        description="Ordered paths through the catalog, one section at a time."
      />
      <CompanyDisclaimer />
      <ul className="flex flex-col gap-3">
        {tracks.map((track) => (
          <li
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
            key={track.slug}
          >
            <Link className="font-medium underline" href={`/tracks/${track.slug}`}>
              {track.title}
            </Link>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{track.description}</p>
            <p className="mt-2 text-sm tabular-nums">
              {track.solved} of {track.total} solved · {track.percent}%
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
