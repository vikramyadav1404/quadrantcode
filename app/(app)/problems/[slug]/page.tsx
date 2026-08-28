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
import { AttemptHistory, LastAttemptPanel } from '@/components/session/AttemptHistory';
import { getAttemptHistory } from '@/server/services/reflection';
import { startSessionAction } from '../../sessions/actions';

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

  /*
   * Every finished session on this problem (F1.5). Empty for a signed-out
   * visitor, who has no history to show and no session to have started.
   */
  const history = user
    ? await getAttemptHistory(getDb(), {
        userId: user.id,
        problemId: problem.id,
        now: new Date(),
      })
    : [];

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

      {/*
        F1.5 · the panel first, then the timeline.
        Reopening a solved problem should answer "what did I do last time?"
        before it offers the whole history — that is the question someone coming
        back to a problem is actually asking.
      */}
      {history[0] ? <LastAttemptPanel attempt={history[0]} /> : null}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Your attempts</h2>
        <AttemptHistory attempts={history} />
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
