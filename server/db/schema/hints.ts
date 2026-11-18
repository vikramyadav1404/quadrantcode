/**
 * AI hint coach: every hint shown, kept so the user can read it again, so the
 * daily limit can be counted, and so a solve that needed hints is scheduled as
 * one (the ladder's `hints-used` signal, FSRS's Hard grade).
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { problems } from './problems';
import { users } from './users';

export const aiHints = pgTable(
  'ai_hints',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    /** 1 nudge · 2 approach · 3 next concrete step. */
    level: smallint().notNull(),
    hint: text().notNull(),
    model: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_hints_user_created_idx').on(table.userId, table.createdAt),
    index('ai_hints_user_problem_idx').on(table.userId, table.problemId, table.createdAt),
    check('ai_hints_level_range', sql`${table.level} between 1 and 3`),
    check('ai_hints_hint_length', sql`char_length(${table.hint}) between 1 and 2000`),
  ],
);
