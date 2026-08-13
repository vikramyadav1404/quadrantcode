/**
 * Problem catalog.
 *
 * The single most important rule in this file is constraint C1: for a problem
 * hosted on someone else's platform we store metadata and a link, and nothing
 * else. That is enforced by `problems_external_link_no_statement` below — at
 * the database level, so no service bug, admin form or bulk import can get
 * around it. F1.1 duplicates the rule in the service layer for a better error
 * message; this is the backstop.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  difficultyEnum,
  problemSourceTypeEnum,
  problemStatusEnum,
  problemTagTypeEnum,
} from './enums';

/** Shape of one worked example on an ORIGINAL problem. Never populated for external links. */
export type ProblemExample = {
  input: string;
  output: string;
  explanation?: string;
};

export const problems = pgTable(
  'problems',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    title: text().notNull(),

    sourceType: problemSourceTypeEnum().notNull(),

    /** Platform name for external links, e.g. 'leetcode'. NULL for originals. */
    platform: text(),
    /** Canonical problem URL on that platform. Required for external links. */
    externalUrl: text(),

    difficulty: difficultyEnum().notNull(),
    estimatedMinutes: integer().notNull().default(30),
    isPremium: boolean().notNull().default(false),
    status: problemStatusEnum().notNull().default('draft'),

    // ── Statement-bearing columns ─────────────────────────────────────────
    // MUST be NULL when source_type = 'external_link'. F4.1 adds the rest of
    // the authoring fields (reference solution, complexities, common mistakes)
    // and extends the CHECK to cover them.
    statement: text(),
    inputFormat: text(),
    outputFormat: text(),
    constraintsText: text(),
    examples: jsonb().$type<ProblemExample[]>(),
    editorial: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('problems_slug_key').on(table.slug),

    /**
     * Serves: the catalog list filtered by difficulty, restricted to visible
     * problems —
     *   SELECT ... FROM problems
     *   WHERE status = 'published' AND difficulty = $1
     *   ORDER BY created_at DESC, id DESC
     * The trailing columns make it a covering index for cursor pagination
     * (F1.1 uses keyset pagination, never OFFSET).
     */
    index('problems_status_difficulty_idx').on(
      table.status,
      table.difficulty,
      table.createdAt.desc(),
      table.id.desc(),
    ),

    /**
     * C1, enforced in the database.
     * An external-link problem may not carry any statement text, and must
     * carry the URL that sends the user to the original platform.
     */
    check(
      'problems_external_link_no_statement',
      sql`(
        ${table.sourceType} <> 'external_link'
        or (
          ${table.externalUrl} is not null
          and ${table.statement} is null
          and ${table.inputFormat} is null
          and ${table.outputFormat} is null
          and ${table.constraintsText} is null
          and ${table.examples} is null
          and ${table.editorial} is null
        )
      )`,
    ),

    /** An original problem is ours; it must not masquerade as a link elsewhere. */
    check(
      'problems_original_has_no_external_url',
      sql`(${table.sourceType} <> 'original' or ${table.externalUrl} is null)`,
    ),

    check('problems_estimated_minutes_positive', sql`${table.estimatedMinutes} > 0`),
  ],
);

export const problemTags = pgTable(
  'problem_tags',
  {
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    tagType: problemTagTypeEnum().notNull(),
    /** Lowercase kebab-case, e.g. 'binary-search', 'sliding-window', 'faang-style'. */
    tagValue: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.problemId, table.tagType, table.tagValue] }),

    /**
     * Serves: "problems filtered by difficulty + topic tag" — the tag side of
     *   SELECT p.* FROM problems p
     *   JOIN problem_tags t ON t.problem_id = p.id
     *   WHERE t.tag_type = 'topic' AND t.tag_value = $1 AND p.difficulty = $2
     * Postgres drives from this index, then probes problems by primary key.
     */
    index('problem_tags_type_value_idx').on(table.tagType, table.tagValue, table.problemId),

    /** C3: company references are always "-style", never an actual-company claim. */
    check(
      'problem_tags_company_style_suffix',
      sql`(${table.tagType} <> 'company_style' or ${table.tagValue} like '%-style')`,
    ),

    check('problem_tags_value_normalised', sql`${table.tagValue} = lower(${table.tagValue})`),
  ],
);
