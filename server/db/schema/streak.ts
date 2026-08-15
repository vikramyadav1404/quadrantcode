/**
 * F1.3 · streak state and freeze coverage.
 *
 * Both tables are **derived**. Everything here can be rebuilt from
 * `daily_sessions` and `daily_goals` by `recomputeStreak`, which is what makes
 * the recompute safe to run any number of times — the spec's central
 * requirement. Nothing writes to these except that function.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const userStreaks = pgTable(
  'user_streaks',
  {
    /**
     * The user IS the key. One streak per user, so this is a 1:1 extension of
     * `users` rather than a table with its own identity — which also means the
     * recompute cannot accidentally create a second row for someone.
     */
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    currentStreak: integer().notNull().default(0),
    longestStreak: integer().notNull().default(0),

    /**
     * The last local date that COUNTED toward the streak, whether it was
     * completed or covered by a freeze. Null for a user who has never had one.
     *
     * A `date`, not a timestamp: it is a calendar day in the user's zone, and
     * storing it as an instant would reintroduce exactly the ambiguity `day.ts`
     * exists to remove.
     */
    lastCompletedLocalDate: date(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    /**
     * Written ONLY when the computed state actually differs from the stored
     * one.
     *
     * The spec requires a double recompute to produce "identical row versions",
     * and a no-op that bumps this timestamp is the version of idempotent most
     * implementations settle for — it looks right in every test that compares
     * the interesting columns. `recomputeStreak` compares first and skips the
     * write entirely, and the test asserts on the full row including this
     * column.
     */
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('user_streaks_current_non_negative', sql`${table.currentStreak} >= 0`),
    check(
      'user_streaks_longest_at_least_current',
      // The invariant that catches a recompute which advanced the current
      // streak without carrying the high-water mark with it.
      sql`${table.longestStreak} >= ${table.currentStreak}`,
    ),
  ],
);

/**
 * Which days a freeze is standing in for.
 *
 * **NOT an append-only ledger, unlike every other log in this project.** It is
 * a projection of current coverage: `recomputeStreak` rewrites it, and a
 * backfill that completes a covered day REMOVES the row rather than marking it
 * void. That is deliberate and reasoned in D18 — coverage has to be a function
 * of the day sequence, or recompute becomes a function of the order things were
 * logged and two identical histories diverge.
 *
 * The consequence to know before building on it: there is no history of "a
 * freeze was once applied to D and later released". Auditing that needs a new
 * table, not a query against this one.
 */
export const streakFreezes = pgTable(
  'streak_freezes',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** The missed day this freeze covers — the acceptance criterion's "date it covered". */
    coveredLocalDate: date().notNull(),

    consumedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * One freeze per day per user. Also the idempotency guarantee for the
     * recompute: re-deriving the same coverage cannot create a second row for a
     * day already covered, so a concurrent recompute is harmless.
     */
    uniqueIndex('streak_freezes_user_date_key').on(table.userId, table.coveredLocalDate),

    /**
     * Serves: the monthly allowance query and the recompute's coverage read —
     *   SELECT covered_local_date FROM streak_freezes
     *   WHERE user_id = $1 AND covered_local_date >= $2
     *   ORDER BY covered_local_date
     * Ascending, because the recompute walks days forward and the balance is
     * counted per calendar month.
     */
    index('streak_freezes_user_date_idx').on(table.userId, table.coveredLocalDate),
  ],
);

export type UserStreak = typeof userStreaks.$inferSelect;
export type StreakFreeze = typeof streakFreezes.$inferSelect;
