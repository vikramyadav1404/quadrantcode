/**
 * F1.5 · what the user says about how a solve went.
 *
 * ## The storage rule is the ticket
 *
 * > "Store it as enum columns and normalised child rows, with a JSONB `extras`
 * >  column for genuinely open-ended additions. One big text blob or one big
 * >  JSONB dump is a failed implementation."
 *
 * So every taxonomy value is a Postgres enum in its own column, the two
 * multi-selects are child tables rather than arrays, and `extras` holds nothing
 * this schema knows the name of. The test for whether a field belongs in
 * `extras` is simple: if anything will ever filter or group by it, it is a
 * column.
 *
 * That matters because of who reads this later. F1.6 aggregates mistake counts
 * per topic, F2.1 feeds mistake severity into a risk score, and F3.5 detects
 * recurrence across months. Every one of those is a `GROUP BY` over a taxonomy
 * value — cheap against an enum column, and a full scan with JSON extraction
 * against a blob.
 *
 * ## Confidence is not here
 *
 * It lives on `solve_sessions.confidence` (F1.4), which `user_problems` already
 * copies. A second `reflections.confidence` would be two columns holding one
 * fact, and they would disagree the first time one write path forgot the other.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { mistakeCategoryEnum, stuckCategoryEnum, stuckSourceEnum } from './enums';
import { solveSessions } from './session';

/**
 * "I'm stuck here", pressed during a session.
 *
 * Multiple per session by design — the ticket asks for it, and a solve that
 * stalls three times in three different ways is exactly the shape F3.3 later
 * learns to recognise.
 */
export const stuckPoints = pgTable(
  'stuck_points',
  {
    id: uuid().primaryKey().defaultRandom(),

    sessionId: uuid()
      .notNull()
      .references(() => solveSessions.id, { onDelete: 'cascade' }),

    category: stuckCategoryEnum().notNull(),

    /**
     * Active seconds when the marker was dropped — **computed by the server**
     * from the session's event log, never sent by the client.
     *
     * Same rule as every other duration in this codebase (D20). A marker at
     * "12 minutes in" is only comparable across sessions if the 12 came from
     * the same arithmetic as the total.
     */
    elapsedSeconds: integer().notNull(),

    /** Optional, and genuinely free text — nothing will ever group by it. */
    note: text(),

    /**
     * F1.5 writes only 'user'. F3.3 infers rows into this same table, and its
     * criterion is that confirmed and inferred be separable in a single query —
     * which this column is.
     */
    source: stuckSourceEnum().notNull().default('user'),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Serves: "this session's stuck points, in the order they happened" — the
     * attempt timeline and F3.3's signal input —
     *   SELECT ... FROM stuck_points
     *   WHERE session_id = $1 ORDER BY elapsed_seconds
     */
    index('stuck_points_session_elapsed_idx').on(table.sessionId, table.elapsedSeconds),

    /**
     * Serves F3.5's recurrence counting, which reads by category across
     * sessions and must be able to exclude inferred rows —
     *   SELECT category, count(*) FROM stuck_points
     *   WHERE source = 'user' GROUP BY category
     */
    index('stuck_points_category_source_idx').on(table.category, table.source),

    check('stuck_points_elapsed_non_negative', sql`${table.elapsedSeconds} >= 0`),

    /*
     * A note is a note, not a document. The cap is a backstop against the
     * failure this ticket names — free text growing into the place structured
     * data should have gone — and it is in the database because a service-side
     * limit is bypassed by every other write path.
     */
    check(
      'stuck_points_note_length',
      sql`(${table.note} is null or length(${table.note}) <= 2000)`,
    ),
  ],
);

/**
 * The post-solve reflection: one per session, and optional.
 *
 * A missing row means the user skipped it, which is a different fact from
 * answering "nothing went wrong" — that answer is `mistake_category = 'none'`
 * in a child row. Nothing downstream may treat the two as the same.
 */
export const reflections = pgTable(
  'reflections',
  {
    id: uuid().primaryKey().defaultRandom(),

    sessionId: uuid()
      .notNull()
      .references(() => solveSessions.id, { onDelete: 'cascade' }),

    /** How they went about it. Prose, and only prose. */
    approach: text(),

    /** e.g. "O(n log n)". Free text on purpose: nobody types complexity the same way. */
    achievedComplexity: text(),

    /**
     * Genuinely open-ended additions, and nothing else.
     *
     * The rule for what may live here: if anything will ever filter, group or
     * sort by it, it is a column instead. Everything F1.6, F2.1 and F3.5 read is
     * a column, which is why this is empty in practice today — it exists so that
     * a future question can be captured without a migration, not as a place to
     * put the taxonomy.
     */
    extras: jsonb().notNull().default({}),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One reflection per session: a second submit edits the first rather than
    // creating a competing account of the same solve.
    uniqueIndex('reflections_session_key').on(table.sessionId),

    check(
      'reflections_approach_length',
      sql`(${table.approach} is null or length(${table.approach}) <= 4000)`,
    ),
    check(
      'reflections_complexity_length',
      sql`(${table.achievedComplexity} is null or length(${table.achievedComplexity}) <= 120)`,
    ),
  ],
);

/**
 * What went wrong — a row per category, not an array and not a JSON key.
 *
 * This table IS the acceptance criterion: "mistake categories are queryable with
 * a WHERE clause on an enum column, no JSON extraction for any taxonomy field".
 */
export const reflectionMistakes = pgTable(
  'reflection_mistakes',
  {
    id: uuid().primaryKey().defaultRandom(),

    reflectionId: uuid()
      .notNull()
      .references(() => reflections.id, { onDelete: 'cascade' }),

    category: mistakeCategoryEnum().notNull(),
  },
  (table) => [
    // Ticking a box twice is one answer, not two — and F3.5 counts these rows.
    uniqueIndex('reflection_mistakes_unique').on(table.reflectionId, table.category),

    /**
     * Serves F3.5's cross-session recurrence —
     *   SELECT category, count(*) FROM reflection_mistakes
     *   JOIN reflections ... WHERE category = $1
     */
    index('reflection_mistakes_category_idx').on(table.category),
  ],
);

/** Where they were stuck, in hindsight. Same vocabulary as a live stuck marker. */
export const reflectionStuckAreas = pgTable(
  'reflection_stuck_areas',
  {
    id: uuid().primaryKey().defaultRandom(),

    reflectionId: uuid()
      .notNull()
      .references(() => reflections.id, { onDelete: 'cascade' }),

    category: stuckCategoryEnum().notNull(),
  },
  (table) => [
    uniqueIndex('reflection_stuck_areas_unique').on(table.reflectionId, table.category),
    index('reflection_stuck_areas_category_idx').on(table.category),
  ],
);

export type StuckPoint = typeof stuckPoints.$inferSelect;
export type Reflection = typeof reflections.$inferSelect;
export type ReflectionMistake = typeof reflectionMistakes.$inferSelect;
export type ReflectionStuckArea = typeof reflectionStuckAreas.$inferSelect;
