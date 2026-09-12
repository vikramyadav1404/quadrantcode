/**
 * F1.2 · the job seam.
 *
 * The criterion is "a 500-row file runs as a job with visible progress and does
 * not block the request". Three separate claims, and the middle one is the easy
 * one to fake: a job that sets `processed_rows` from 0 to 500 in a single step
 * at the end also ends up "showing progress" if you only look at the final row.
 * So progress is sampled DURING the run and asserted to be strictly increasing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseImportCsv } from '@/server/services/ingest/csv';
import {
  InProcessJobRunner,
  type JobRunner,
  getJobProgress,
  processImportJob,
  sweepStalledJobs,
} from '@/server/services/ingest/jobs';
import { rowsForJob } from '@/server/services/ingest/job-rows';
import { startImport } from '@/server/services/ingest';
import { IMPORT_LIMITS } from '@/server/services/ingest/limits';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const HEADER = 'title,platform,url,difficulty,topic';

function bigCsv(count: number, prefix = 'p'): string {
  const rows = Array.from(
    { length: count },
    (_, index) =>
      `Problem ${index},leetcode,https://leetcode.com/problems/${prefix}-${index}/,easy,arrays`,
  );
  return [HEADER, ...rows].join('\n');
}

/** Records what it was asked to run without running it. */
class RecordingRunner implements JobRunner {
  readonly enqueued: string[] = [];
  async enqueue(jobId: string): Promise<void> {
    this.enqueued.push(jobId);
  }
}

