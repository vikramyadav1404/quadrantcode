/**
 * The editor.
 *
 * For an external-link problem this page holds no statement — C1 again. The
 * problem lives on the other platform, the link is right there, and what this
 * page adds is a place to work and a record that you did.
 *
 * The limits are printed rather than left to be discovered by hitting them. A
 * user whose infinite loop is killed at two seconds should be able to see that
 * two seconds was the rule.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { RunPanel } from '@/components/editor/RunPanel';
import { getDb } from '@/server/db';
import { getCurrentUser } from '@/server/services/auth/session';
import { ProblemNotFoundError, getProblemBySlug } from '@/server/services/problems';
import { EXECUTION_LIMITS } from '@/server/services/execution';
import { getActiveSession } from '@/server/services/session';
import { submitRunAction } from './actions';

export default async function SolvePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();

  let problem;
  try {
    problem = await getProblemBySlug(getDb(), slug, user?.id ?? null);
  } catch (error) {
    if (error instanceof ProblemNotFoundError) notFound();
    throw error;
  }

  const external = problem.sourceType === 'external_link';

  /*
   * F3.2 · which sitting this run belongs to, if any.
   *
   * Resolved here rather than sent by the client, for the same reason the
   * timer's elapsed time is: a session id the browser supplies is a claim about
   * whose history a snapshot lands in.
   *
   * Null is normal. The editor works without a timed session, and a run outside
   * one is a scratch run that leaves no snapshot — see the action.
   */
  const session = user
    ? await getActiveSession(getDb(), {
        userId: user.id,
        timeZone: user.timezone,
        now: new Date(),
      })
    : null;

  const sessionId = session?.problemId === problem.id ? session.id : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={
          external
            ? 'A scratchpad. This problem is hosted elsewhere, so nothing you run here is checked against its tests.'
            : 'Write and run your solution.'
        }
        title={problem.title}
      />

      {external && problem.externalUrl ? (
        <p className="text-sm">
          <Link
            className="underline"
            href={problem.externalUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            Open the problem on {problem.platform ?? 'the original site'}
          </Link>
        </p>
      ) : null}

      <RunPanel
        defaultLanguage="cpp17"
        onSubmit={submitRunAction}
        problemId={problem.id}
        sessionId={sessionId}
      />

      {/*
        Named honestly. This is Judge0 with these limits configured, not a
        sandbox this project built — and whether they are honoured is a property
        of the instance, which is why the wording stays factual about what is
        sent rather than about what is guaranteed.
      */}
      <section className="text-sm text-[var(--text-muted)]">
        <h2 className="mb-1 font-medium text-[var(--text-primary)]">Run limits</h2>
        <p>
          Every run is submitted with a {EXECUTION_LIMITS.cpuSeconds}-second CPU limit, a{' '}
          {EXECUTION_LIMITS.wallSeconds}-second wall-clock limit,{' '}
          {EXECUTION_LIMITS.memoryKb / 1024} MB of memory, no network access, and at most{' '}
          {EXECUTION_LIMITS.maxOutputBytes / 1024} KB of captured output.
        </p>
      </section>
    </div>
  );
}
