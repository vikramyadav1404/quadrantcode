/**
 * The solve screen: problem on the left, editor on the right.
 *
 * ## What the left pane can show, and what it cannot
 *
 * For an external-link problem there is no statement here, ever — C1, enforced
 * by `problems_external_link_no_statement` at the database. The pane shows what
 * exists (difficulty, topics, your own history) and sends the reader to the
 * platform that holds the text.
 *
 * `problem.statement` is passed through regardless. For external problems it is
 * always null and the panel says so; for original problems (C2, the text is
 * ours) F4.1 fills it and this page needs no change.
 *
 * ## The limits are printed, not discovered by hitting them
 *
 * Still true, just moved: a user whose infinite loop is killed at two seconds
 * should be able to see that two seconds was the rule.
 */
import { notFound } from 'next/navigation';
import { AttemptHistory } from '@/components/session/AttemptHistory';
import { ProblemPanel } from '@/components/solve/ProblemPanel';
import { SplitPane } from '@/components/solve/SplitPane';
import { RunPanel } from '@/components/editor/RunPanel';
import { getDb } from '@/server/db';
import { getCurrentUser } from '@/server/services/auth/session';
import { ProblemNotFoundError, getProblemBySlug } from '@/server/services/problems';
import { EXECUTION_LIMITS } from '@/server/services/execution';
import { getAttemptHistory } from '@/server/services/reflection';
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

  /*
   * F3.2 · which sitting this run belongs to, if any.
   *
   * Resolved here rather than sent by the client, for the same reason the
   * timer's elapsed time is: a session id the browser supplies is a claim about
   * whose history a snapshot lands in.
   */
  const session = user
    ? await getActiveSession(getDb(), {
        userId: user.id,
        timeZone: user.timezone,
        now: new Date(),
      })
    : null;

  const sessionId = session?.problemId === problem.id ? session.id : null;

  const history = user
    ? await getAttemptHistory(getDb(), {
        userId: user.id,
        problemId: problem.id,
        now: new Date(),
      })
    : [];

  return (
    <SplitPane
      leftLabel="the problem"
      rightLabel="the editor"
      left={
        <ProblemPanel
          problem={{
            title: problem.title,
            difficulty: problem.difficulty,
            /*
             * `tags` carries every kind — topic, pattern, company. The chips
             * show topics only: a company-style tag beside a difficulty pill
             * reads as a claim about where the question came from, which C3 is
             * careful about.
             */
            topics: problem.tags
              .filter((tag) => tag.tagType === 'topic')
              .map((tag) => tag.tagValue),
            // Null for every external problem — see the header.
            statement: problem.statement ?? null,
            externalUrl: problem.externalUrl,
            platform: problem.platform,
          }}
          submissions={<AttemptHistory attempts={history} />}
        />
      }
      right={
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <RunPanel
              defaultLanguage="cpp17"
              onSubmit={submitRunAction}
              problemId={problem.id}
              sessionId={sessionId}
            />
          </div>

          {/*
            Named honestly. This is Judge0 with these limits configured, not a
            sandbox this project built — the wording stays factual about what is
            SENT rather than about what is guaranteed.
          */}
          <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]">
            {EXECUTION_LIMITS.cpuSeconds}s CPU · {EXECUTION_LIMITS.wallSeconds}s wall ·{' '}
            {EXECUTION_LIMITS.memoryKb / 1024} MB · no network ·{' '}
            {EXECUTION_LIMITS.maxOutputBytes / 1024} KB output
          </p>
        </div>
      }
    />
  );
}
