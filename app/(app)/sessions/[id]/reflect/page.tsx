/**
 * F1.5 · reflect on a finished session.
 *
 * Finishing a session brings the user here. That IS the nudge the ticket asks
 * for — a page they have to leave rather than a prompt they can miss — and
 * "Skip for now" is the whole of the skip: no row is written and nothing marks
 * the session as unreflected, because a skipped reflection is simply its
 * absence.
 *
 * A route rather than a dialog in the timer bar, because the bar unmounts the
 * moment the session ends (there is no live session left to draw). This is also
 * where F3.2's session timeline will live.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import {
  SessionNotReflectableError,
  getReflection,
  getStuckMarkers,
} from '@/server/services/reflection';
import { SessionNotFoundError, loadOwnedSession } from '@/server/services/session';
import { formatElapsed } from '@/lib/session/timer-bar-state';
import { STUCK_CATEGORY_LABELS } from '@/lib/reflection/taxonomy';
import { problems } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { saveReflectionAction } from '../actions';
import { ReflectRedirect } from './ReflectRedirect';

export const metadata: Metadata = { title: 'Reflect · Quadrantcode' };

export default async function ReflectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCurrentUser();
  const db = getDb();

  let session;
  try {
    session = await loadOwnedSession(db, id, user.id);
  } catch (error) {
    // Someone else's session is indistinguishable from one that does not
    // exist — the same rule the service applies (F4.8's IDOR check).
    if (error instanceof SessionNotFoundError) notFound();
    throw error;
  }

  if (session.status !== 'solved' && session.status !== 'stuck') {
    // Reaching this by hand rather than by finishing something. Say why, and do
    // not pretend a form here would save.
    throw new SessionNotReflectableError(session.status);
  }

  const [existing, markers, [problem]] = await Promise.all([
    getReflection(db, { userId: user.id, sessionId: id }),
    getStuckMarkers(db, { userId: user.id, sessionId: id }),
    db
      .select({ title: problems.title, slug: problems.slug })
      .from(problems)
      .where(eq(problems.id, session.problemId))
      .limit(1),
  ]);

  if (!problem) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`How did ${problem.title} go?`}
        description={
          session.status === 'solved'
            ? 'Solved. A minute now is what makes the next revision useful.'
            : 'Marked stuck. What blocked you is the most useful thing to record.'
        }
      />

      {markers.length > 0 ? (
        <section className="mb-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="mb-2 text-sm font-semibold">What you marked while solving</h2>
          <ul className="flex flex-col gap-1 text-sm text-[var(--text-muted)]">
            {markers.map((marker) => (
              <li key={marker.id}>
                <span className="font-mono tabular-nums">
                  {formatElapsed(marker.elapsedSeconds)}
                </span>{' '}
                — {STUCK_CATEGORY_LABELS[marker.category]}
                {marker.note ? `: ${marker.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ReflectRedirect
        initial={{
          approach: existing?.approach ?? null,
          achievedComplexity: existing?.achievedComplexity ?? null,
          stuckAreas: existing?.stuckAreas ?? [],
          mistakes: existing?.mistakes ?? [],
          confidence: existing?.confidence ?? null,
        }}
        onSave={saveReflectionAction}
        problemSlug={problem.slug}
        sessionId={id}
      />

      <p className="mt-8 text-xs text-[var(--text-muted)]">
        <Link className="underline" href={`/problems/${problem.slug}`}>
          ← Back to {problem.title}
        </Link>
      </p>
    </div>
  );
}
