/**
 * F3.5 · what a user keeps getting wrong, across every session.
 *
 * ## A rollup, rewritten rather than incremented
 *
 * Same shape as F1.6's analytics tables and for the same reason (**D22**):
 * delete-and-rewrite makes "running it twice produces one set of rows" true by
 * construction. An incrementing counter here would need every write path to
 * remember it, and a mistake counted twice is one the user is told they make
 * more than they do.
 *
 * ## Only CONFIRMED evidence reaches this table
 *
 * F3.3 infers stuck points and asks the user to confirm them. An unanswered
 * inference is a guess, and the criterion for this ticket is that guesses must
 * not inflate what the user is shown as their record. `aggregate.ts` filters
 * `status = 'confirmed'`, and a test proves the count moves when the user
 * confirms one.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { mistakeCategoryEnum, mistakeTrendEnum } from './enums';
import { users } from './users';

export const mistakePatterns = pgTable(
  'mistake_patterns',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    category: mistakeCategoryEnum().notNull(),

    /**
     * The topic this pattern clusters in, when there is one.
     *
     * Free text rather than an enum: topics come from `problem_tags`, which is
     * a catalog rather than a taxonomy this project controls. Nullable because
     * a mistake made across untagged problems still counts.
     */
    topic: text(),

    occurrences: integer().notNull(),

    /**
     * Confirmed stuck points in this pattern's topic.
     *
     * A SEPARATE count, not folded into `occurrences`, because
     * `stuck_points.category` is `stuck_category` — where the struggle was —
     * while this row's `category` is `mistake_category` — what went wrong. Two
     * taxonomies (F1.5), and adding them together would produce a number that
     * means neither.
     *
     * This is the column F3.3's `status` actually reaches: an unanswered
     * inference must not increment it, and confirming one must. That is this
     * ticket's third criterion, and it would be vacuous without somewhere for
     * confirmation to make a difference.
     */
    confirmedStuckCount: integer().notNull().default(0),

    /** Occurrences inside the trend windows, kept so the panel can show its working. */
    recentCount: integer().notNull(),
    earlierCount: integer().notNull(),

    trend: mistakeTrendEnum().notNull(),

    firstSeenOn: timestamp({ withTimezone: true }).notNull(),
    lastSeenOn: timestamp({ withTimezone: true }).notNull(),

    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * One row per user, category and topic — the grain the panel reads.
     *
     * TWO partial indexes rather than one, because a plain unique index treats
     * NULLs as distinct: `(user, category, NULL)` could then appear any number
     * of times, and the untagged-problem case is exactly the one that would
     * duplicate. `NULLS NOT DISTINCT` would say this in one line and needs a
     * newer drizzle than this project has.
     */
    uniqueIndex('mistake_patterns_grain')
      .on(table.userId, table.category, table.topic)
      .where(sql`${table.topic} is not null`),

    uniqueIndex('mistake_patterns_grain_untagged')
      .on(table.userId, table.category)
      .where(sql`${table.topic} is null`),

    /**
     * Serves: "this user's recurring mistakes, worst first" — the panel and the
     * pre-solve warning's top three.
     */
    index('mistake_patterns_user_occurrences_idx').on(table.userId, table.occurrences.desc()),

    check(
      'mistake_patterns_counts_non_negative',
      sql`${table.occurrences} >= 0
      and ${table.recentCount} >= 0 and ${table.earlierCount} >= 0`,
    ),

    /** The windows are subsets of the total; they cannot exceed it. */
    check(
      'mistake_patterns_windows_within_total',
      sql`${table.recentCount} + ${table.earlierCount} <= ${table.occurrences}`,
    ),

    check('mistake_patterns_seen_order', sql`${table.lastSeenOn} >= ${table.firstSeenOn}`),
  ],
);

/**
 * F3.5 · when a pre-solve warning was last shown for a pattern.
 *
 * Its own table rather than a column on the pattern: the cap is "once per
 * pattern per DAY", so the thing being recorded is a (pattern, day) pair. A
 * `lastShownAt` column would answer "when" but not survive the rollup, which
 * deletes and rewrites every pattern row — and a user would see the same
 * warning again the moment the aggregate ran.
 */
export const mistakeWarningsShown = pgTable(
  'mistake_warnings_shown',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    category: mistakeCategoryEnum().notNull(),

    /** The user's own local date — the same day boundary the streak uses (D18). */
    shownLocalDate: text().notNull(),

    /** Set when the user closes it, so a dismissal outlasts the day. */
    dismissedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The cap itself, enforced by the database rather than by a query. */
    uniqueIndex('mistake_warnings_once_per_day').on(
      table.userId,
      table.category,
      table.shownLocalDate,
    ),
  ],
);

export type MistakePattern = typeof mistakePatterns.$inferSelect;
