/**
 * F1.2 · the ingest service's public surface.
 *
 * Route handlers call these; nothing above this layer touches the parser, the
 * runner or the tables directly.
 */
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { importJobs } from '@/server/db/schema';
import { type ParsedCsv, parseImportCsv } from './csv';
import { hashImportContent, importRows } from './import';
import { type JobRunner, getJobProgress, recordInvalidRows } from './jobs';
import { IMPORT_LIMITS } from './limits';

export * from './csv';
export * from './export';
export * from './import';
export * from './job-rows';
export * from './jobs';
export * from './limits';
export { normaliseProblemUrl } from './normalise-url';
export * from './spreadsheet-safety';

export type StartImportResult =
  | { mode: 'inline'; created: number; linked: number; duplicate: number; invalid: number }
  | { mode: 'job'; jobId: string; totalRows: number; alreadyRunning: boolean };

/**
 * Validate an upload and either import it inline or hand it to a runner.
 *
 * The threshold is the ticket's: over 100 rows becomes a background job. Below
 * it, a job row would be pure overhead — the work finishes faster than the
 * first poll would arrive.
 */
export async function startImport(
  db: Database,
  userId: string,
  file: { name: string; content: string | Buffer },
  runner: JobRunner,
): Promise<StartImportResult> {
  // Throws for size, row cap and missing columns — all before any row is
  // touched. See csv.ts.
  const parsed = await parseImportCsv(file.content);

  if (parsed.totalRows <= IMPORT_LIMITS.jobThresholdRows) {
    const results = await importRows(db, userId, parsed.valid);
    return {
      mode: 'inline',
      created: results.filter((row) => row.outcome === 'created').length,
      linked: results.filter((row) => row.outcome === 'linked').length,
      duplicate: results.filter((row) => row.outcome === 'duplicate').length,
      invalid: parsed.invalid.length,
    };
  }

  const contentHash = hashImportContent(file.content);

  /*
   * Job-level idempotency, before anything is enqueued.
   *
   * Re-uploading byte-identical content returns the EXISTING job rather than
   * starting a second one — which is what makes "re-running the same file
   * changes nothing" true at the job level and not only per row. The unique
   * index on (user_id, content_hash) is what makes the check safe against two
   * simultaneous uploads; this select is the fast path, the index is the
   * guarantee.
   */
  const [existing] = await db
    .select({ id: importJobs.id, totalRows: importJobs.totalRows })
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), eq(importJobs.contentHash, contentHash)))
    .limit(1);

  if (existing) {
    return {
      mode: 'job',
      jobId: existing.id,
      totalRows: existing.totalRows,
      alreadyRunning: true,
    };
  }

  const [job] = await db
    .insert(importJobs)
    .values({
      userId,
      filename: file.name,
      contentHash,
      // See the column comment: the runner gets an id and must be able to
      // recover the payload from the row alone.
      content: typeof file.content === 'string' ? file.content : file.content.toString('utf8'),
      totalRows: parsed.valid.length,
      invalidCount: parsed.invalid.length,
      status: 'pending',
    })
    .onConflictDoNothing({ target: [importJobs.userId, importJobs.contentHash] })
    .returning({ id: importJobs.id });

  if (!job) {
    // Lost the race to a simultaneous identical upload. Return theirs.
    const [raced] = await db
      .select({ id: importJobs.id, totalRows: importJobs.totalRows })
      .from(importJobs)
      .where(and(eq(importJobs.userId, userId), eq(importJobs.contentHash, contentHash)))
      .limit(1);

    if (!raced) throw new Error('startImport: job neither created nor found');
    return { mode: 'job', jobId: raced.id, totalRows: raced.totalRows, alreadyRunning: true };
  }

  // Row errors are persisted BEFORE the work starts, so a job that dies halfway
  // still carries the errors the user needs to fix their file.
  await recordInvalidRows(db, job.id, parsed.invalid);

  await runner.enqueue(job.id);

  return { mode: 'job', jobId: job.id, totalRows: parsed.valid.length, alreadyRunning: false };
}

/** Preview without committing: the per-row verdicts, nothing written. */
export async function previewImport(content: string | Buffer): Promise<ParsedCsv> {
  return parseImportCsv(content);
}

export { getJobProgress };
