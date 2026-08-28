/**
 * One session, as it actually unfolded.
 *
 * The read is scoped to the owner inside the service, so another user's session
 * is a 404 rather than a 403 — a 403 would confirm the id exists.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Timeline } from '@/components/timeline/Timeline';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { getTimeline } from '@/server/services/timeline/detail';

export default async function SessionTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireCurrentUser();

  const view = await getTimeline(getDb(), { userId: user.id, sessionId: id, now: new Date() });
  if (!view) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={`${view.status} · started ${view.startedAt.toISOString().slice(0, 16).replace('T', ' ')}`}
        title={view.problemTitle}
      />

      <p className="text-sm">
        <Link className="underline" href={`/problems/${view.problemSlug}`}>
          Back to the problem
        </Link>
      </p>

      {/*
        Two different silences, told apart. "No snapshots because you turned
        capture off" is a setting the user can change; "no snapshots because
        nothing ran" is not. Showing one message for both would send someone
        looking for a bug that is a preference.
      */}
      {view.captureDisabled ? (
        <p className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--text-muted)]">
          Code capture is off, so this session has no saved code.{' '}
          <Link className="underline" href="/settings/privacy">
            Change that in privacy settings
          </Link>
          .
        </p>
      ) : null}

      <Timeline view={view} />
    </div>
  );
}
