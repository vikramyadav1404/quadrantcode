/**
 * F4.5 · the upsolve queue: problems an assessment left unsolved, until solved.
 *
 * ## Derived, not stored
 *
 * The queue is a function of rows that already exist — finished attempts,
 * their questions, the marks each answer earned, and the solves that came
 * afterwards — so it has no table of its own and needs no migration. Nothing
 * has to "land" in it: a problem is in the queue the moment its attempt is
 * finalised with no marks for it, which is how the ticket's "automatically" is
 * met even when the attempt is auto-submitted by the expiry sweep. And nothing
 * can drift out of step with it, because there is no second copy to update.
 *
 * ## What counts as unsolved, and what clears it
 *
 * A question is unsolved in an attempt when its answer earned no marks — which
 * includes a question never opened, and so has no answer row at all. It stays
 * in the queue until the user solves that problem AFTER the attempt: a solved
 * sitting, or full marks for it in a later assessment. Solving it before the
 * attempt does not count; the assessment is the evidence they could not do it
 * then.
 */
import { and, eq, gt, inArray } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  assessmentAnswers,
  assessmentAttempts,
  assessmentPaperQuestions,
  assessmentPapers,
  problems,
  solveSessions,
} from '@/server/db/schema';
import type { UpsolveItemView } from '@/lib/assessments/upsolve-view';

export type { UpsolveItemView } from '@/lib/assessments/upsolve-view';

/** Finished attempts; `expired` never scored and has no `submittedAt` to anchor on. */
const FINISHED = ['submitted', 'auto_submitted'] as const;

export type UpsolveCandidate = {
  attemptId: string;
  paperTitle: string;
  submittedAt: Date;
  problemId: string;
  slug: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Null when the question was never opened: no answer row exists. */
  marksAwarded: number | null;
};

/**
 * Pure: which candidates are still owed an upsolve.
 *
 * `solvedAt` lists every moment each problem was solved (by a sitting or by
 * marks in any attempt). A problem is cleared by a solve strictly after the
 * attempt it was missed in. One row per problem — the most recent miss — so a
 * problem missed in two mocks is one thing to do, not two.
 */
export function selectUpsolve(
  candidates: readonly UpsolveCandidate[],
  solvedAt: ReadonlyMap<string, readonly Date[]>,
): UpsolveItemView[] {
  const latestMiss = new Map<string, UpsolveCandidate>();
  for (const candidate of candidates) {
    if ((candidate.marksAwarded ?? 0) > 0) continue;
    const current = latestMiss.get(candidate.problemId);
    if (!current || candidate.submittedAt > current.submittedAt) {
      latestMiss.set(candidate.problemId, candidate);
    }
  }

  return [...latestMiss.values()]
    .filter((miss) => {
      const solves = solvedAt.get(miss.problemId) ?? [];
      return !solves.some((at) => at.getTime() > miss.submittedAt.getTime());
    })
    .sort(
      (a, b) =>
        b.submittedAt.getTime() - a.submittedAt.getTime() || a.title.localeCompare(b.title),
    )
    .map((miss) => ({
      problemId: miss.problemId,
      slug: miss.slug,
      title: miss.title,
      difficulty: miss.difficulty,
      attemptId: miss.attemptId,
      paperTitle: miss.paperTitle,
      submittedAt: miss.submittedAt.toISOString(),
      attempted: miss.marksAwarded !== null,
    }));
}

/**
 * The user's upsolve queue, optionally limited to one attempt (its report).
 * Three queries whatever the number of attempts.
 */
export async function getUpsolveQueue(
  db: Database,
  input: { userId: string; attemptId?: string },
): Promise<UpsolveItemView[]> {
  const rows = await db
    .select({
      attemptId: assessmentAttempts.id,
      paperTitle: assessmentPapers.title,
      submittedAt: assessmentAttempts.submittedAt,
      problemId: problems.id,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      marksAwarded: assessmentAnswers.marksAwarded,
    })
    .from(assessmentAttempts)
    .innerJoin(assessmentPapers, eq(assessmentPapers.id, assessmentAttempts.paperId))
    .innerJoin(
      assessmentPaperQuestions,
      eq(assessmentPaperQuestions.paperId, assessmentAttempts.paperId),
    )
    .innerJoin(problems, eq(problems.id, assessmentPaperQuestions.problemId))
    .leftJoin(
      assessmentAnswers,
      and(
        eq(assessmentAnswers.attemptId, assessmentAttempts.id),
        eq(assessmentAnswers.paperQuestionId, assessmentPaperQuestions.id),
      ),
    )
    .where(
      and(
        eq(assessmentAttempts.userId, input.userId),
        inArray(assessmentAttempts.status, [...FINISHED]),
      ),
    );

  const candidates: UpsolveCandidate[] = rows
    .filter((row) => row.submittedAt !== null)
    .map((row) => ({ ...row, submittedAt: row.submittedAt! }));
  if (candidates.length === 0) return [];

  const problemIds = [...new Set(candidates.map((candidate) => candidate.problemId))];
  const earliest = new Date(
    Math.min(...candidates.map((candidate) => candidate.submittedAt.getTime())),
  );
  const sittings = await db
    .select({ problemId: solveSessions.problemId, endedAt: solveSessions.endedAt })
    .from(solveSessions)
    .where(
      and(
        eq(solveSessions.userId, input.userId),
        eq(solveSessions.status, 'solved'),
        inArray(solveSessions.problemId, problemIds),
        gt(solveSessions.endedAt, earliest),
      ),
    );

  const solvedAt = new Map<string, Date[]>();
  const record = (problemId: string, at: Date) =>
    solvedAt.set(problemId, [...(solvedAt.get(problemId) ?? []), at]);
  for (const sitting of sittings)
    if (sitting.endedAt) record(sitting.problemId, sitting.endedAt);
  // Marks in a LATER attempt clear an earlier miss too.
  for (const candidate of candidates) {
    if ((candidate.marksAwarded ?? 0) > 0) record(candidate.problemId, candidate.submittedAt);
  }

  const queue = selectUpsolve(candidates, solvedAt);
  return input.attemptId ? queue.filter((item) => item.attemptId === input.attemptId) : queue;
}
