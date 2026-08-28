/**
 * The due queue, and the writes that fill it.
 *
 * `ladder.ts` decides intervals and `risk.ts` decides order; this is the only
 * part that touches a database. It reads the signals both of those need, in a
 * fixed number of queries regardless of how many problems are due.
 *
 * ## The cap is the feature
 *
 * A user who stops for three weeks comes back to sixty overdue problems, and a
 * list of sixty is a list nobody starts. The queue returns the highest-risk
 * `cap` of them and says how many there are in total, so the number is honest
 * and the work is startable. Nothing is dropped — the rest are still due
 * tomorrow, in the same order.
 */
import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import {
  analyticsTopicDaily,
  problemTags,
  problems,
  reflectionMistakes,
  reflections,
  revisionSchedule,
  solveSessions,
  userProblems,
} from '@/server/db/schema';
import type { MistakeCategory } from '@/lib/reflection/taxonomy';
import { type LocalDate, daysBetween } from '@/server/services/streak';
import { scoreTopic } from '@/server/services/analytics';
import {
  type Confidence,
  type LadderKind,
  type RevisionOutcome,
  type SolveSignals,
  applyOutcome,
  dueDateFor,
  scheduleAfterSolve,
} from './ladder';
import { type RiskScore, scoreRisk } from './risk';

/** How many due problems the queue hands over at once, unless asked otherwise. */
export const DEFAULT_DAILY_CAP = 5;

export type DueItem = {
  problemId: string;
  slug: string;
  title: string;
  dueLocalDate: LocalDate;
  daysOverdue: number;
  intervalDays: number;
  ladderKind: LadderKind;
  ladderIndex: number;
  risk: RiskScore;
};

export type DueQueue = {
  items: DueItem[];
  /** Everything due, including what the cap held back. */
  totalDue: number;
  cap: number;
};

/**
 * Schedule (or reschedule) a problem after it has been solved.
 *
 * Runs inside the caller's transaction so a solve and its schedule land
 * together: a completed session whose revision was never scheduled is a problem
 * that silently never comes back.
 */
export async function scheduleAfterSolveTx(
  tx: Transaction,
  input: {
    userId: string;
    problemId: string;
    signals: SolveSignals;
    today: LocalDate;
  },
): Promise<void> {
  const { userId, problemId, signals, today } = input;

  const [existing] = await tx
    .select({ ladderIndex: revisionSchedule.ladderIndex })
    .from(revisionSchedule)
    .where(and(eq(revisionSchedule.userId, userId), eq(revisionSchedule.problemId, problemId)))
    .limit(1);

  /*
   * Solving a problem again continues from where it was, rather than starting
   * over. Resetting on every solve would mean a problem the user has held for
   * months drops back to a one-day gap the moment they revisit it.
   */
  const step = scheduleAfterSolve(signals, existing?.ladderIndex ?? 0);

  await tx
    .insert(revisionSchedule)
    .values({
      userId,
      problemId,
      ladderKind: step.kind,
      ladderIndex: step.index,
      intervalDays: step.intervalDays,
      dueLocalDate: dueDateFor(today, step.intervalDays),
    })
    // Targeted per D16: the conflict this absorbs is "this problem is already
    // scheduled", which is the normal case for a re-solve, not a race.
    .onConflictDoUpdate({
      target: [revisionSchedule.userId, revisionSchedule.problemId],
      set: {
        ladderKind: step.kind,
        ladderIndex: step.index,
        intervalDays: step.intervalDays,
        dueLocalDate: dueDateFor(today, step.intervalDays),
        updatedAt: new Date(),
      },
    });
}

/**
 * Record how a revision went and move the schedule accordingly.
 *
 * Returns null when the problem is not scheduled — revising something that was
 * never solved is not an error, it just has no ladder to move.
 */
