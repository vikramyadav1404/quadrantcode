import { and, desc, eq, lte, sql } from 'drizzle-orm';
import type { Transaction } from '@/server/db';
import { dailyGoals, dailySessions, problems, userProblems, users } from '@/server/db/schema';
import type { ExecutionVerdict } from './types';
import {
  DEFAULT_TARGET_PROBLEMS,
  evaluateDayCompletion,
  localDateFor,
  type LocalDate,
} from '@/server/services/streak';
import { scheduleAfterSolveTx } from '@/server/services/revision';

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
  const bestSeconds = Math.max(1, Math.ceil((input.runtimeMs ?? 1_000) / 1_000));
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
              bestTimeSeconds: sql`least(coalesce(${userProblems.bestTimeSeconds}, ${bestSeconds}), ${bestSeconds})`,
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
    now: input.now,
  });
  await scheduleAfterSolveTx(tx, {
    userId: input.userId,
    problemId: input.problemId,
    today: localDate,
    signals: {
      confidence: null,
      hintsUsed: 0,
      failedAttempts: 0,
      activeSeconds: problem[0].estimatedMinutes * 60,
      estimatedSeconds: problem[0].estimatedMinutes * 60,
    },
  });

  return { acceptedForFirstTime, streakDate: localDate };
}

async function creditSolvedDay(
  tx: Transaction,
  input: { userId: string; localDate: LocalDate; now: Date },
): Promise<void> {
  const [goal] = await tx
    .select({ targetProblems: dailyGoals.targetProblems })
    .from(dailyGoals)
    .where(
      and(
        eq(dailyGoals.userId, input.userId),
        eq(dailyGoals.active, true),
        lte(dailyGoals.effectiveFrom, input.localDate),
      ),
    )
    .orderBy(desc(dailyGoals.effectiveFrom))
    .limit(1);
  const targetProblems = goal?.targetProblems ?? DEFAULT_TARGET_PROBLEMS;
  const [day] = await tx
    .insert(dailySessions)
    .values({
      userId: input.userId,
      localDate: input.localDate,
      targetCount: targetProblems,
      solvedCount: 1,
      revisionCount: 0,
      completed: false,
    })
    .onConflictDoUpdate({
      target: [dailySessions.userId, dailySessions.localDate],
      set: {
        solvedCount: sql`${dailySessions.solvedCount} + 1`,
        targetCount: targetProblems,
        updatedAt: input.now,
      },
    })
    .returning({
      solvedCount: dailySessions.solvedCount,
      revisionCount: dailySessions.revisionCount,
    });

  const { completed } = evaluateDayCompletion({
    solvedCount: day!.solvedCount,
    revisionCount: day!.revisionCount,
    targetProblems,
  });
  await tx
    .update(dailySessions)
    .set({ completed, updatedAt: input.now })
    .where(
      and(eq(dailySessions.userId, input.userId), eq(dailySessions.localDate, input.localDate)),
    );
}
