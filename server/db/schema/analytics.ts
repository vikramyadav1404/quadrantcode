/**
 * F1.6 · precomputed daily rollups.
 *
 * ## Why these exist at all
 *
 * The dashboard must stay fast at six months of history, and the way it does
 * that is by never aggregating raw sessions on a page load. Everything the page
 * reads is already summed here, one row per user per local day.
 *
 * ## Three tables, because there are three grains
 *
 * A session belongs to a problem, a problem carries zero or more topic tags, and
 * a stuck marker carries a category. Summing a per-topic table to get a headline
 * total would double-count a problem tagged both `graphs` and `bfs`, and a
 * problem with no tags would vanish from it entirely. So:
 *
 *   `analytics_daily`        one row per day — headline counts and the difficulty split
 *   `analytics_topic_daily`  one row per day per topic — the topic table and weak topics
 *   `analytics_stuck_daily`  one row per day per category — the stuck distribution
 *
 * ## Everything here is derived
 *
 * Like `user_streaks` (D18), nothing in these tables is a fact of its own:
 * `rollUpDays` can rebuild any of it from sessions, reflections and tags.
 * That is what makes the rollup safe to re-run, and what makes losing these
 * tables an inconvenience rather than data loss.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * The headline row: what happened on one day, for one user.
 *
 * Only days with finished sessions get a row. A day with nothing on it is
 * absent rather than zeroed — the same rule `daily_sessions` follows, and it
 * keeps six months of an occasional user to a handful of rows.
 */
export const analyticsDaily = pgTable(
  'analytics_daily',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** The day the session ENDED, in the user's timezone — what the streak credits (D20). */
    localDate: date().notNull(),

    solvedCount: smallint().notNull().default(0),
    stuckCount: smallint().notNull().default(0),
    abandonedCount: smallint().notNull().default(0),

    /** Finished sessions of every outcome, so a ratio has a denominator. */
    sessionCount: smallint().notNull().default(0),

    /** Summed active seconds — the numerator for every average time on the page. */
    activeSeconds: integer().notNull().default(0),

    /** Difficulty split of the SOLVES, not of every attempt. */
    easySolved: smallint().notNull().default(0),
    mediumSolved: smallint().notNull().default(0),
    hardSolved: smallint().notNull().default(0),

    /**
     * When this row was last recomputed.
     *
     * The UI reads it verbatim to say "as of …". A dashboard that shows a
     * precomputed number while implying it is live is the failure the ticket's
     * performance section names, and this column is what makes the honest
     * version possible.
     */
    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('analytics_daily_user_date_key').on(table.userId, table.localDate),

    /**
     * Serves every read on this table — the headline stats and the 12-week
     * trend both scan a date range backwards —
     *   SELECT ... FROM analytics_daily
     *   WHERE user_id = $1 AND local_date >= $2 ORDER BY local_date DESC
     */
    index('analytics_daily_user_date_idx').on(table.userId, table.localDate.desc()),

    check(
      'analytics_daily_counts_non_negative',
      sql`${table.solvedCount} >= 0 and ${table.stuckCount} >= 0
          and ${table.abandonedCount} >= 0 and ${table.sessionCount} >= 0
          and ${table.activeSeconds} >= 0`,
    ),

    /**
     * The outcomes cannot exceed the sessions they came from. Catches a rollup
     * that counted a session twice, which is the failure mode of a re-run that
     * appends instead of replacing.
     */
    check(
      'analytics_daily_outcomes_within_sessions',
      sql`${table.solvedCount} + ${table.stuckCount} + ${table.abandonedCount}
          <= ${table.sessionCount}`,
    ),

    check(
      'analytics_daily_difficulty_within_solved',
      sql`${table.easySolved} + ${table.mediumSolved} + ${table.hardSolved}
          <= ${table.solvedCount}`,
    ),
  ],
);

/**
 * One day, one topic.
 *
 * A session lands in a row for each of its problem's topic tags, so a problem
 * tagged `graphs` and `bfs` counts once in each — which is correct for "how am I
 * doing at graphs" and wrong for "how much did I solve", hence the separate
 * headline table above.
 */
