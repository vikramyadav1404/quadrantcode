import { and, desc, eq, lte, sql } from 'drizzle-orm';
import type { Transaction } from '@/server/db';
import { dailyGoals, dailySessions } from '@/server/db/schema';
import { DEFAULT_TARGET_PROBLEMS } from './goals';
import { evaluateDayCompletion } from './rules';
import type { LocalDate } from './day';

/**
 * Credit a day's solve count — once per problem, however many paths report it.
 *
 * ## Why this is derived rather than incremented
 *
 * There were two private copies of this, one in `session/lifecycle.ts` and one
 * in `execution/submission-effects.ts`, and both did `solved_count + 1`
 * unconditionally. Two writers, one counter, no coordination:
 *
 * - an accepted Submit credits the day, and
 * - pressing "Solved" on the same session credits it again.
 *
 * That is not a hypothetical ordering problem, it is the normal workflow — the
 * solve page has no auto-complete, so a user who submits successfully and then
 * ends their session walks straight through both. A per-problem guard flag
 * would fix the pair we know about and leave the next writer to rediscover it.
 *
 * So the count is RECOMPUTED from the records that say a problem was solved,
 * rather than accumulated. Calling this twice, or ten times, produces the same
 * number, and a row that already drifted repairs itself the next time the day
 * is touched. It is the same reasoning as `user_streaks` being derived (D18)
 * and recomputed on read (D19).
 *
 * ## What counts as "solved today"
 *
 * DISTINCT problems, from either path:
 *
 * - a `solve_sessions` row that ended `solved` on this local date, and
 * - an accepted Submit whose attempt landed on this local date.
 *
 * Distinct by problem, so solving one problem through both paths counts once —
 * which is the bug this function exists to close. A re-solve of a problem first
 * solved on an earlier day still counts for the day it happened on: the day's
 * question is "what did you solve today", not "what did you solve first today".
 *
 * Revisions are NOT here. `daily_sessions.revision_count` is a separate signal
 * and `evaluateDayCompletion` weighs the two differently.
 *
 * ## Ordering requirement for callers
 *
 * The row that proves the solve must already be written in this transaction.
 * Both callers satisfy it: `endSession` updates the session to `solved` before
 * calling, and `finalizeClaimedExecution` inserts the `run_attempts` row before
 * invoking `applyEffects`. A caller that credits first and writes afterwards
 * would silently count zero.
 */
export async function creditSolvedDay(
  tx: Transaction,
  input: { userId: string; localDate: LocalDate; timeZone: string; now: Date },
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

  /*
   * `at time zone` converts the attempt's instant into the user's wall clock
   * before taking a date, so a submission at 23:40 in Kolkata belongs to that
   * day and not to the UTC one. `ended_local_date` is already local, so the
   * session half needs no conversion — the asymmetry is in the data, not here.
   */
  const [solved] = await tx.execute<{ solved_count: number }>(sql`
    with solved_today as (
      select distinct s.problem_id
        from solve_sessions s
       where s.user_id = ${input.userId}
         and s.status = 'solved'
         and s.ended_local_date = ${input.localDate}
      union
      select distinct j.problem_id
        from execution_jobs j
        join run_attempts a on a.job_id = j.id
       where j.user_id = ${input.userId}
         and j.mode = 'submit'
         and a.verdict = 'accepted'
         and (a.created_at at time zone ${input.timeZone})::date = ${input.localDate}::date
    )
    select count(*)::int as solved_count from solved_today
  `);
  const solvedCount = solved?.solved_count ?? 0;

  const [day] = await tx
    .insert(dailySessions)
    .values({
      userId: input.userId,
      localDate: input.localDate,
      targetCount: targetProblems,
      solvedCount,
      revisionCount: 0,
      completed: false,
    })
    .onConflictDoUpdate({
      target: [dailySessions.userId, dailySessions.localDate],
      set: { solvedCount, targetCount: targetProblems, updatedAt: input.now },
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
