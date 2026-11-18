import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { StressSearchResult } from '@/lib/execution/failing-case';
import { executionJobs } from './execution';
import { users } from './users';

export type { StressSearchResult };

/**
 * One search per failed Submit. `status` is `running` while the search holds
 * its claim on the job; a search that could not finish deletes its row, so the
 * user gets the slot back.
 */
export const stressSearches = pgTable(
  'stress_searches',
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .unique()
      .references(() => executionJobs.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text().notNull().default('running'),
    result: jsonb().$type<StressSearchResult>(),
    /** How many programs ran on the execution provider. */
    runs: smallint().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('stress_searches_user_created_idx').on(table.userId, table.createdAt),
    index('stress_searches_created_idx').on(table.createdAt),
    check('stress_searches_status_known', sql`${table.status} in ('running', 'done')`),
    check(
      'stress_searches_done_has_result',
      sql`(${table.status} = 'done') = (${table.result} is not null and ${table.finishedAt} is not null)`,
    ),
    check('stress_searches_runs_range', sql`${table.runs} between 0 and 100`),
  ],
);
