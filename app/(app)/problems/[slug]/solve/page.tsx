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
import { RevisionSittingPanel } from '@/components/revision/RevisionSittingPanel';
import { StartSolvingButton } from '@/components/session/StartSolvingButton';
import { ProblemPanel } from '@/components/solve/ProblemPanel';
import { SplitPane } from '@/components/solve/SplitPane';
import { RunPanel } from '@/components/editor/RunPanel';
import { SolveShellV2 } from '@/components/solve-v2/SolveShellV2';
import { isFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { getCurrentUser } from '@/server/services/auth/session';
import { ProblemNotFoundError, getProblemBySlug } from '@/server/services/problems';
import { EXECUTION_LIMITS } from '@/server/services/execution';
import { getAttemptHistory } from '@/server/services/reflection';
import { getActiveSession } from '@/server/services/session';
import { formatElapsed } from '@/lib/session/timer-bar-state';
import { formatDay } from '@/lib/time/format-day';
import { completeSessionAction, startSessionAction } from '../../../sessions/actions';
import { submitRunAction } from './actions';
import { getPublicNativeProblem } from '@/server/services/native-content';
import { sittingView } from '@/server/services/revision/modes';

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

  const liveHere = session?.problemId === problem.id ? session : null;
  const sessionId = liveHere?.id ?? null;

  /*
   * F2.2 · the live revision sitting, if this is one.
   *
   * Deliberately NOT gated on `FEATURE_REVISION_MODES`: a sitting only has a
   * mode if the flag was on when it started, and switching the flag off
   * mid-sitting must not suddenly hand a blind retry its previous attempt.
   */
  const sitting =
    user && liveHere?.revisionMode
      ? await sittingView(getDb(), { userId: user.id, now: new Date(), session: liveHere })
      : null;
  const blind = sitting?.mode === 'blind';

  const native =
    problem.sourceType === 'original'
      ? await getPublicNativeProblem(getDb(), {
          problemId: problem.id,
          version: problem.currentVersion,
        })
      : null;

  /*
   * Blind retry never LOADS the history, rather than loading and not rendering
   * it: the ticket's rule is that the previous attempt must not reach the
   * client at all, and a query that never runs cannot end up in a payload.
   */
  const history =
    user && !blind
      ? await getAttemptHistory(getDb(), {
          userId: user.id,
          problemId: problem.id,
          now: new Date(),
        })
      : [];

  /*
   * The aggregate record, formatted HERE rather than inside the panel.
   *
   * `ProblemPanel` is a client component. A Date formatted during its render
   * would use the server's locale and timezone under SSR and the browser's on
   * hydration — a mismatch, and the wrong day for anyone whose stored timezone
   * is not the server's. This is the only place that knows `user.timezone`.
   *
   * Nothing here is a new query: `getProblemBySlug` already returned all of it.
   */
  const record = user
    ? {
        status: problem.userStatus,
        totalAttempts: problem.history[0]?.totalAttempts ?? 0,
        bestTime:
          problem.history[0]?.bestTimeSeconds != null
            ? formatElapsed(problem.history[0].bestTimeSeconds)
            : null,
        firstSolved: formatDay(problem.history[0]?.firstSolvedAt, user.timezone),
        lastAttempted: formatDay(problem.history[0]?.lastAttemptedAt, user.timezone),
        confidence: problem.history[0]?.confidence ?? null,
      }
    : null;

  /*
   * The two halves, built once. v1 places them in a SplitPane exactly as it
   * always has; v2 (FEATURE_SOLVE_V2) hands the SAME elements to its shell, so
   * every guard above — blind retry, C1, server-resolved session — applies to
   * both, and neither can drift from the other in what it is given.
   */
  const problemPanel = (
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
        // Fetched by the same query since F1.1 and rendered nowhere until
        // now. Company tags stay out for the C3 reason given above.
        patterns: problem.tags
          .filter((tag) => tag.tagType === 'pattern')
          .map((tag) => tag.tagValue),
        // Null for every external problem — see the header.
        statement: problem.statement ?? null,
        externalUrl: problem.externalUrl,
        platform: problem.platform,
        estimatedMinutes: problem.estimatedMinutes,
        isPremium: problem.isPremium,
        record,
        native,
      }}
      submissions={
        blind ? (
          <p className="text-sm text-[var(--text-muted)]">
            Hidden during a blind retry. Your earlier attempts come back once you finish.
          </p>
        ) : (
          <AttemptHistory attempts={history} timeZone={user?.timezone ?? 'UTC'} />
        )
      }
      {...(sitting && liveHere
        ? {
            revisionPanel: (
              <RevisionSittingPanel
                elapsedSeconds={liveHere.activeDurationSeconds}
                lastAttemptedLabel={record?.lastAttempted ?? null}
                paused={liveHere.isPaused}
                sitting={sitting}
              />
            ),
          }
        : {})}
      liveSessionId={sessionId}
      /*
            The same control the problem page carries, on the page that told
            people to use it. `startSessionAction` is shared rather than
            duplicated, so the conflict handling is identical in both places.

            This does not make the timer a toll booth -- the editor is still
            reachable and usable without starting anything. It only means the
            page that says "start the timer" now has a way to.
          */
      startControl={<StartSolvingButton onStart={startSessionAction} problemId={problem.id} />}
    />
  );

  const editor = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <RunPanel
          defaultLanguage="cpp17"
          allowSubmit={problem.sourceType === 'original'}
          starters={
            native
              ? Object.fromEntries(
                  Object.entries(native.templates).map(([language, template]) => [
                    language,
                    template?.starterCode,
                  ]),
                )
              : undefined
          }
          /*
                The console's Case 1 / Case 2 / … tabs are the statement's own
                worked examples, editable. Same data the left panel renders —
                no extra query, and the two cannot disagree.
              */
          exampleInputs={native?.examples.map((example) => example.input) ?? []}
          onSubmit={submitRunAction}
          /*
                Only for an ORIGINAL problem in a live sitting. An external
                problem's accepted run is not a correctness claim (C1), so
                offering to close the sitting on one would be asserting
                something the verdict does not support.
              */
          {...(problem.sourceType === 'original'
            ? { onCompleteSession: completeSessionAction }
            : {})}
          problemId={problem.id}
          sessionId={sessionId}
          /*
                F2.2 · a blind sitting gets its own drafts, so the editor opens on
                the starter rather than restoring the previous attempt's code.
              */
          {...(blind && sessionId ? { draftScope: `blind-${sessionId}` } : {})}
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
  );

  // Read on the server, per request: no client code ever sees the flag.
  if (isFeatureEnabled('FEATURE_SOLVE_V2')) {
    return <SolveShellV2 editor={editor} problemPanel={problemPanel} />;
  }

  return (
    <SplitPane
      leftLabel="the problem"
      rightLabel="the editor"
      left={problemPanel}
      right={editor}
    />
  );
}