suite('F1.2 · startImport — inline vs job', () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'jobs@example.com' })).id;
  });

  it('imports a small file INLINE, creating no job row', async () => {
    const runner = new RecordingRunner();
    const result = await startImport(
      ctx.db,
      userId,
      { name: 'small.csv', content: bigCsv(10) },
      runner,
    );

    expect(result.mode).toBe('inline');
    expect(runner.enqueued).toEqual([]);
    expect(await ctx.sql`SELECT id FROM import_jobs`).toHaveLength(0);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(10);
  });

  it('hands a 500-row file to the runner WITHOUT importing it first', async () => {
    /*
     * "Does not block the request", asserted as the thing it actually means:
     * startImport returns having written a job row and enqueued it, and the
     * problems table is still empty because no row has been imported yet.
     */
    const runner = new RecordingRunner();
    const result = await startImport(
      ctx.db,
      userId,
      { name: 'big.csv', content: bigCsv(500) },
      runner,
    );

    expect(result.mode).toBe('job');
    if (result.mode !== 'job') throw new Error('unreachable');

    expect(result.totalRows).toBe(500);
    expect(runner.enqueued).toEqual([result.jobId]);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(0);
  });

  it('re-uploading the same bytes returns the SAME job', async () => {
    // Deterministic idempotency key, per the standing rule for background jobs.
    const runner = new RecordingRunner();
    const content = bigCsv(200);

    const first = await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    const second = await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);

    if (first.mode !== 'job' || second.mode !== 'job') throw new Error('expected jobs');
    expect(second.jobId).toBe(first.jobId);
    expect(second.alreadyRunning).toBe(true);

    // One job row, and enqueued once — the job is fresh, so the resume path
    // below deliberately does not fire.
    expect(runner.enqueued).toEqual([first.jobId]);
    expect(await ctx.sql`SELECT id FROM import_jobs`).toHaveLength(1);
  });

  it('RE-UPLOADING A DEAD JOB RESUMES IT — the only recovery path there is', async () => {
    /*
     * With F2.3 cut there is no queue to retry anything, so this IS the
     * recovery mechanism and /settings/import tells the user to use it. It used
     * to be a false promise: the upload returned the stalled job and enqueued
     * nothing.
     */
    const runner = new RecordingRunner();
    const content = bigCsv(200, 'resume');

    const first = await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    if (first.mode !== 'job') throw new Error('expected a job');

    // The runner's process "dies": the job is left stalled.
    await ctx.sql`UPDATE import_jobs SET status = 'stalled' WHERE id = ${first.jobId}`;

    const second = await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    if (second.mode !== 'job') throw new Error('expected a job');

    expect(second.jobId).toBe(first.jobId);
    expect(second.alreadyRunning).toBe(false);
    expect(runner.enqueued).toEqual([first.jobId, first.jobId]);

    const [row] = await ctx.sql`SELECT status FROM import_jobs WHERE id = ${first.jobId}`;
    expect(row!.status).toBe('pending');
  });

  it('does NOT re-enqueue a job that is genuinely running', async () => {
    // The positive control for the branch above. Re-enqueueing a live job would
    // put two runners on it — idempotent, but wasteful and hard to reason about.
    const runner = new RecordingRunner();
    const content = bigCsv(200, 'live');

    const first = await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    if (first.mode !== 'job') throw new Error('expected a job');
    await ctx.sql`UPDATE import_jobs SET status = 'running' WHERE id = ${first.jobId}`;

    const second = await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    if (second.mode !== 'job') throw new Error('expected a job');

    expect(second.alreadyRunning).toBe(true);
    expect(runner.enqueued).toEqual([first.jobId]);
  });

  it('does not re-enqueue a FRESH pending job, but does an abandoned one', async () => {
    /*
     * A job is `pending` for the milliseconds between being written and being
     * picked up, so a double-clicked upload must not spawn a second runner. But
     * a pending job that has SAT there was enqueued into a process that died
     * before starting it — and the stall sweep only looks at `running` rows, so
     * nothing else would ever notice.
     */
    const runner = new RecordingRunner();
    const content = bigCsv(200, 'pending');

    const first = await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    if (first.mode !== 'job') throw new Error('expected a job');

    // Fresh: not re-enqueued.
    await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    expect(runner.enqueued).toEqual([first.jobId]);

    // Aged out: re-enqueued.
    await ctx.sql`
      UPDATE import_jobs SET created_at = now() - interval '1 hour' WHERE id = ${first.jobId}
    `;
    await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    expect(runner.enqueued).toEqual([first.jobId, first.jobId]);
  });

  it('a DIFFERENT file from the same user is a different job', async () => {
    // The positive control for the hash: if it keyed on the user alone, this
    // would collapse into one job and the second import would never run.
    const runner = new RecordingRunner();
    await startImport(ctx.db, userId, { name: 'a.csv', content: bigCsv(200, 'a') }, runner);
    await startImport(ctx.db, userId, { name: 'b.csv', content: bigCsv(200, 'b') }, runner);

    expect(await ctx.sql`SELECT id FROM import_jobs`).toHaveLength(2);
    expect(runner.enqueued).toHaveLength(2);
  });

  it('two users uploading the SAME file get their own jobs', async () => {
    const runner = new RecordingRunner();
    const other = await createUser(ctx.db, { email: 'other-job@example.com' });
    const content = bigCsv(200);

    await startImport(ctx.db, userId, { name: 'a.csv', content }, runner);
    await startImport(ctx.db, other.id, { name: 'a.csv', content }, runner);

    expect(await ctx.sql`SELECT id FROM import_jobs`).toHaveLength(2);
  });

  it('persists row errors BEFORE the work starts', async () => {
    /*
     * A job that dies halfway must still carry the errors the user needs to fix
     * their file. Asserted with the runner deliberately not running anything.
     */
    const runner = new RecordingRunner();
    const rows = Array.from(
      { length: 150 },
      (_, index) => `P${index},leetcode,https://leetcode.com/problems/x-${index}/,easy,`,
    );
    rows.push(',leetcode,https://leetcode.com/problems/bad/,easy,'); // no title

    await startImport(
      ctx.db,
      userId,
      { name: 'mixed.csv', content: [HEADER, ...rows].join('\n') },
      runner,
    );

    const errors = await ctx.sql`
      SELECT row_number, error, error_field FROM import_job_rows WHERE outcome = 'invalid'
    `;
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error_field).toBe('title');
  });
});

