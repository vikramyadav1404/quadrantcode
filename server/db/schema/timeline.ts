/**
 * F3.2 · code snapshots — what the source looked like, and when.
 *
 * ## Why the log has no `elapsed_ms` column
 *
 * F3.2's spec lists `elapsed_ms` as a column on `session_events`. It is not one,
 * and `server/services/timeline/events.ts` derives it on read instead.
 *
 * **D20 already made this decision one level up.** F1.4 removed
 * `solve_sessions.active_duration_seconds` because events are the record;
 * storing elapsed on every event is that same column, one row down and
 * multiplied by the number of events.
 *
 * And this table's whole point is that it cannot be corrected. A derived value
 * written into an append-only log is wrong forever the day the derivation is
 * wrong — the trigger below would refuse the fix. Derived on read, repairing
 * `pausedIntervals` repairs every session that ever ran.
 *
 * The cost, stated plainly: no `WHERE elapsed_ms > …` in SQL. F3.3's signals
 * read gaps between events, which is `occurred_at` arithmetic, so nothing in
 * the plan needs it. When something does, the column arrives then.
 *
 * ## The first snapshot is full; the rest are diffs
 *
 * Storage is the reason (the ticket asks for a projection at 1,000 MAU), but
 * the constraint below is about correctness: a session whose sequence 0 is a
 * diff has nothing to apply the diff TO, and `reconstruct` could never rebuild
 * it. That is not a bug worth discovering from a user's lost code.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { executionLanguageEnum, snapshotTriggerEnum } from './enums';
import { solveSessions } from './session';
import { users } from './users';

/** Nothing larger is snapshotted. Same ceiling as an execution submission. */
export const MAX_SNAPSHOT_BYTES = 65_536;

export const codeSnapshots = pgTable(
  'code_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),

    sessionId: uuid()
      .notNull()
      .references(() => solveSessions.id, { onDelete: 'cascade' }),

    /**
     * Denormalised from the session on purpose.
     *
     * "Delete my solve history" and the 90-day purge both scope by user, and
     * both must work without joining a table whose rows they are also deleting.
     */
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Position within the session. Sequence 0 is the full source. */
    sequence: integer().notNull(),

    language: executionLanguageEnum().notNull(),

    /** True when `content` is the whole source; false when it is a diff. */
    isFull: boolean().notNull(),

    /**
     * The full source, or the diff operations as JSON.
     *
     * Text rather than jsonb: nothing filters or groups by what is inside it,
     * which is exactly F1.5's rule for what may stay unstructured (D21). It is
     * read whole, applied, and never queried into.
     */
    content: text().notNull(),

    /**
     * Bytes of the RECONSTRUCTED source at this point — not of `content`.
     *
     * The storage projection needs both what we store and what the user
     * actually wrote, and the second cannot be recovered later without
     * replaying every diff in the database.
     */
    sourceBytes: integer().notNull(),

    trigger: snapshotTriggerEnum().notNull(),

    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * One row per position, and the order `reconstruct` walks —
     *   SELECT ... FROM code_snapshots
     *   WHERE session_id = $1 AND sequence <= $2 ORDER BY sequence
     */
    uniqueIndex('code_snapshots_session_sequence_key').on(table.sessionId, table.sequence),

    /** Serves the 90-day purge and "delete my solve history". */
    index('code_snapshots_user_created_idx').on(table.userId, table.createdAt),

    check('code_snapshots_sequence_non_negative', sql`${table.sequence} >= 0`),

    /**
     * The first snapshot of a session is always the full source.
     *
     * Without this a session can exist whose sequence 0 is a diff against
     * nothing, and every reconstruction of it fails — discovered, if at all,
     * when a user asks to see code they wrote weeks ago.
     *
     * Only one direction is constrained. A LATER snapshot may also be full:
     * re-basing after a long chain is a reasonable thing to want, and forbidding
     * it here would be the constraint deciding a storage policy.
     */
    check('code_snapshots_first_is_full', sql`${table.sequence} > 0 or ${table.isFull}`),

    check(
      'code_snapshots_content_within_cap',
      sql`length(${table.content}) <= ${sql.raw(String(MAX_SNAPSHOT_BYTES))}`,
    ),

    check('code_snapshots_source_bytes_non_negative', sql`${table.sourceBytes} >= 0`),
  ],
);

export type CodeSnapshot = typeof codeSnapshots.$inferSelect;
