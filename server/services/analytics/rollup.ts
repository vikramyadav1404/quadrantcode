/**
 * Precomputing the dashboard.
 *
 * ## Why a rollup exists
 *
 * The page must stay fast at six months of history, and the only way it does
 * that is by never touching a raw session on a page load. Everything the
 * dashboard reads has already been summed into `analytics_*_daily`.
 *
 * ## There is no nightly job
 *
 * F2.3 is cut, so nothing runs on a timer (D17). Two things keep the rollup
 * current instead:
 *
 *   - the dashboard tops up its own user's stale days, capped, on load
 *   - `npm run analytics:rollup` rebuilds everything, on demand
 *
 * In steady state the top-up is one day — today — because yesterday was rolled
 * up yesterday. The cap exists for the first visit of a user with months of
 * history behind them, and the UI says when it is still catching up rather than
 * showing a partial total as if it were the whole.
 *
 * ## Re-running is safe by construction
 *
 * A day's rows are DELETED and rewritten inside one transaction, not upserted
 * column by column. That makes the rollup correct when a topic tag is removed or
 * a session is deleted — an upsert would leave the old row behind — and it makes
 * "two runs produce one row set" true by construction rather than by care.
 *
 * Readers are unaffected: Postgres keeps the old rows visible until the
 * transaction commits, so a dashboard loading mid-rollup sees yesterday's
 * numbers rather than none.
 *
 * ## `computed_at` comes from the DATABASE clock, not from `now`
 *
 * Everything else in this codebase takes `now` as a parameter so it can be
 * tested (D18), and `now` is still what the duration arithmetic uses. But
 * `computed_at` exists to be compared against `solve_sessions.updated_at` and
 * `reflections.updated_at`, both of which the database writes — and comparing
 * two clocks is how a day ends up permanently stale, or permanently fresh.
 *
 * Found exactly that way: three freshness tests failed because a rollup stamped
 * with a fixed test date was older than rows the database had stamped with the
 * real time, so every day reported itself stale forever.
 *
 * The rows below therefore omit `computed_at` entirely and let the column's
 * `defaultNow()` supply it. Every row here is a fresh INSERT — the rewrite
 * deleted the old one — so the default fires every time.
 */
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  analyticsDaily,
  analyticsStuckDaily,
  analyticsTopicDaily,
  problemTags,
  problems,
  reflectionStuckAreas,
  reflections,
  sessionEvents,
  solveSessions,
  stuckPoints,
} from '@/server/db/schema';
import { type LocalDate, localDateRange, previousLocalDate } from '@/server/services/streak';
import {
  type DurationEvent,
  TERMINAL_STATUSES,
  activeDurationSeconds,
} from '@/server/services/session';
import { CONFIDENCE_VALUES } from './scoring';

/**
 * How many stale days one page load will rebuild.
 *
 * Enough that a returning user catches up in a visit or two, small enough that
 * the first load of a six-month account does not become the slow request the
 * whole rollup exists to prevent.
 */
export const MAX_DAYS_PER_REQUEST = 30;

export type RollupStatus = {
  /** When the freshest row in the window was computed. Null when nothing is rolled up. */
  asOf: Date | null;
  /** How many days this call rebuilt. */
  rolledUp: number;
  /** True when days remain that the cap did not reach. */
  catchingUp: boolean;
};

/**
 * Rebuild the rollup for specific local dates.
 *
 * Five queries for the whole batch rather than five per day: the cost of
 * rebuilding thirty days is close to the cost of rebuilding one.
 */