suite('F1.2 · processImportJob', () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'runner@example.com' })).id;
  });

  async function createJob(content: string) {
    const runner = new RecordingRunner();
    const result = await startImport(ctx.db, userId, { name: 'j.csv', content }, runner);
    if (result.mode !== 'job') throw new Error('expected a job');
    const parsed = await parseImportCsv(content);
    return { jobId: result.jobId, rows: parsed.valid };
  }

  it('processes every row and reports succeeded', async () => {
    const { jobId, rows } = await createJob(bigCsv(250));
    await processImportJob(ctx.db, jobId, rows);

    const progress = await getJobProgress(ctx.db, jobId, userId);
    expect(progress?.status).toBe('succeeded');
    expect(progress?.processedRows).toBe(250);
    expect(progress?.createdCount).toBe(250);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(250);
  });

  it('advances progress INCREMENTALLY, not in one jump at the end', async () => {
    /*
     * The claim "visible progress" is the one that fakes most easily: a job
     * that writes processed_rows once at the end looks identical if you only
     * read the final row. So poll while it runs and require at least two
     * distinct intermediate values, strictly increasing.
     */
    const { jobId, rows } = await createJob(bigCsv(500));

    const samples: number[] = [];
    const poller = setInterval(() => {
      void getJobProgress(ctx.db, jobId, userId).then((progress) => {
        if (progress) samples.push(progress.processedRows);
      });
    }, 5);

    await processImportJob(ctx.db, jobId, rows);
    clearInterval(poller);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const distinct = [...new Set(samples)].sort((a, b) => a - b);
    expect(
      distinct.length,
      `progress only ever read as ${JSON.stringify(distinct)} — did it advance per chunk?`,
    ).toBeGreaterThan(1);

    // Monotonic: the watermark must never go backwards.
    expect(distinct).toEqual([...distinct].sort((a, b) => a - b));

    // And it advances by the chunk size, which is what makes resume safe.
    expect(distinct.some((value) => value > 0 && value % IMPORT_LIMITS.chunkRows === 0)).toBe(
      true,
    );
  });

  it('reports PARTIAL when some rows were invalid', async () => {
    // "Succeeded" over a file that dropped rows is the green that hides a
    // problem.
    const rows = Array.from(
      { length: 150 },
      (_, index) => `P${index},leetcode,https://leetcode.com/problems/y-${index}/,easy,`,
    );
    rows.push('No URL,leetcode,,easy,');

    const { jobId, rows: valid } = await createJob([HEADER, ...rows].join('\n'));
    await processImportJob(ctx.db, jobId, valid);

    const progress = await getJobProgress(ctx.db, jobId, userId);
    expect(progress?.status).toBe('partial');
    expect(progress?.invalidCount).toBe(1);
  });

  it('resumes from the watermark rather than redoing the whole file', async () => {
    /*
     * Simulates a job killed mid-run: set the watermark as if two chunks were
     * done, then process. The rows for those chunks are already imported, so a
     * naive restart would still be CORRECT (import is idempotent) but would
     * double the work. This asserts it skips them.
     */
    const { jobId, rows } = await createJob(bigCsv(300));

    // Do the first 100 for real, then pretend the process died.
    await processImportJob(ctx.db, jobId, rows.slice(0, 100));
    await ctx.sql`
      UPDATE import_jobs SET status = 'running', processed_rows = 100, finished_at = NULL
      WHERE id = ${jobId}
    `;

    await processImportJob(ctx.db, jobId, rows);

    const progress = await getJobProgress(ctx.db, jobId, userId);
    expect(progress?.processedRows).toBe(300);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(300);
    // No row counted twice.
    expect(await ctx.sql`SELECT id FROM user_problems`).toHaveLength(300);
  });

  it('the runner completes a job knowing ONLY its id', async () => {
    /*
     * The proof that the seam is real rather than a shape.
     *
     * `JobRunner.enqueue(jobId)` takes an id and nothing else, which is only
     * workable if everything needed to do the work is recoverable from the
     * database. My first version stored no payload — it would have worked in
     * process, where the parsed rows could sit in a closure, and failed the
     * moment F2.3 sent that id to a BullMQ worker across a process boundary.
     * The seam would have been a fiction that held right up until it mattered.
     *
     * So: hand the runner an id, give it nothing else, and require the import
     * to finish.
     */
    const runner = new InProcessJobRunner(ctx.db, (id) => rowsForJob(ctx.db, id));
    const result = await startImport(
      ctx.db,
      userId,
      { name: 'seam.csv', content: bigCsv(150, 'seam') },
      runner,
    );
    if (result.mode !== 'job') throw new Error('expected a job');

    // The runner schedules and returns; poll for the outcome.
    const deadline = Date.now() + 20_000;
    let progress = await getJobProgress(ctx.db, result.jobId, userId);
    while (Date.now() < deadline && progress?.status !== 'succeeded') {
      await new Promise((resolve) => setTimeout(resolve, 100));
      progress = await getJobProgress(ctx.db, result.jobId, userId);
      if (progress?.status === 'failed') break;
    }

    expect(progress?.status, `job ended as ${progress?.status}: ${progress?.error}`).toBe(
      'succeeded',
    );
    expect(progress?.processedRows).toBe(150);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(150);
  });

  it('rowsForJob reconstructs exactly what startImport validated', async () => {
    // Re-parsing is deterministic, which is why the payload is stored as raw
    // text rather than as a second, parsed representation that could disagree.
    const content = bigCsv(150, 'recon');
    const { jobId, rows } = await createJob(content);

    const recovered = await rowsForJob(ctx.db, jobId);
    expect(recovered).toEqual(rows);
  });

  it('records a failure on the row rather than only throwing', async () => {
    const { jobId } = await createJob(bigCsv(150));

    // A row referencing a user that no longer exists forces a foreign-key
    // failure inside the chunk.
    await ctx.sql`DELETE FROM users WHERE id = ${userId}`;

    await expect(processImportJob(ctx.db, jobId, [])).rejects.toThrow();
  });
});

