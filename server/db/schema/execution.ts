/**
 * F3.1 · code execution: the job, and what it produced.
 *
 * ## There is no queue, so the table IS the queue
 *
 * The ticket specifies BullMQ. F2.3 is cut (**D17**), so `execution_jobs` holds
 * the state a queue would have held: what was submitted, where it got to, and
 * when it last showed signs of life. An in-process runner moves the row and a
 * polling endpoint reads it — which is exactly what F1.2's importer does, and
 * for the same reason.
 *
 * What that costs is recorded in the acceptance status rather than implied here:
 * no automatic retry, no backoff, no dead-letter queue, and nothing that picks a
 * job back up when the provider recovers.
 *
 * ## The concurrency cap lives in this table on purpose
 *
 * "Five concurrent per user" cannot be enforced in memory: two serverless
 * invocations each counting their own executions both see one. Counting rows
 * with a live status is the only version that holds across processes, which the
 * amendment to this ticket calls out explicitly.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  executionBackendEnum,
  executionLanguageEnum,
  executionModeEnum,
  executionStatusEnum,
  executionVerdictEnum,
} from './enums';
import { problems } from './problems';
import { solveSessions } from './session';
import { users } from './users';

/** Nothing longer than this is accepted as a submission. 64 KiB of source. */
export const MAX_SOURCE_BYTES = 65_536;

/** Nothing longer than this is accepted as stdin. */
export const MAX_STDIN_BYTES = 8_192;

/** Deliberately excludes hidden inputs and expected values. */
export type SafeTestResult = {
  ordinal: number;
  visibility: 'sample' | 'visible' | 'hidden' | 'custom';
  verdict:
    | 'accepted'
    | 'wrong_answer'
    | 'runtime_error'
    | 'compile_error'
    | 'internal_error'
    | 'tle'
    | 'mle';
  runtimeMs: number | null;
  memoryKb: number | null;
} & {
  /** Never populated for hidden tests. */
  input?: string;
  expectedOutput?: string;
  actualOutput?: string | null;
};

export const executionJobs = pgTable(
  'execution_jobs',
  {
    id: uuid().primaryKey().defaultRandom(),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),

    /**
     * The solve session this ran inside, when there is one.
     *
     * Nullable: a user can open the editor on a problem without starting a
     * timed session, and refusing to run their code until they do would make
     * the timer a toll booth rather than a tool.
     */
    sessionId: uuid().references(() => solveSessions.id, { onDelete: 'set null' }),

    language: executionLanguageEnum().notNull(),
    mode: executionModeEnum().notNull().default('run'),
    problemVersion: integer().notNull().default(1),
    status: executionStatusEnum().notNull().default('queued'),
    /** Pinned at acceptance time; providers are never selected by automatic failover. */
    backend: executionBackendEnum().notNull().default('legacy'),

    /**
     * The submitted source.
     *
     * Held here until F3.2 introduces code snapshots, which is what "source
     * snapshot ref" in the ticket will eventually point at. Until then the job
     * row is the only record of what was run, and a result with no source is
     * not worth much.
     */
    source: text().notNull(),

    /** User-supplied stdin. The only input an external-link problem gets (C1). */
    stdin: text(),

    queuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),

    /**
     * Last sign of life from the runner.
     *
     * Same role as `import_jobs`' heartbeat: an in-process runner cannot
     * survive a deploy or a serverless suspend, so a job that stops moving has
     * to be distinguishable from one that is merely slow.
     */
    heartbeatAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    /** Durable Queue publishing/outbox state. */
    dispatchAttemptCount: smallint().notNull().default(0),
    queueMessageId: text(),
    dispatchedAt: timestamp({ withTimezone: true }),
    queueExpiresAt: timestamp({ withTimezone: true }),

    /** Execution retries and the fencing lease owned by the active worker. */
    attemptCount: smallint().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid(),
    leaseExpiresAt: timestamp({ withTimezone: true }),

    /** Sanitized lifecycle evidence only; never a credential or Sandbox environment. */
    sandboxName: text(),
    sandboxExpiresAt: timestamp({ withTimezone: true }),
    cleanupPending: boolean().notNull().default(false),
    lastErrorCode: text(),

    /** Why the JOB failed — never why the code was wrong. */
    error: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Serves the hourly rate limit —
     *   SELECT count(*) FROM execution_jobs
     *   WHERE user_id = $1 AND created_at > now() - interval '1 hour'
     */
    index('execution_jobs_user_created_idx').on(table.userId, table.createdAt.desc()),

    /**
     * Serves the concurrency cap, and stays the size of the live set —
     *   SELECT count(*) FROM execution_jobs
     *   WHERE user_id = $1 AND status in ('queued','running')
     */
    index('execution_jobs_live_idx')
      .on(table.userId)
      .where(sql`${table.status} in ('queued', 'running')`),

    /** Serves stall detection over live jobs only. */
    index('execution_jobs_heartbeat_idx')
      .on(table.heartbeatAt)
      .where(sql`${table.status} in ('queued', 'running')`),

    index('execution_jobs_dispatch_reconcile_idx')
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.status} = 'queued' and ${table.dispatchedAt} is null`),

    index('execution_jobs_expired_lease_idx')
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'running' and ${table.leaseExpiresAt} is not null`),

    index('execution_jobs_daily_created_idx').on(table.createdAt),

    index('execution_jobs_cleanup_pending_idx')
      .on(table.updatedAt)
      .where(sql`${table.cleanupPending} is true`),

    check('execution_jobs_source_not_empty', sql`length(${table.source}) > 0`),
    check(
      'execution_jobs_source_within_cap',
      sql`length(${table.source}) <= ${sql.raw(String(MAX_SOURCE_BYTES))}`,
    ),
    check(
      'execution_jobs_stdin_within_cap',
      sql`(${table.stdin} is null or length(${table.stdin}) <= ${sql.raw(String(MAX_STDIN_BYTES))})`,
    ),
    check(
      'execution_jobs_attempt_counts_non_negative',
      sql`${table.dispatchAttemptCount} >= 0 and ${table.attemptCount} >= 0`,
    ),
    check(
      'execution_jobs_lease_pair_coherent',
      sql`(${table.leaseToken} is null) = (${table.leaseExpiresAt} is null)`,
    ),
    check(
      'execution_jobs_claimed_lease_present',
      sql`${table.backend} = 'legacy' or ${table.status} <> 'running'
          or (${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)`,
    ),

    /**
     * A finished job has an end; a live one does not.
     *
     * The same shape as `solve_sessions_terminal_has_end` (F1.4), and for the
     * same reason: letting the two disagree lets a job be "completed" while
     * still counting against the concurrency cap forever.
     */
    check(
      'execution_jobs_terminal_has_end',
      sql`
      (${table.status} in ('queued', 'running') and ${table.finishedAt} is null)
      or
      (${table.status} in ('completed', 'failed') and ${table.finishedAt} is not null)
    `,
    ),
  ],
);

