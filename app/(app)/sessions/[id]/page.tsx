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
import { StuckRegions } from '@/components/session/StuckRegions';
import { inferForSession, loadStuckPoints, saveInferences } from '@/server/services/inference';
import type { StuckRegionView } from '@/lib/inference/view';
import { answerStuckAction } from './actions';

export default async function SessionTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireCurrentUser();

  const now = new Date();
  const view = await getTimeline(getDb(), { userId: user.id, sessionId: id, now });
  if (!view) notFound();

  /*
   * Inference runs on read, and writes what it finds.
   *
   * There is no queue to schedule it on (D17), and the request path is where
   * F1.2 and F1.6 already put this kind of work. It is cheap — five pure
   * functions over data this page was loading anyway — and `saveInferences`
   * never overwrites an answer the user has given, so re-running on every visit
   * cannot undo their judgement.
   */
  await saveInferences(getDb(), {
    userId: user.id,
    sessionId: id,
    regions: await inferForSession(getDb(), { userId: user.id, sessionId: id, now }),
  });

  const stuck = await loadStuckPoints(getDb(), { userId: user.id, sessionId: id });

  const regions: StuckRegionView[] = stuck.map((row) => ({
    id: row.id,
    source: row.source,
    status: row.status,
    confidence: row.confidence,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    startedSeconds: row.startedSeconds ?? row.elapsedSeconds,
    durationSeconds:
      row.endedSeconds !== null && row.startedSeconds !== null
        ? row.endedSeconds - row.startedSeconds
        : 0,
    evidence: Array.isArray(row.evidence) ? (row.evidence as string[]) : [],
    note: row.note,
    category: row.category,
  }));

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

      <section>
        <h2 className="mb-1 text-sm font-medium">Where you may have got stuck</h2>
        {/*
          The wording is load-bearing, not decorative. These signals see timing
          and edits, never the user — so the heading says "may have", every row
          hedges, and every row can be argued with (C4).
        */}
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          Worked out from your edits and runs. Tell us where it is wrong — a dismissed
          suggestion counts for nothing afterwards.
        </p>
        <StuckRegions onAnswer={answerStuckAction} regions={regions} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">The session, minute by minute</h2>
        <Timeline view={view} />
      </section>
    </div>
  );
}
