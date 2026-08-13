/**
 * Per-user tracking: what a user has done with a problem, their daily goal,
 * and the per-local-day rollup the streak engine reads.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { confidenceEnum, userProblemStatusEnum } from './enums';
import { problems } from './problems';
import { users } from './users';

export const userProblems = pgTable(
  'user_problems',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),

    status: userProblemStatusEnum().notNull().default('not_started'),
    firstSolvedAt: timestamp({ withTimezone: true }),
    lastAttemptedAt: timestamp({ withTimezone: true }),
    totalAttempts: integer().notNull().default(0),

    /** Best ACTIVE duration, computed server-side by F1.4 — never client-sent. */
    bestTimeSeconds: integer(),
    confidence: confidenceEnum(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_problems_user_problem_key').on(table.userId, table.problemId),

    /**
     * Serves: "a user's problems filtered by status" —
     *   SELECT ... FROM user_problems
     *   WHERE user_id = $1 AND status = $2
     *   ORDER BY last_attempted_at DESC NULLS LAST
     */
    index('user_problems_user_status_idx').on(
      table.userId,
      table.status,
      table.lastAttemptedAt.desc(),
    ),

    check('user_problems_total_attempts_nonneg', sql`${table.totalAttempts} >= 0`),
    check(
      'user_problems_best_time_positive',
      sql`(${table.bestTimeSeconds} is null or ${table.bestTimeSeconds} > 0)`,
    ),
  ],
);

/**
 * Daily goal settings. Rows are effective-dated rather than mutated, so a
 * historical streak recompute (F1.3) sees the target that applied on that day
 * instead of today's target.
 */
export const dailyGoals = pgTable(
  'daily_goals',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Local date this setting starts applying, in the user's timezone. */
    effectiveFrom: date().notNull(),

    targetProblems: smallint().notNull().default(2),
    minMedium: smallint().notNull().default(0),

    /** Local wall-clock time for the daily reminder; F2.4 resolves it per zone. */
    reminderTimeLocal: time().notNull().default('20:00:00'),

    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Serves: "which goal applied on date D" —
     *   SELECT ... FROM daily_goals
     *   WHERE user_id = $1 AND active AND effective_from <= $2
     *   ORDER BY effective_from DESC LIMIT 1
     */
    index('daily_goals_user_effective_idx').on(
      table.userId,
      table.effectiveFrom.desc(),
      table.active,
    ),

    uniqueIndex('daily_goals_user_effective_key').on(table.userId, table.effectiveFrom),

    check('daily_goals_target_positive', sql`${table.targetProblems} > 0`),
    check(
      'daily_goals_min_medium_within_target',
      sql`${table.minMedium} >= 0 and ${table.minMedium} <= ${table.targetProblems}`,
    ),
  ],
);

/**
 * One row per user per LOCAL date — the unit the streak engine counts.
 *
 * `localDate` is a plain DATE, already resolved in the user's timezone at
 * write time (F1.3 rule). It is never derived from the server's clock at read
 * time, which is what makes a 23:59 IST solve count for the IST day.
 */
export const dailySessions = pgTable(
  'daily_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    localDate: date().notNull(),

    targetCount: smallint().notNull().default(0),
    solvedCount: smallint().notNull().default(0),
    revisionCount: smallint().notNull().default(0),
    completed: boolean().notNull().default(false),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('daily_sessions_user_date_key').on(table.userId, table.localDate),

    /**
     * Serves: "a user's daily_sessions for the last 90 days" — the heatmap and
     * the streak recompute —
     *   SELECT ... FROM daily_sessions
     *   WHERE user_id = $1 AND local_date >= current_date - 90
     *   ORDER BY local_date DESC
     */
    index('daily_sessions_user_date_idx').on(table.userId, table.localDate.desc()),

    check(
      'daily_sessions_counts_nonneg',
      sql`
      ${table.targetCount} >= 0 and ${table.solvedCount} >= 0 and ${table.revisionCount} >= 0
    `,
    ),
  ],
);