suite('F1.2 · sweepStalledJobs', () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'stall@example.com' })).id;
  });

  /**
   * The heartbeat age is computed in SQL rather than passed as a JS `Date`.
   *
   * A `Date` arriving through a `null | Date` ternary gave postgres.js no type
   * to infer and it threw before reaching the database. `make_interval` also
   * anchors the age to the DATABASE's clock, which is the clock the sweep
   * compares against — passing a JS Date would make the test sensitive to any
   * skew between the two.
   */
  async function insertJob(status: string, heartbeatAgoSeconds: number) {
    const [row] = await ctx.sql`
      INSERT INTO import_jobs
        (user_id, filename, content_hash, content, status, total_rows, heartbeat_at)
      VALUES (
        ${userId}, 'x.csv', ${Math.random().toString(36).slice(2)}, ${HEADER},
        ${status}::import_job_status, 10,
        now() - make_interval(secs => ${heartbeatAgoSeconds})
      )
      RETURNING id
    `;
    return row!.id as string;
  }

  it('marks a running job whose heartbeat went quiet', async () => {
    const stalled = await insertJob('running', 600);
    expect(await sweepStalledJobs(ctx.db)).toBe(1);

    const [row] = await ctx.sql`SELECT status FROM import_jobs WHERE id = ${stalled}`;
    expect(row!.status).toBe('stalled');
  });

  it('leaves a job that is merely slow alone', async () => {
    // The positive control. A sweep that marked everything running would pass
    // the test above while breaking every real import.
    const healthy = await insertJob('running', 5);
    expect(await sweepStalledJobs(ctx.db)).toBe(0);

    const [row] = await ctx.sql`SELECT status FROM import_jobs WHERE id = ${healthy}`;
    expect(row!.status).toBe('running');
  });

  it('does not touch finished jobs', async () => {
    await insertJob('succeeded', 9999);
    await insertJob('failed', 9999);
    expect(await sweepStalledJobs(ctx.db)).toBe(0);
  });

  it('also catches a PENDING job that never started', async () => {
    /*
     * The gap the re-upload path exposed: a pending job has no heartbeat to go
     * stale, so a sweep looking only at `running` rows would leave it invisible
     * forever.
     */
    const [row] = await ctx.sql`
      INSERT INTO import_jobs
        (user_id, filename, content_hash, content, status, total_rows, created_at)
      VALUES (
        ${userId}, 'x.csv', ${Math.random().toString(36).slice(2)}, ${HEADER},
        'pending', 10, now() - interval '1 hour'
      )
      RETURNING id
    `;

    expect(await sweepStalledJobs(ctx.db)).toBe(1);
    const [after] = await ctx.sql`SELECT status FROM import_jobs WHERE id = ${row!.id}`;
    expect(after!.status).toBe('stalled');
  });

  it('leaves a FRESH pending job alone', async () => {
    // Positive control: every new job is pending for a moment.
    await ctx.sql`
      INSERT INTO import_jobs
        (user_id, filename, content_hash, content, status, total_rows)
      VALUES (${userId}, 'x.csv', ${Math.random().toString(36).slice(2)}, ${HEADER}, 'pending', 10)
    `;
    expect(await sweepStalledJobs(ctx.db)).toBe(0);
  });
});

suite('F1.2 · getJobProgress is scoped to the owner', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it("returns null for another user's job", async () => {
    // A uuid is unguessable, which is not an authorisation model.
    await truncateAll(ctx.sql);
    const owner = await createUser(ctx.db, { email: 'owner@example.com' });
    const stranger = await createUser(ctx.db, { email: 'stranger@example.com' });

    const result = await startImport(
      ctx.db,
      owner.id,
      { name: 'a.csv', content: bigCsv(200) },
      new RecordingRunner(),
    );
    if (result.mode !== 'job') throw new Error('expected a job');

    expect(await getJobProgress(ctx.db, result.jobId, owner.id)).not.toBeNull();
    expect(await getJobProgress(ctx.db, result.jobId, stranger.id)).toBeNull();
  });
});
