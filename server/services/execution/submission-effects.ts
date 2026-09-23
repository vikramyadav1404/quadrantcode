import { and, eq, sql } from 'drizzle-orm';
import type { Transaction } from '@/server/db';
import { problems, userProblems, users } from '@/server/db/schema';
import type { ExecutionVerdict } from './types';
import { creditSolvedDay, localDateFor, type LocalDate } from '@/server/services/streak';
import { scheduleAfterSolveTx } from '@/server/services/revision';
import { activeSecondsForSession, countStuckAttempts } from '@/server/services/session/signals';

export type VerifiedSubmissionEffect = {
  acceptedForFirstTime: boolean;
  streakDate: LocalDate | null;
};

/**
 * Mutates learning state only after a real provider returned a terminal result.
 * Browser verdicts and fake-development runs never reach this function.
 */
export async function applyVerifiedSubmissionEffectsTx(
  tx: Transaction,
  input: {
    userId: string;
    problemId: string;
    sessionId: string | null;
    verdict: ExecutionVerdict;
    runtimeMs: number | null;
    now: Date;
  },
): Promise<VerifiedSubmissionEffect> {
  const accepted = input.verdict === 'accepted';
  const [current, user, problem] = await Promise.all([
    tx
      .select({ status: userProblems.status })
      .from(userProblems)
      .where(
        and(eq(userProblems.userId, input.userId), eq(userProblems.problemId, input.problemId)),
      )
      .limit(1),
    tx
      .select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1),
    tx
      .select({ estimatedMinutes: problems.estimatedMinutes })
      .from(problems)
      .where(eq(problems.id, input.problemId))
      .limit(1),
  ]);

  if (!user[0] || !problem[0]) return { acceptedForFirstTime: false, streakDate: null };
  const acceptedForFirstTime = accepted && current[0]?.status !== 'solved';

  await tx
    .update(problems)
    .set({
      totalSubmissions: sql`${problems.totalSubmissions} + 1`,
      ...(accepted ? { acceptedSubmissions: sql`${problems.acceptedSubmissions} + 1` } : {}),
      updatedAt: input.now,
    })
    .where(eq(problems.id, input.problemId));

  const nowSql = sql`${input.now.toISOString()}::timestamptz`;

  /*
   * `best_time_seconds` is how long the USER took, not how long their program
   * ran. This used to be `ceil(runtimeMs / 1000)` — the Judge0 execution time —
   * which put values like `1` in a column the session path fills with real
   * solve durations. One column, two meanings, depending on which path wrote.
   *
   * `null` when there is no live session: a Submit from the editor outside a
   * timed sitting has no solve time, and the `least(coalesce(...))` below then
   * leaves any existing best untouched rather than overwriting it with a
   * fabricated one.
   */
  const activeSeconds = await activeSecondsForSession(tx, input.sessionId, input.now);
  const bestSeconds = activeSeconds !== null ? Math.max(1, activeSeconds) : null;
  await tx
    .insert(userProblems)
    .values({
      userId: input.userId,
      problemId: input.problemId,
      status: accepted ? 'solved' : 'in_progress',
      firstSolvedAt: accepted ? input.now : null,
      lastAttemptedAt: input.now,
      totalAttempts: 1,
      bestTimeSeconds: accepted ? bestSeconds : null,
    })
    .onConflictDoUpdate({
      target: [userProblems.userId, userProblems.problemId],
      set: {
        status: accepted
          ? 'solved'
          : sql`case when ${userProblems.status} = 'solved' then 'solved'::user_problem_status else 'in_progress'::user_problem_status end`,
        ...(accepted
          ? {
              firstSolvedAt: sql`coalesce(${userProblems.firstSolvedAt}, ${nowSql})`,
              // Only a timed sitting can improve a best time.
              ...(bestSeconds !== null
                ? {
                    bestTimeSeconds: sql`least(coalesce(${userProblems.bestTimeSeconds}, ${bestSeconds}), ${bestSeconds})`,
                  }
                : {}),
            }
          : {}),
        lastAttemptedAt: input.now,
        totalAttempts: sql`${userProblems.totalAttempts} + 1`,
        updatedAt: input.now,
      },
    });

  if (!acceptedForFirstTime) return { acceptedForFirstTime, streakDate: null };

  const localDate = localDateFor(input.now, user[0].timezone);
  await creditSolvedDay(tx, {
    userId: input.userId,
    localDate,
    timeZone: user[0].timezone,
    now: input.now,
  });

  /*
   * Real signals, from the session this submission belongs to.
   *
   * These were `failedAttempts: 0` and `activeSeconds = estimatedSeconds`, and
   * the combination was worse than "approximate": with confidence null, zero
   * hints, zero failures and a ratio of exactly 1.0, NOT ONE rule in
   * `scheduleAfterSolve` can fire. Every accepted submit stepped the ladder by
   * exactly zero, so a forty-minute struggle on a twenty-minute problem was
   * scheduled identically to a clean five-minute solve.
   *
   * `activeSeconds` stays null when there is no session rather than falling
   * back to the estimate: the ladder reads a fast solve as evidence of mastery,
   * and inventing one is how a problem quietly stops coming back.
   */
  const estimatedSeconds = problem[0].estimatedMinutes * 60;
  await scheduleAfterSolveTx(tx, {
    userId: input.userId,
    problemId: input.problemId,
    today: localDate,
    signals: {
      // No prompt has been shown at submit time, so this is genuinely unknown.
      confidence: null,
      // F3.4 is cut, so nothing produces a hint; the signal is inert.
      hintsUsed: 0,
      failedAttempts: await countStuckAttempts(tx, input.userId, input.problemId),
      activeSeconds: activeSeconds ?? estimatedSeconds,
      estimatedSeconds,
    },
  });

  return { acceptedForFirstTime, streakDate: localDate };
}