export const analyticsTopicDaily = pgTable(
  'analytics_topic_daily',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    localDate: date().notNull(),

    /**
     * The tag value, denormalised on purpose.
     *
     * Tags are free text under a CHECK that keeps them lowercase (F0.2), with no
     * table of their own to join to. Copying the string here keeps the read a
     * single-table scan, which is the whole point of a rollup.
     */
    topic: text().notNull(),

    solvedCount: smallint().notNull().default(0),
    /** Sessions that ended `stuck` — the numerator of the failed-attempt ratio. */
    stuckCount: smallint().notNull().default(0),
    sessionCount: smallint().notNull().default(0),

    activeSeconds: integer().notNull().default(0),

    /**
     * Summed `problems.estimated_minutes` for the sessions counted above, in
     * seconds.
     *
     * Kept as a sum rather than a ratio so the weekly and monthly views can add
     * rows together. A ratio cannot be summed; its inputs can.
     */
    estimatedSeconds: integer().notNull().default(0),

    /**
     * Confidence as a sum and a count, for the same reason: an average of
     * averages is not an average. low = 1, medium = 2, high = 3, and sessions
     * where the user said nothing are in neither number.
     */
    confidenceSum: smallint().notNull().default(0),
    confidenceCount: smallint().notNull().default(0),

    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('analytics_topic_daily_key').on(table.userId, table.localDate, table.topic),

    /**
     * Serves the topic table and the weak-topic scan —
     *   SELECT ... FROM analytics_topic_daily
     *   WHERE user_id = $1 AND local_date >= $2
     */
    index('analytics_topic_daily_user_date_idx').on(table.userId, table.localDate.desc()),

    check(
      'analytics_topic_daily_counts_non_negative',
      sql`${table.solvedCount} >= 0 and ${table.stuckCount} >= 0
          and ${table.sessionCount} >= 0 and ${table.activeSeconds} >= 0
          and ${table.estimatedSeconds} >= 0 and ${table.confidenceCount} >= 0`,
    ),

    check(
      'analytics_topic_daily_outcomes_within_sessions',
      sql`${table.solvedCount} + ${table.stuckCount} <= ${table.sessionCount}`,
    ),

    /** An average of 1..3 cannot come from a sum outside that range. */
    check(
      'analytics_topic_daily_confidence_range',
      sql`${table.confidenceSum} >= ${table.confidenceCount}
          and ${table.confidenceSum} <= 3 * ${table.confidenceCount}`,
    ),
  ],
);

/**
 * Where solving stalled, by day and category.
 *
 * Two sources, kept apart on purpose: a marker dropped DURING a session is a
 * different observation from a box ticked afterwards. The first is what the
 * user felt at the time; the second is what they concluded. F3.3 will add a
 * third kind — inferred — and it must not be able to hide inside either of
 * these.
 */
export const analyticsStuckDaily = pgTable(
  'analytics_stuck_daily',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    localDate: date().notNull(),

    /**
     * The stuck category as text rather than the enum.
     *
     * A rollup is a summary, and pinning it to the enum would mean a migration
     * on this table every time the taxonomy grows. The values written here come
     * from `stuck_category`, so nothing invalid can arrive — the source column
     * is still the enum that guarantees it.
     */
    category: text().notNull(),

    /** Markers the user dropped mid-session (`stuck_points`, source = 'user'). */
    markedCount: smallint().notNull().default(0),

    /** Times the category was ticked in a post-solve reflection. */
    reflectedCount: smallint().notNull().default(0),

    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('analytics_stuck_daily_key').on(table.userId, table.localDate, table.category),

    index('analytics_stuck_daily_user_date_idx').on(table.userId, table.localDate.desc()),

    check(
      'analytics_stuck_daily_counts_non_negative',
      sql`${table.markedCount} >= 0 and ${table.reflectedCount} >= 0`,
    ),
  ],
);

export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;
export type AnalyticsTopicDaily = typeof analyticsTopicDaily.$inferSelect;
export type AnalyticsStuckDaily = typeof analyticsStuckDaily.$inferSelect;