export async function recordRevisionOutcome(
  db: Database,
  input: {
    userId: string;
    problemId: string;
    outcome: RevisionOutcome;
    today: LocalDate;
  },
): Promise<{ intervalDays: number; dueLocalDate: LocalDate } | null> {
  const { userId, problemId, outcome, today } = input;

  const [current] = await db
    .select({
      ladderKind: revisionSchedule.ladderKind,
      ladderIndex: revisionSchedule.ladderIndex,
      revisionCount: revisionSchedule.revisionCount,
    })
    .from(revisionSchedule)
    .where(and(eq(revisionSchedule.userId, userId), eq(revisionSchedule.problemId, problemId)))
    .limit(1);

  if (!current) return null;

  const next = applyOutcome({ kind: current.ladderKind, index: current.ladderIndex }, outcome);
  const dueLocalDate = dueDateFor(today, next.intervalDays);

  await db
    .update(revisionSchedule)
    .set({
      ladderIndex: next.index,
      intervalDays: next.intervalDays,
      dueLocalDate,
      lastRevisedLocalDate: today,
      revisionCount: current.revisionCount + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(revisionSchedule.userId, userId), eq(revisionSchedule.problemId, problemId)));

  return { intervalDays: next.intervalDays, dueLocalDate };
}

/**
 * What is due, highest risk first.
 *
 * Five queries whatever the size of the queue: the due rows, then the signals
 * for that set in one batch each. Scoring happens in memory, which is where the
 * pure module lives.
 */
export async function dueToday(
  db: Database,
  input: { userId: string; today: LocalDate; cap?: number },
): Promise<DueQueue> {
  const { userId, today } = input;
  const cap = input.cap ?? DEFAULT_DAILY_CAP;

  const due = await db
    .select({
      problemId: revisionSchedule.problemId,
      dueLocalDate: revisionSchedule.dueLocalDate,
      intervalDays: revisionSchedule.intervalDays,
      ladderKind: revisionSchedule.ladderKind,
      ladderIndex: revisionSchedule.ladderIndex,
      slug: problems.slug,
      title: problems.title,
    })
    .from(revisionSchedule)
    .innerJoin(problems, eq(problems.id, revisionSchedule.problemId))
    .where(and(eq(revisionSchedule.userId, userId), lte(revisionSchedule.dueLocalDate, today)))
    .orderBy(revisionSchedule.dueLocalDate);

  if (due.length === 0) return { items: [], totalDue: 0, cap };

  const problemIds = due.map((row) => row.problemId);

  const [attempts, mistakeRows, tagRows, topicDays] = await Promise.all([
    db
      .select({
        problemId: userProblems.problemId,
        confidence: userProblems.confidence,
      })
      .from(userProblems)
      .where(and(eq(userProblems.userId, userId), inArray(userProblems.problemId, problemIds))),

    // Every mistake ever recorded against these problems, through their sessions.
    db
      .select({
        problemId: solveSessions.problemId,
        category: reflectionMistakes.category,
      })
      .from(reflectionMistakes)
      .innerJoin(reflections, eq(reflections.id, reflectionMistakes.reflectionId))
      .innerJoin(solveSessions, eq(solveSessions.id, reflections.sessionId))
      .where(
        and(eq(solveSessions.userId, userId), inArray(solveSessions.problemId, problemIds)),
      ),

    db
      .select({ problemId: problemTags.problemId, topic: problemTags.tagValue })
      .from(problemTags)
      .where(and(inArray(problemTags.problemId, problemIds), eq(problemTags.tagType, 'topic'))),

    // F1.6's rollup, reused rather than recomputed: the weak-topic score is
    // already defined there, and a second implementation would drift from it.
    db.select().from(analyticsTopicDaily).where(eq(analyticsTopicDaily.userId, userId)),
  ]);

  const stuckCounts = await db
    .select({ problemId: solveSessions.problemId, status: solveSessions.status })
    .from(solveSessions)
    .where(
      and(
        eq(solveSessions.userId, userId),
        inArray(solveSessions.problemId, problemIds),
        eq(solveSessions.status, 'stuck'),
      ),
    );

  const confidenceByProblem = new Map(
    attempts.map((row) => [row.problemId, row.confidence as Confidence | null]),
  );

  const failedByProblem = new Map<string, number>();
  for (const row of stuckCounts) {
    failedByProblem.set(row.problemId, (failedByProblem.get(row.problemId) ?? 0) + 1);
  }

  const mistakesByProblem = new Map<string, MistakeCategory[]>();
  for (const row of mistakeRows) {
    const bucket = mistakesByProblem.get(row.problemId);
    if (bucket) bucket.push(row.category);
    else mistakesByProblem.set(row.problemId, [row.category]);
  }

  const weaknessByTopic = topicWeakness(topicDays, today);

  const topicsByProblem = new Map<string, string[]>();
  for (const row of tagRows) {
    const bucket = topicsByProblem.get(row.problemId);
    if (bucket) bucket.push(row.topic);
    else topicsByProblem.set(row.problemId, [row.topic]);
  }

  const items = due
    .map((row) => {
      const dueLocalDate = row.dueLocalDate as LocalDate;

      // The topic the user is weakest at, of this problem's topics: a problem
      // tagged both `arrays` and `dp` is as urgent as its harder subject.
      const topics = topicsByProblem.get(row.problemId) ?? [];
      const weakness = topics.reduce<number | null>((worst, topic) => {
        const score = weaknessByTopic.get(topic);
        if (score === undefined) return worst;
        return worst === null ? score : Math.max(worst, score);
      }, null);

      return {
        problemId: row.problemId,
        slug: row.slug,
        title: row.title,
        dueLocalDate,
        daysOverdue: Math.max(0, daysBetween(dueLocalDate, today)),
        intervalDays: row.intervalDays,
        ladderKind: row.ladderKind,
        ladderIndex: row.ladderIndex,
        risk: scoreRisk({
          daysOverdue: Math.max(0, daysBetween(dueLocalDate, today)),
          confidence: confidenceByProblem.get(row.problemId) ?? null,
          hintsUsed: 0, // F3.4 is cut; nothing produces a hint (see ladder.ts)
          failedAttempts: failedByProblem.get(row.problemId) ?? 0,
          mistakes: mistakesByProblem.get(row.problemId) ?? [],
          topicWeakness: weakness,
        }),
      } satisfies DueItem;
    })
    .sort(
      (left, right) =>
        right.risk.score - left.risk.score || left.title.localeCompare(right.title),
    );

  return { items: items.slice(0, cap), totalDue: items.length, cap };
}

