/**
 * Problem detail.
 *
 * For an external-link problem this page is metadata plus a link out — C1
 * means there is no statement here to render, ever.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { getDb } from '@/server/db';
import { ProblemNotFoundError, getProblemBySlug } from '@/server/services/problems';
import { getCurrentUser } from '@/server/services/auth/session';
import { StartSolvingButton } from '@/components/session/StartSolvingButton';
import { startSessionAction } from '../../session/actions';

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export default async function ProblemDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getCurrentUser();

  let problem;
  try {
    problem = await getProblemBySlug(getDb(), slug, user?.id ?? null);
  } catch (error) {
    // A hidden problem the caller has no history with is indistinguishable
    // from one that does not exist — we do not confirm draft slugs.
    if (error instanceof ProblemNotFoundError) notFound();
    throw error;
  }

  const attempt = problem.history[0];

  return (
    <>
      <PageHeader
        title={problem.title}
        description={
          problem.sourceType === 'external_link'
            ? `Hosted on ${problem.platform ?? 'an external platform'} — TraceLoop tracks how you solve it.`
            : 'An original TraceLoop problem.'
        }
        actions={
          problem.externalUrl ? (
            <a
              className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)]"
              href={problem.externalUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open on {problem.platform ?? 'platform'} ↗
            </a>
          ) : null
        }
      />

      {problem.status === 'archived' ? (
        <p className="mb-6 rounded-[var(--radius)] border border-[var(--warning)] px-3 py-2 text-sm text-[var(--warning)]">
          This problem has been archived. It no longer appears in the catalog, but your history
          with it is intact.
        </p>
      ) : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Difficulty" value={problem.difficulty} />
        <StatCard label="Estimated" value={`${problem.estimatedMinutes}m`} />
        <StatCard label="Your attempts" value={attempt?.totalAttempts ?? 0} />
        <StatCard
          label="Best active time"
          value={formatDuration(attempt?.bestTimeSeconds ?? null)}
        />
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Tags</h2>
        {problem.tags.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No tags yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {problem.tags.map((tag) => (
              <li
                className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)]"
                key={`${tag.tagType}:${tag.tagValue}`}
              >
                {tag.tagValue}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Your history</h2>
        {attempt ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--text-muted)]">Status</dt>
              <dd>{attempt.status}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Last attempted</dt>
              <dd>{attempt.lastAttemptedAt?.toLocaleDateString() ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">First solved</dt>
              <dd>{attempt.firstSolvedAt?.toLocaleDateString() ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Confidence</dt>
              <dd>{attempt.confidence ?? '—'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            You haven&apos;t attempted this problem yet.
          </p>
        )}
      </section>

      {/* F1.4 · the timer itself lives in the layout, on every screen. */}
      <StartSolvingButton onStart={startSessionAction} problemId={problem.id} />

      <p className="mt-8 text-xs text-[var(--text-muted)]">
        <Link className="underline" href="/problems">
          ← Back to the catalog
        </Link>
      </p>
    </>
  );
}
