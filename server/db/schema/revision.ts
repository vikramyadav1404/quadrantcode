/**
 * F2.1 · when a solved problem comes back.
 *
 * One row per problem a user has solved: where they are on the ladder, and the
 * local date the next revision is due. The ladder arithmetic itself is pure and
 * lives in `server/services/revision/ladder.ts` — this table only records where
 * that arithmetic left them.
 *
 * ## Why the interval is stored and not recomputed
 *
 * `interval_days` is the number that actually produced `due_local_date`. It
 * could be looked up from the ladder and the index, and then a change to the
 * ladder constants would silently move the due date of every problem in the
 * system — including ones scheduled months ago under a different rule. Storing
 * it means a ladder change affects the NEXT interval and leaves history alone,
 * which is D18's immutability applied to a schedule.
 *
 * The same argument applies to `ladder_kind`: it is chosen once, from the
 * confidence the user reported at the time, and does not follow them if they
 * later feel differently about the problem.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ladderKindEnum } from './enums';
import { problems } from './problems';
import { users } from './users';

export const revisionSchedule = pgTable(
  'revision_schedule',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),

    /** Which ladder, fixed at first scheduling. */
    ladderKind: ladderKindEnum().notNull().default('standard'),

    /** Position on that ladder, 0-based. Advancing past the end stays at the end. */
    ladderIndex: smallint().notNull().default(0),

    /** The interval that produced `due_local_date`, after every signal applied. */
    intervalDays: smallint().notNull(),

    /**
     * The day this becomes due, in the USER's timezone.
     *
     * A date, not an instant, for the same reason every other day boundary in
     * this codebase is one (D18): "due today" has to mean the user's today.
     */
    dueLocalDate: date().notNull(),

    /** Null until the first revision is actually done. */
    lastRevisedLocalDate: date(),

    /** How many revisions have been completed — not how many are scheduled. */
    revisionCount: smallint().notNull().default(0),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * One schedule per problem per user. Solving the same problem again moves
     * this row rather than adding a second one — two schedules for one problem
     * would put it in the queue twice, on different days.
     */
    uniqueIndex('revision_schedule_user_problem_key').on(table.userId, table.problemId),

    /**
     * Serves the due queue, which is the only read on this table —
     *   SELECT ... FROM revision_schedule
     *   WHERE user_id = $1 AND due_local_date <= $2
     *   ORDER BY due_local_date
     */
    index('revision_schedule_due_idx').on(table.userId, table.dueLocalDate),

    /**
     * The ladder floor, enforced by the database.
     *
     * The spec's rule is that intervals never go below one day however many
     * compression signals stack. The pure module holds that, and this is the
     * backstop for anything that writes here without going through it.
     */
    check('revision_schedule_interval_at_least_one_day', sql`${table.intervalDays} >= 1`),

    check(
      'revision_schedule_index_non_negative',
      sql`${table.ladderIndex} >= 0 and ${table.revisionCount} >= 0`,
    ),
  ],
);

export type RevisionSchedule = typeof revisionSchedule.$inferSelect;
