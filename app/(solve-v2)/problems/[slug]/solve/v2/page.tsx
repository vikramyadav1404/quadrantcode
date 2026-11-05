/**
 * The solve screen, v2 (FEATURE_SOLVE_V2).
 *
 * Reached at `/problems/[slug]/solve`: middleware rewrites that URL here only
 * while the flag is on, so the browser URL does not change. With the flag off
 * this route is a 404 even when requested directly, so v2 cannot be reached at
 * all.
 *
 * Built from the same data as v1 (`loadSolve`): v1's `ProblemPanel`, and since
 * C5 v2's own copy of the run panel given v1's exact props, placed in
 * `SolveShellV2`, plus the session strip for the live sitting. This route's
 * layout renders no layout timer bar (`app/(solve-v2)/layout.tsx`), so the strip
 * is the only one.
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { SolveShellV2, type SolveShellV2Strip } from '@/components/solve-v2/SolveShellV2';
import { isFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { problems } from '@/server/db/schema';
import type { SessionView } from '@/server/services/session';
import { getSessionStrip } from '@/server/services/timeline/strip';
import { type LoadedSolve, loadSolve } from '@/app/_solve/load-solve';
import type { HistoryCardData } from '@/components/solve-v2/HistoryCardV2';
import { OUTCOME_LABELS } from '@/lib/reflection/attempt-view';
import { formatDay } from '@/lib/time/format-day';
import { getNextRevisionDate } from '@/server/services/revision';
import { readPatterns } from '@/server/services/mistakes';
import { type RecurringChipData, matchRecurring } from '@/lib/solve-v2/recurring';
import {
  abandonSessionAction,
  completeSessionAction,
  markStuckAction,
  pauseSessionAction,
  resumeSessionAction,
} from '@/app/(app)/sessions/actions';

export default async function SolveV2Page({ params }: { params: Promise<{ slug: string }> }) {
  // Read per request on the server. Off: not found, even for a direct request.
  if (!isFeatureEnabled('FEATURE_SOLVE_V2')) notFound();

  const { slug } = await params;
  const {
    user,
    problem,
    session,
    problemPanel,
    runPanel,
    limits,
    blind,
    history,
    record,
    topics,
  } = await loadSolve(slug);

  // Blind sitting: no card, no chip AND no query, as F2.2 requires of history
  // and patterns.
  const [historyCard, recurring] =
    user && !blind
      ? await Promise.all([
          historyFor(user.id, problem.id, record, history),
          recurringFor(user.id, topics),
        ])
      : [null, null];

  return (
    <SolveShellV2
      history={historyCard}
      limits={limits}
      problemPanel={problemPanel}
      recurring={recurring}
      runPanel={runPanel}
      strip={user && session ? await stripFor(user.id, session, problem) : null}
    />
  );
}

/**
 * C4 · the recurring-mistake chip: the user's stored patterns, read-only,
 * matched to this problem's topics. Never `warningFor` (it writes a row) and
 * never `rebuildPatterns` (it rewrites them). A problem with no topics cannot
 * match, so it costs no query.
 */
async function recurringFor(
  userId: string,
  topics: string[],
): Promise<RecurringChipData | null> {
  if (topics.length === 0) return null;
  return matchRecurring(await readPatterns(getDb(), userId), topics);
}

/**
 * C3 · the history card: the record and attempts the solve screen already
 * loaded, plus the next revision date from the one approved read-only function.
 */
async function historyFor(
  userId: string,
  problemId: string,
  record: LoadedSolve['record'],
  history: LoadedSolve['history'],
): Promise<HistoryCardData> {
  const next = await getNextRevisionDate(getDb(), { userId, problemId });
  const latest = history.find((attempt) => attempt.outcome !== 'abandoned');

  return {
    attempts: record?.totalAttempts ?? 0,
    bestTime: record?.bestTime ?? null,
    lastAttempted: record?.lastAttempted ?? null,
    lastOutcome: latest ? OUTCOME_LABELS[latest.outcome] : null,
    // A local calendar date, already in the user's zone: formatted at noon UTC
    // in UTC so no zone shift can move it, in the same style as every date here.
    nextRevision: next ? formatDay(new Date(`${next}T12:00:00Z`), 'UTC') : null,
  };
}

/**
 * The session strip's data, for the user's live sitting: the SAME session the
 * layout's timer bar shows elsewhere, which may be on another problem; then its
 * title and slug are read the way the layout reads them.
 *
 * Events come from `getSessionStrip`, the approved light read: never
 * `getTimeline` (snapshot rebuild) in the render path.
 */
async function stripFor(
  userId: string,
  session: SessionView,
  current: { id: string; title: string; slug: string },
): Promise<SolveShellV2Strip | null> {
  const db = getDb();
  const now = new Date();

  let title = current.title;
  let slug = current.slug;
  if (session.problemId !== current.id) {
    const [row] = await db
      .select({ title: problems.title, slug: problems.slug })
      .from(problems)
      .where(eq(problems.id, session.problemId))
      .limit(1);
    if (!row) return null;
    title = row.title;
    slug = row.slug;
  }

  const events = await getSessionStrip(db, { userId, sessionId: session.id, now });
  if (!events) return null;

  return {
    state: {
      sessionId: session.id,
      problemId: session.problemId,
      problemTitle: title,
      problemSlug: slug,
      status: session.status === 'paused' ? 'paused' : 'active',
      activeDurationSeconds: session.activeDurationSeconds,
      asOf: now.toISOString(),
    },
    events,
    onPause: pauseSessionAction,
    onResume: resumeSessionAction,
    onAbandon: abandonSessionAction,
    onComplete: completeSessionAction,
    onMarkStuck: markStuckAction,
  };
}
