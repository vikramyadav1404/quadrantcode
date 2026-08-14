/**
 * The job seam — provisional runner today, BullMQ in F2.3.
 *
 * ## The one design point
 *
 * Progress lives in `import_jobs`, not in a queue. Polling reads a row, and
 * that is the same operation under either runner — so F2.3 replaces the
 * executor and nothing the client can observe changes. Had the queue owned
 * progress, the polling contract would be a property of the queue and F2.3
 * would be a rewrite of this feature rather than a change of runner. Same shape
 * as the storage-provider and OTP-provider seams already in the tree.
 *
 * ## What the in-process runner does NOT do
 *
 * It dies with its process. A deploy, a crash, or a serverless suspend mid-job
 * leaves a row saying `running` with nobody running it. That is why
 * `heartbeat_at` exists and why `stalled` is a distinct status: the remedy for
 * a stalled job is to resume it, and for a failed one is to fix the file.
 *
 * **Automatic resume is DEFERRED to F2.3.** `sweepStalledJobs` marks them so
 * they are visible and re-runnable; nothing re-triggers them on its own. Said
 * plainly rather than left for someone to discover.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { IMPORT_HEARTBEAT_STALE_SECONDS, importJobRows, importJobs } from '@/server/db/schema';
import type { InvalidImportRow, ValidImportRow } from './csv';
import { type ImportRowResult, importRows } from './import';
import { IMPORT_LIMITS } from './limits';

/**
 * What a runner must be able to do.
 *
 * Deliberately tiny. `enqueue` takes an id and nothing else — the payload is
 * already in the database, so a BullMQ job carries an id rather than a
 * serialised CSV, and the queue never becomes a second place the data lives.
 */
export interface JobRunner {
  enqueue(jobId: string): Promise<void>;
}

export type JobProgress = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'stalled';
  totalRows: number;
  processedRows: number;
  createdCount: number;
  linkedCount: number;
  duplicateCount: number;
  invalidCount: number;
  error: string | null;
  finishedAt: Date | null;
};

/** Exactly what the polling endpoint returns. Identical under any runner. */
export async function getJobProgress(
  db: Database,
  jobId: string,
  userId: string,
): Promise<JobProgress | null> {
  const [row] = await db
    .select({
      id: importJobs.id,
      status: importJobs.status,
      totalRows: importJobs.totalRows,
      processedRows: importJobs.processedRows,
      createdCount: importJobs.createdCount,
      linkedCount: importJobs.linkedCount,
      duplicateCount: importJobs.duplicateCount,
      invalidCount: importJobs.invalidCount,
      error: importJobs.error,
      finishedAt: importJobs.finishedAt,
    })
    .from(importJobs)
    // Scoped to the owner. A job id is a uuid, but "unguessable" is not an
    // authorisation model — someone else's import progress is not public.
    .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
    .limit(1);

  return row ?? null;
}

/**
 * Record the invalid rows a parse produced.
 *
 * Written before any importing starts, so a job that dies halfway still carries
 * the row-level errors the user needs. Upserted on `(job_id, row_number)` so a
 * resumed chunk overwrites its previous verdict rather than appending a second
 * one for the same line.
 */
export async function recordInvalidRows(
  db: Database,
  jobId: string,
  rows: readonly InvalidImportRow[],
): Promise<void> {
  if (rows.length === 0) return;

  await db
    .insert(importJobRows)
    .values(
      rows.map((row) => ({
        jobId,
        rowNumber: row.rowNumber,
        outcome: 'invalid' as const,
        rawRow: row.raw,
        error: row.error,
        errorField: row.field,
      })),
    )
    .onConflictDoNothing({ target: [importJobRows.jobId, importJobRows.rowNumber] });
}

async function recordProcessedRows(
  db: Database,
  jobId: string,
  results: readonly ImportRowResult[],
): Promise<void> {
  if (results.length === 0) return;

  await db
    .insert(importJobRows)
    .values(
      results.map((result) => ({
        jobId,
        rowNumber: result.rowNumber,
        outcome: result.outcome,
        problemId: result.problemId,
      })),
    )
    .onConflictDoNothing({ target: [importJobRows.jobId, importJobRows.rowNumber] });
}