export async function rollUpDays(
  db: Database,
  input: { userId: string; dates: readonly LocalDate[]; now: Date },
): Promise<number> {
  const { userId, dates, now } = input;
  if (dates.length === 0) return 0;

  const sessions = await db
    .select({
      id: solveSessions.id,
      problemId: solveSessions.problemId,
      status: solveSessions.status,
      startedAt: solveSessions.startedAt,
      endedAt: solveSessions.endedAt,
      localDate: solveSessions.endedLocalDate,
      confidence: solveSessions.confidence,
      difficulty: problems.difficulty,
      estimatedMinutes: problems.estimatedMinutes,
    })
    .from(solveSessions)
    .innerJoin(problems, eq(problems.id, solveSessions.problemId))
    .where(
      and(
        eq(solveSessions.userId, userId),
        inArray(solveSessions.status, [...TERMINAL_STATUSES]),
        inArray(solveSessions.endedLocalDate, [...dates]),
      ),
    );

  const sessionIds = sessions.map((session) => session.id);
  const problemIds = [...new Set(sessions.map((session) => session.problemId))];

  const [events, tags, markers, reflected] = await Promise.all([
    sessionIds.length
      ? db
          .select({
            sessionId: sessionEvents.sessionId,
            type: sessionEvents.type,
            occurredAt: sessionEvents.occurredAt,
          })
          .from(sessionEvents)
          .where(inArray(sessionEvents.sessionId, sessionIds))
      : [],

    problemIds.length
      ? db
          .select({ problemId: problemTags.problemId, topic: problemTags.tagValue })
          .from(problemTags)
          .where(
            and(inArray(problemTags.problemId, problemIds), eq(problemTags.tagType, 'topic')),
          )
      : [],

    sessionIds.length
      ? db
          .select({ sessionId: stuckPoints.sessionId, category: stuckPoints.category })
          .from(stuckPoints)
          .where(
            and(inArray(stuckPoints.sessionId, sessionIds), eq(stuckPoints.source, 'user')),
          )
      : [],

    sessionIds.length
      ? db
          .select({
            sessionId: reflections.sessionId,
            category: reflectionStuckAreas.category,
          })
          .from(reflections)
          .innerJoin(
            reflectionStuckAreas,
            eq(reflectionStuckAreas.reflectionId, reflections.id),
          )
          .where(inArray(reflections.sessionId, sessionIds))
      : [],
  ]);

  const eventsBySession = new Map<string, DurationEvent[]>();
  for (const event of events) {
    const bucket = eventsBySession.get(event.sessionId);
    if (bucket) bucket.push(event);
    else eventsBySession.set(event.sessionId, [event]);
  }

  const topicsByProblem = new Map<string, string[]>();
  for (const tag of tags) {
    const bucket = topicsByProblem.get(tag.problemId);
    if (bucket) bucket.push(tag.topic);
    else topicsByProblem.set(tag.problemId, [tag.topic]);
  }

  const dayRows = new Map<LocalDate, typeof analyticsDaily.$inferInsert>();
  const topicRows = new Map<string, typeof analyticsTopicDaily.$inferInsert>();
  const stuckRows = new Map<string, typeof analyticsStuckDaily.$inferInsert>();
  const sessionDates = new Map<string, LocalDate>();

  for (const session of sessions) {
    // A terminal session always has one — the CHECK guarantees it.
    const localDate = session.localDate as LocalDate;
    sessionDates.set(session.id, localDate);

    const seconds = activeDurationSeconds(
      {
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        events: eventsBySession.get(session.id) ?? [],
      },
      now,
    );

    const day = dayRows.get(localDate) ?? {
      userId,
      localDate,
      solvedCount: 0,
      stuckCount: 0,
      abandonedCount: 0,
      sessionCount: 0,
      activeSeconds: 0,
      easySolved: 0,
      mediumSolved: 0,
      hardSolved: 0,
    };

    day.sessionCount = (day.sessionCount ?? 0) + 1;
    day.activeSeconds = (day.activeSeconds ?? 0) + seconds;

    if (session.status === 'solved') {
      day.solvedCount = (day.solvedCount ?? 0) + 1;
      if (session.difficulty === 'easy') day.easySolved = (day.easySolved ?? 0) + 1;
      if (session.difficulty === 'medium') day.mediumSolved = (day.mediumSolved ?? 0) + 1;
      if (session.difficulty === 'hard') day.hardSolved = (day.hardSolved ?? 0) + 1;
    } else if (session.status === 'stuck') {
      day.stuckCount = (day.stuckCount ?? 0) + 1;
    } else {
      day.abandonedCount = (day.abandonedCount ?? 0) + 1;
    }

    dayRows.set(localDate, day);

    /*
     * Abandoned sessions are counted in the day's totals but contribute to NO
     * topic. The topic table is about how the user is doing at a subject, and
     * walking away from a tab is not evidence either way — the same judgement
     * D20 makes when it refuses to count abandonment as an attempt.
     */
    if (session.status === 'abandoned') continue;

    for (const topic of topicsByProblem.get(session.problemId) ?? []) {
      const key = `${localDate}:${topic}`;
      const row = topicRows.get(key) ?? {
        userId,
        localDate,
        topic,
        solvedCount: 0,
        stuckCount: 0,
        sessionCount: 0,
        activeSeconds: 0,
        estimatedSeconds: 0,
        confidenceSum: 0,
        confidenceCount: 0,
      };

      row.sessionCount = (row.sessionCount ?? 0) + 1;
      row.activeSeconds = (row.activeSeconds ?? 0) + seconds;
      row.estimatedSeconds = (row.estimatedSeconds ?? 0) + session.estimatedMinutes * 60;

      if (session.status === 'solved') row.solvedCount = (row.solvedCount ?? 0) + 1;
      else row.stuckCount = (row.stuckCount ?? 0) + 1;

      if (session.confidence) {
        row.confidenceSum = (row.confidenceSum ?? 0) + CONFIDENCE_VALUES[session.confidence];
        row.confidenceCount = (row.confidenceCount ?? 0) + 1;
      }

      topicRows.set(key, row);
    }
  }

  const bumpStuck = (sessionId: string, category: string, field: 'marked' | 'reflected') => {
    const localDate = sessionDates.get(sessionId);
    if (!localDate) return; // belongs to a day outside this batch

    const key = `${localDate}:${category}`;
    const row = stuckRows.get(key) ?? {
      userId,
      localDate,
      category,
      markedCount: 0,
      reflectedCount: 0,
    };

    if (field === 'marked') row.markedCount = (row.markedCount ?? 0) + 1;
    else row.reflectedCount = (row.reflectedCount ?? 0) + 1;

    stuckRows.set(key, row);
  };

  /*
   * `category` is nullable since F3.3 — but only for INFERRED rows, and this
   * query already filters to `source = 'user'`. The CHECK constraint
   * `stuck_points_user_has_category` is what makes that a narrowing rather than
   * a hopeful `!`.
   *
   * Inferred stuck points deliberately never reach the rollup: a guess about
   * where someone struggled must not inflate a count they will read as fact.
   */
  for (const marker of markers) bumpStuck(marker.sessionId, marker.category!, 'marked');
  for (const area of reflected) bumpStuck(area.sessionId, area.category, 'reflected');

  await db.transaction(async (tx) => {
    /*
     * Delete first, for every date in the batch — including dates that produced
     * no rows. A day whose only session was deleted must lose its rollup row,
     * and an upsert would have left it there reporting activity that no longer
     * exists.
     */
    const scope = [...dates];

    await tx
      .delete(analyticsDaily)
      .where(and(eq(analyticsDaily.userId, userId), inArray(analyticsDaily.localDate, scope)));
    await tx
      .delete(analyticsTopicDaily)
      .where(
        and(
          eq(analyticsTopicDaily.userId, userId),
          inArray(analyticsTopicDaily.localDate, scope),
        ),
      );
    await tx
      .delete(analyticsStuckDaily)
      .where(
        and(
          eq(analyticsStuckDaily.userId, userId),
          inArray(analyticsStuckDaily.localDate, scope),
        ),
      );

    if (dayRows.size > 0) await tx.insert(analyticsDaily).values([...dayRows.values()]);
    if (topicRows.size > 0)
      await tx.insert(analyticsTopicDaily).values([...topicRows.values()]);
    if (stuckRows.size > 0)
      await tx.insert(analyticsStuckDaily).values([...stuckRows.values()]);
  });

  return dates.length;
}

