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
import {
  mistakeCategoryEnum,
  stuckCategoryEnum,
  stuckConfidenceEnum,
  stuckSourceEnum,
  stuckStatusEnum,
} from './enums';
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

    /**
     * What kind of stuck.
     *
     * **Nullable since F3.3**, and only for inferred rows. Timing and edit
     * locality can say *where* a user struggled; they cannot say whether it was
     * the algorithm or the syntax. Guessing a category to satisfy a NOT NULL
     * would be exactly the over-claim C4 forbids, so an inference leaves it
     * empty and the CHECK below keeps user-marked rows honest.
     */
    category: stuckCategoryEnum(),

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

    /**
     * F3.3 · what the user has done about an inference.
     *
     * A row the user created is `confirmed` on arrival — they said it. An
     * inferred row starts at `inferred` and moves when the user agrees or
     * disagrees, and it is this column, not `source`, that decides weight
     * downstream (see `lib/inference/confidence.ts`).
     */
    status: stuckStatusEnum().notNull().default('confirmed'),

    confidence: stuckConfidenceEnum().notNull().default('user_marked'),

    /**
     * The region, 1-based and inclusive. Null for a user-marked point, which
     * F1.5 records without asking where.
     *
     * Always a RANGE. A signal that found one line still reports a range,
     * because a single line stated precisely is a claim about the user's
     * attention that nothing here observed.
     */
    lineStart: integer(),
    lineEnd: integer(),

    /** When the region's evidence begins and ends, in active session time. */
    startedSeconds: integer(),
    endedSeconds: integer(),

    /**
     * The sentences shown beside the region, stored rather than recomputed.
     *
     * They are a record of what the user was shown when they confirmed or
     * dismissed it — not a derivation. Recomputing would let a later change to
     * the signals silently rewrite the reasons someone already agreed with.
     *
     * JSONB and nothing will ever filter on it, which is F1.5's rule for what
     * may stay unstructured (D21).
     */
    evidence: jsonb().notNull().default([]),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
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
     * A user-marked point always says what kind. An inference never claims to.
     *
     * The backstop for the nullable column above: without it, a bug in the
     * inference writer could put a guessed category on a row the user will
     * later see as their own words.
     */
    check(
      'stuck_points_user_has_category',
      sql`(${table.source} = 'user' and ${table.category} is not null)
          or ${table.source} = 'inferred'`,
    ),

    /** A range is either fully known or absent, and never inverted. */
    check(
      'stuck_points_line_range_coherent',
      sql`(${table.lineStart} is null and ${table.lineEnd} is null)
          or (${table.lineStart} is not null and ${table.lineEnd} is not null
              and ${table.lineStart} >= 1 and ${table.lineEnd} >= ${table.lineStart})`,
    ),

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

    /**
     * NOT nullable, unlike `stuck_points.category`.
     *
     * A reflection stuck-area is something the user typed into a form. There is
     * no inferred version of it and there is nothing for a null to mean here.
     */
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
