/**
 * Reconstruct a job's validated rows from what the database holds.
 *
 * This is the function that makes `JobRunner.enqueue(jobId)` honest. A runner
 * receives an id and nothing else — under BullMQ that id crosses a process
 * boundary, so anything captured in a closure at enqueue time would be gone.
 * Everything needed to do the work has to be recoverable from the row.
 *
 * Re-parsing rather than storing parsed rows: the parse is deterministic, so
 * this yields exactly what `startImport` validated, and there is one
 * representation of the upload rather than two that can disagree.
 */
import { eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { importJobs } from '@/server/db/schema';
import { type ValidImportRow, parseImportCsv } from './csv';

export async function rowsForJob(
  db: Database,
  jobId: string,
): Promise<readonly ValidImportRow[]> {
  const [job] = await db
    .select({ content: importJobs.content })
    .from(importJobs)
    .where(eq(importJobs.id, jobId))
    .limit(1);

  if (!job) throw new Error(`rowsForJob: no job ${jobId}`);

  const parsed = await parseImportCsv(job.content);
  return parsed.valid;
}