/**
 * Days whose rollup is missing or older than the data behind it.
 *
 * A day is stale when a session that ended on it has been written since the row
 * was computed, or when a reflection attached to one has — a reflection can be
 * saved days later and changes the topic confidence and the stuck distribution.
 *
 * Stuck markers need no clause of their own: they can only be added while a
 * session is live, and a session is only rolled up once it is terminal.
 */
export async function staleDays(
  db: Database,
  input: { userId: string; limit: number },
): Promise<LocalDate[]> {
  const rows = await db
    .selectDistinct({ localDate: solveSessions.endedLocalDate })
    .from(solveSessions)
    .leftJoin(
      analyticsDaily,
      and(
        eq(analyticsDaily.userId, solveSessions.userId),
        eq(analyticsDaily.localDate, solveSessions.endedLocalDate),
      ),
    )
    .leftJoin(reflections, eq(reflections.sessionId, solveSessions.id))
    .where(
      and(
        eq(solveSessions.userId, input.userId),
        inArray(solveSessions.status, [...TERMINAL_STATUSES]),
        isNotNull(solveSessions.endedLocalDate),
        or(
          sql`${analyticsDaily.id} is null`,
          gt(solveSessions.updatedAt, analyticsDaily.computedAt),
          gt(reflections.updatedAt, analyticsDaily.computedAt),
        ),
      ),
    )
    .orderBy(desc(solveSessions.endedLocalDate))
    .limit(input.limit + 1);

  return rows
    .map((row) => row.localDate)
    .filter((localDate): localDate is LocalDate => localDate !== null);
}

/**
 * Bring this user's rollup up to date, within the cap, and report where it got
 * to.
 *
 * Called on the dashboard's own page load. In steady state it finds one stale
 * day — today — and the whole call is two cheap queries.
 */
export async function ensureFreshRollup(
  db: Database,
  input: { userId: string; today: LocalDate; now: Date; maxDays?: number },
): Promise<RollupStatus> {
  const limit = input.maxDays ?? MAX_DAYS_PER_REQUEST;

  const stale = await staleDays(db, { userId: input.userId, limit });
  const catchingUp = stale.length > limit;
  const dates = stale.slice(0, limit);

  if (dates.length > 0) {
    await rollUpDays(db, { userId: input.userId, dates, now: input.now });
  }

  const [freshest] = await db
    .select({ computedAt: analyticsDaily.computedAt })
    .from(analyticsDaily)
    .where(eq(analyticsDaily.userId, input.userId))
    .orderBy(desc(analyticsDaily.computedAt))
    .limit(1);

  return {
    asOf: freshest?.computedAt ?? null,
    rolledUp: dates.length,
    catchingUp,
  };
}

/**
 * Rebuild every day in a window, ignoring freshness.
 *
 * What `npm run analytics:rollup` runs, and what a test uses to put a known
 * dataset into a known state. `days` counts backwards from `today` inclusive.
 */
export async function rebuildWindow(
  db: Database,
  input: { userId: string; today: LocalDate; days: number; now: Date },
): Promise<number> {
  const from = previousLocalDate(input.today, input.days - 1);
  const dates = localDateRange(from, input.today);

  return rollUpDays(db, { userId: input.userId, dates, now: input.now });
}