/** Topic → F1.6 weak-topic score, from the rollup rows this user already has. */
function topicWeakness(
  rows: (typeof analyticsTopicDaily.$inferSelect)[],
  today: LocalDate,
): Map<string, number> {
  const byTopic = new Map<
    string,
    Parameters<typeof scoreTopic>[0] & { lastPractisedDate: LocalDate | null }
  >();

  for (const row of rows) {
    const totals = byTopic.get(row.topic) ?? {
      topic: row.topic,
      solvedCount: 0,
      stuckCount: 0,
      sessionCount: 0,
      activeSeconds: 0,
      estimatedSeconds: 0,
      confidenceSum: 0,
      confidenceCount: 0,
      lastPractisedDate: null,
    };

    totals.solvedCount += row.solvedCount;
    totals.stuckCount += row.stuckCount;
    totals.sessionCount += row.sessionCount;
    totals.activeSeconds += row.activeSeconds;
    totals.estimatedSeconds += row.estimatedSeconds;
    totals.confidenceSum += row.confidenceSum;
    totals.confidenceCount += row.confidenceCount;

    const localDate = row.localDate as LocalDate;
    if (totals.lastPractisedDate === null || localDate > totals.lastPractisedDate) {
      totals.lastPractisedDate = localDate;
    }

    byTopic.set(row.topic, totals);
  }

  return new Map(
    [...byTopic.values()].map((totals) => [totals.topic, scoreTopic(totals, today).score]),
  );
}

export type { RevisionOutcome } from './ladder';