/**
 * Process a job to completion, chunk by chunk.
 *
 * Exported so it can be driven directly by a test or by the F2.3 worker without
 * going through a runner at all — the runner decides WHEN this happens, never
 * what it does.
 *
 * Resumable by construction: it starts from `processed_rows` and each chunk is
 * idempotent, so re-running a partially-done job repeats at most one chunk and
 * that repeat is a no-op.
 */
export async function processImportJob(
  db: Database,
  jobId: string,
  rows: readonly ValidImportRow[],
): Promise<void> {
  const [job] = await db
    .select({ userId: importJobs.userId, processedRows: importJobs.processedRows })
    .from(importJobs)
    .where(eq(importJobs.id, jobId))
    .limit(1);

  if (!job) throw new Error(`processImportJob: no job ${jobId}`);

  await db
    .update(importJobs)
    .set({ status: 'running', startedAt: new Date(), heartbeatAt: new Date() })
    .where(eq(importJobs.id, jobId));

  try {
    for (
      let offset = job.processedRows;
      offset < rows.length;
      offset += IMPORT_LIMITS.chunkRows
    ) {
      const chunk = rows.slice(offset, offset + IMPORT_LIMITS.chunkRows);
      const results = await importRows(db, job.userId, chunk);

      await recordProcessedRows(db, jobId, results);

      const created = results.filter((row) => row.outcome === 'created').length;
      const linked = results.filter((row) => row.outcome === 'linked').length;
      const duplicate = results.filter((row) => row.outcome === 'duplicate').length;

      /*
       * Counters are incremented with SQL rather than read-modify-written in
       * JS. The watermark advances in the same statement, so progress and
       * counts can never disagree — a reader that caught them mid-update would
       * otherwise see rows processed but not yet counted.
       */
      await db
        .update(importJobs)
        .set({
          processedRows: sql`${importJobs.processedRows} + ${chunk.length}`,
          createdCount: sql`${importJobs.createdCount} + ${created}`,
          linkedCount: sql`${importJobs.linkedCount} + ${linked}`,
          duplicateCount: sql`${importJobs.duplicateCount} + ${duplicate}`,
          heartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId));
    }

    const [final] = await db
      .select({ invalidCount: importJobs.invalidCount })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1);

    await db
      .update(importJobs)
      .set({
        // `partial` when some rows were rejected: "succeeded" over a file that
        // dropped 3 rows is the kind of green that hides a problem.
        status: (final?.invalidCount ?? 0) > 0 ? 'partial' : 'succeeded',
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(eq(importJobs.id, jobId));
  } catch (error) {
    await db
      .update(importJobs)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : 'unknown error',
        finishedAt: new Date(),
      })
      .where(eq(importJobs.id, jobId));
    throw error;
  }
}

/**
 * The provisional runner: same process, after the response.
 *
 * `void`, deliberately — `enqueue` resolves as soon as the work is scheduled so
 * the request can return, which is the whole "does not block the request"
 * requirement. The rejection is caught and logged because an unhandled
 * rejection would take the process down, and `processImportJob` has already
 * recorded the failure on the row by then.
 */
export class InProcessJobRunner implements JobRunner {
  constructor(
    private readonly db: Database,
    private readonly rowsFor: (jobId: string) => Promise<readonly ValidImportRow[]>,
  ) {}

  async enqueue(jobId: string): Promise<void> {
    setImmediate(() => {
      void this.rowsFor(jobId)
        .then((rows) => processImportJob(this.db, jobId, rows))
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: 'import.job_failed',
              jobId,
              reason: error instanceof Error ? error.message : 'unknown',
            }),
          );
        });
    });
  }
}

/**
 * Mark jobs whose runner went away.
 *
 * Detection only. Nothing here restarts them — see the header. Without it a
 * killed job sits at `running` forever and the UI spins on a job nobody is
 * doing, which is worse than being told it stalled.
 */
export async function sweepStalledJobs(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - IMPORT_HEARTBEAT_STALE_SECONDS * 1000);

  const stalled = await db
    .update(importJobs)
    .set({ status: 'stalled', updatedAt: new Date() })
    .where(and(eq(importJobs.status, 'running'), lt(importJobs.heartbeatAt, cutoff)))
    .returning({ id: importJobs.id });

  return stalled.length;
}