/**
 * What an execution produced.
 *
 * One row per finished job, and only for jobs that actually ran — a job that
 * failed because the provider was unreachable has no verdict, and inventing
 * `internal_error` for it would tell the user their code did something it did
 * not.
 */
export const runAttempts = pgTable(
  'run_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),

    jobId: uuid()
      .notNull()
      .references(() => executionJobs.id, { onDelete: 'cascade' }),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    problemId: uuid()
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    sessionId: uuid().references(() => solveSessions.id, { onDelete: 'set null' }),

    language: executionLanguageEnum().notNull(),
    verdict: executionVerdictEnum().notNull(),

    /** Set only by the server after a configured provider returns a terminal result. */
    serverVerified: boolean().notNull().default(false),
    serverVerifiedAt: timestamp({ withTimezone: true }),
    providerName: text(),
    compilerRuntimeVersion: text(),
    /** Per-case summaries only; hidden inputs and expected outputs never enter this object. */
    testResults: jsonb().$type<SafeTestResult[]>(),

    runtimeMs: integer(),
    memoryKb: integer(),

    /**
     * Null for an external-link problem, always.
     *
     * C1 forbids storing another platform's test cases, so there is nothing to
     * check the output against and no verdict to derive from tests. The editor
     * is a scratchpad there, and a `0 / 0` would read as a failure rather than
     * as "not applicable".
     */
    testsPassed: smallint(),
    testsTotal: smallint(),

    /**
     * Program output, kept because a scratchpad with no visible output is not a
     * scratchpad. Not in the ticket's field list, which names stderr and
     * compile output — an omission rather than a prohibition, since IN SCOPE 6
     * describes exactly the mode that needs it.
     */
    stdout: text(),
    stderr: text(),
    compileOutput: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** One result per job: a second row would be a second truth about one run. */
    uniqueIndex('run_attempts_job_key').on(table.jobId),

    /**
     * Serves: "this user's runs on this problem, newest first" — the run history
     * beside the editor, and F3.2's timeline.
     */
    index('run_attempts_user_problem_idx').on(
      table.userId,
      table.problemId,
      table.createdAt.desc(),
    ),

    check(
      'run_attempts_measurements_non_negative',
      sql`(${table.runtimeMs} is null or ${table.runtimeMs} >= 0)
          and (${table.memoryKb} is null or ${table.memoryKb} >= 0)`,
    ),

    /** Tests are either both known or both unknown, and passed cannot exceed total. */
    check(
      'run_attempts_tests_coherent',
      sql`
      (${table.testsPassed} is null and ${table.testsTotal} is null)
      or
      (${table.testsPassed} is not null and ${table.testsTotal} is not null
        and ${table.testsPassed} >= 0 and ${table.testsPassed} <= ${table.testsTotal})
    `,
    ),
    check(
      'run_attempts_server_verification_coherent',
      sql`(${table.serverVerified} and ${table.serverVerifiedAt} is not null and ${table.providerName} is not null)
          or (not ${table.serverVerified} and ${table.serverVerifiedAt} is null)`,
    ),
  ],
);

export type ExecutionJob = typeof executionJobs.$inferSelect;
export type RunAttempt = typeof runAttempts.$inferSelect;
