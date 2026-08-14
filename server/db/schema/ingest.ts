/**
 * F1.2 · CSV import jobs.
 *
 * The job STATE lives here rather than in a queue, and that is the design, not
 * a workaround for not having Redis yet.
 *
 * Progress polling reads a row from this table. That is true whether the work
 * is executed by the in-process runner shipping today or by the BullMQ runner
 * F2.3 adds, so swapping the executor changes nothing the client can observe.
 * A queue that owned the progress state would make the polling contract a
 * property of the queue, and then F2.3 would be a rewrite of this feature
 * rather than a change of runner. See D16.
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
import { importJobStatusEnum, importRowOutcomeEnum } from './enums';
import { problems } from './problems';
import { users } from './users';

export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    status: importJobStatusEnum().notNull().default('pending'),

    /** Shown back to the user so a list of jobs is identifiable. Never a path. */
    filename: text().notNull(),

    /**
     * The uploaded CSV itself.
     *
     * Stored because the runner seam claims `enqueue(jobId)` is enough — and it
     * is only enough if the payload really is in the database. Capturing the
     * parsed rows in a closure would work for the in-process runner and quietly
     * fail for BullMQ, which gets nothing but an id across a process boundary.
     * That would have made the seam a fiction that held right up until F2.3.
     *
     * The raw text rather than the parsed rows: re-parsing is deterministic, it
     * is the source of truth for the content hash, and it is what a resumed job
     * needs after a restart. Bounded by `IMPORT_LIMITS.maxBytes` (2 MiB), and
     * cascade-deleted with the user.
     */
    content: text().notNull(),

    /**
     * Idempotency key: sha256 of the uploaded bytes.
     *
     * Deterministic, per the standing rule for background jobs. Re-uploading a
     * byte-identical file returns the EXISTING job rather than starting a
     * second one, which is what makes "re-running the same file changes
     * nothing" true at the job level as well as the row level.
     */
    contentHash: text().notNull(),

    totalRows: integer().notNull().default(0),

    /**
     * The watermark. Rows below this index have been processed.
     *
     * Advanced per chunk, not per row, so a resumed job re-processes at most
     * one chunk — which is safe because row processing is idempotent.
     */
    processedRows: integer().notNull().default(0),

    createdCount: integer().notNull().default(0),
    linkedCount: integer().notNull().default(0),
    duplicateCount: integer().notNull().default(0),
    invalidCount: integer().notNull().default(0),

    /**
     * Liveness, not progress.
     *
     * The in-process runner dies with its process, so a job can be `running`
     * with nobody running it. A stale heartbeat is the only way to tell that
     * apart from a job that is merely slow. Read by the stall sweep; automatic
     * resume is DEFERRED to F2.3.
     */
    heartbeatAt: timestamp({ withTimezone: true }),

    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),

    /** Job-level failure (unreadable file, over cap). Row errors live below. */
    error: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Serves: idempotent re-upload —
     *   SELECT id FROM import_jobs WHERE user_id = $1 AND content_hash = $2
     * Unique, so two concurrent uploads of the same file cannot both create a
     * job. Scoped to the user: two people importing the same public list are
     * two separate jobs, and neither should see the other's.
     */
    uniqueIndex('import_jobs_user_content_key').on(table.userId, table.contentHash),

    /**
     * Serves: the user's job list, newest first —
     *   SELECT ... FROM import_jobs WHERE user_id = $1
     *   ORDER BY created_at DESC, id DESC
     * Same DESC-in-the-index shape as the catalog indexes, for the reason D10
     * records: a bare `ORDER BY x DESC` means NULLS FIRST and will not match an
     * index declared DESC NULLS LAST.
     */
    index('import_jobs_user_recent_idx').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),

    /**
     * Serves: the stall sweep —
     *   SELECT id FROM import_jobs
     *   WHERE status = 'running' AND heartbeat_at < now() - interval '2 minutes'
     * Partial, because it is only ever asked about running jobs and those are a
     * vanishing fraction of the table.
     */
    index('import_jobs_running_heartbeat_idx')
      .on(table.heartbeatAt)
      .where(sql`${table.status} = 'running'`),

    check(
      'import_jobs_processed_within_total',
      sql`${table.processedRows} >= 0 and ${table.processedRows} <= ${table.totalRows}`,
    ),
    check('import_jobs_total_rows_non_negative', sql`${table.totalRows} >= 0`),
  ],
);

/**
 * Per-row outcome, which is what makes partial success reportable.
 *
 * The ticket requires invalid rows to be *reported*, not merely counted — a
 * user whose 500-row file imported 497 rows needs to know which three failed
 * and why, or the feature has handed them a puzzle.
 */
export const importJobRows = pgTable(
  'import_job_rows',
  {
    id: uuid().primaryKey().defaultRandom(),

    jobId: uuid()
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),

    /** 1-based, matching what a spreadsheet shows, excluding the header. */
    rowNumber: integer().notNull(),

    outcome: importRowOutcomeEnum().notNull(),

    /**
     * Set for `created`, `linked` and `duplicate`; null for `invalid`.
     *
     * `set null` rather than `cascade`: deleting a problem should not erase the
     * user's record that their import touched that row.
     */
    problemId: uuid().references(() => problems.id, { onDelete: 'set null' }),

    /**
     * The row as submitted, for the error report.
     *
     * Stored so the preview can show the user their own data next to the
     * message. Capped by the row-count and file-size limits upstream.
     */
    rawRow: jsonb().$type<Record<string, string>>(),

    /** Human-readable, from the Zod issue. Null unless `outcome = 'invalid'`. */
    error: text(),

    /** Which column the error is about, so the preview can highlight it. */
    errorField: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Serves: the report for one job, in file order —
     *   SELECT ... FROM import_job_rows WHERE job_id = $1 ORDER BY row_number
     * Unique on (job, row): re-processing a chunk after a resume must update
     * the existing row rather than append a second verdict for the same line.
     * That is what makes the retry idempotent at this table.
     */
    uniqueIndex('import_job_rows_job_row_key').on(table.jobId, table.rowNumber),

    /**
     * Serves: the errors-only view, which is what the user actually opens —
     *   SELECT ... FROM import_job_rows WHERE job_id = $1 AND outcome = 'invalid'
     */
    index('import_job_rows_job_invalid_idx')
      .on(table.jobId, table.rowNumber)
      .where(sql`${table.outcome} = 'invalid'`),

    check('import_job_rows_row_number_positive', sql`${table.rowNumber} > 0`),

    /**
     * An invalid row explains itself; a successful one has nothing to explain.
     * Enforced in the database because a service bug that dropped the message
     * would produce a report saying only "3 rows failed", which is exactly the
     * puzzle this table exists to prevent.
     */
    check(
      'import_job_rows_invalid_has_error',
      sql`(${table.outcome} <> 'invalid') = (${table.error} is null)`,
    ),
  ],
);

/** Progress as the polling endpoint returns it. */
export type ImportJob = typeof importJobs.$inferSelect;
export type ImportJobRow = typeof importJobRows.$inferSelect;

/**
 * How long a `running` job may go without a heartbeat before the sweep calls it
 * stalled. Generous relative to the chunk size, so a slow chunk is not mistaken
 * for a dead process.
 */
export const IMPORT_HEARTBEAT_STALE_SECONDS = 120;
