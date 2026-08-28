/**
 * Submitting code, running it, and reading the result back.
 *
 * ## The request path never calls the provider
 *
 * A submission writes a `queued` row and returns. Something else moves it to
 * `running`, and the client polls. That is the ticket's requirement, and the
 * reason survives the queue being cut: a request that waits on Judge0 holds a
 * serverless invocation open for as long as someone's infinite loop takes to be
 * killed.
 *
 * ## What C1 means here
 *
 * For an external-link problem, `expectedOutput` is **always null** — we do not
 * hold another platform's test cases and never will. The editor is a scratchpad
 * there: stdin in, output out, and no claim about correctness. The flag that
 * says so travels with the result, so no surface has to re-derive it.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { executionJobs, problems, runAttempts } from '@/server/db/schema';
import { checkExecutionLimits, type LimitVerdict } from './limits';
import { type ExecutionProvider, ProviderUnavailableError } from './provider';
import { LIVE_STATUSES, assertTransition } from './statemachine';
import type { ExecutionResultView } from '@/lib/execution/view';
import type { ExecutionLanguage } from './types';

/** A job whose heartbeat is older than this is treated as dead. */
export const EXECUTION_STALE_SECONDS = 120;

/** The seam a queue would sit behind. `enqueue` takes an id and nothing else. */
export interface ExecutionRunner {
  enqueue(jobId: string): Promise<void>;
}

export type SubmitResult =
  { ok: true; jobId: string } | { ok: false; limit: Extract<LimitVerdict, { allowed: false }> };

/**
 * What `getExecution` returns, and what the poll route sends over the wire.
 *
 * Declared in `lib/execution/view.ts` and re-exported here rather than written
 * out twice. The result panel cannot import from `server/` (F0.1), and two
 * hand-maintained copies of a shape that crosses the network is a drift waiting
 * for the day someone adds a field to one of them — the same reason the
 * reflection taxonomy is declared once (D21).
 */
export type ExecutionView = ExecutionResultView;

/**
 * Queue an execution, or explain why not.
 *
 * The limits are checked BEFORE the row is written, so a refused submission
 * leaves nothing behind — otherwise a user leaning on the button fills the
 * table with rows that exist only to be rejected, and those rows then count
 * against the very limit that rejected them.
 *
 * ## Why the whole thing takes a lock
 *
 * Check-then-insert is not atomic. Six submissions arriving together each read
 * a count of four and each decide they are the fifth, and the cap the ticket
 * asks to be enforced "under a parallel-submit test" is enforced under no
 * parallelism at all.
 *
 * A per-user advisory lock serialises exactly the users who are racing
 * themselves and nobody else. It is held for the transaction, which contains
 * one count and one insert — a lock this narrow costs less than the row it
 * protects.
 *
 * `hashtext` maps the uuid to the bigint the lock takes. Two users can collide
 * on that hash; the consequence is that one of them waits microseconds for the
 * other, which is not worth a wider key to avoid.
 */
export async function submitExecution(
  db: Database,
  input: {
    userId: string;
    problemId: string;
    sessionId?: string | null;
    language: ExecutionLanguage;
    source: string;
    stdin?: string | null;
    now: Date;
    runner: ExecutionRunner;
  },
): Promise<SubmitResult> {
  const outcome = await db.transaction(async (tx): Promise<SubmitResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);

    const limit = await checkExecutionLimits(tx, { userId: input.userId, now: input.now });
    if (!limit.allowed) return { ok: false, limit };

    const [job] = await tx
      .insert(executionJobs)
      .values({
        userId: input.userId,
        problemId: input.problemId,
        sessionId: input.sessionId ?? null,
        language: input.language,
        source: input.source,
        stdin: input.stdin ?? null,
        queuedAt: input.now,
        heartbeatAt: input.now,
      })
      .returning({ id: executionJobs.id });

    return { ok: true, jobId: job!.id };
  });

  // Outside the transaction: the runner must not start before the row it is
  // about to read has committed.
  if (outcome.ok) await input.runner.enqueue(outcome.jobId);

  return outcome;
}

/**
 * Run one queued job to completion.
 *
 * Exported so a test can await it: the runner below fires and forgets, which is
 * right for a request path and useless for an assertion.
 */
export async function runExecutionJob(
  db: Database,
  provider: ExecutionProvider,
  jobId: string,
  now: Date = new Date(),
): Promise<void> {
  const [job] = await db
    .select({
      id: executionJobs.id,
      userId: executionJobs.userId,
      problemId: executionJobs.problemId,
      sessionId: executionJobs.sessionId,
      status: executionJobs.status,
      language: executionJobs.language,
      source: executionJobs.source,
      stdin: executionJobs.stdin,
    })
    .from(executionJobs)
    .where(eq(executionJobs.id, jobId))
    .limit(1);

  if (!job) return;

  assertTransition(job.status, 'running');

  await db
    .update(executionJobs)
    .set({ status: 'running', startedAt: now, heartbeatAt: now, updatedAt: now })
    .where(and(eq(executionJobs.id, jobId), eq(executionJobs.status, 'queued')));

  try {
    const result = await provider.execute({
      language: job.language,
      source: job.source,
      stdin: job.stdin,
      /*
       * ALWAYS null, and today unconditionally so.
       *
       * C1 forbids holding another platform's test cases, so an external-link
       * problem can never have an expected output. And original problems —
       * which could — arrive with F4.1, which is cut, so the catalog contains
       * none. This is where their expected output would be read from if that
       * changes; until then a conditional here would be a branch nothing can
       * take, hiding the fact that comparison is impossible rather than
       * declaring it.
       */
      expectedOutput: null,
    });

    const finishedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(executionJobs)
        .set({
          status: 'completed',
          finishedAt,
          heartbeatAt: finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(executionJobs.id, jobId));

      await tx.insert(runAttempts).values({
        jobId,
        userId: job.userId,
        problemId: job.problemId,
        sessionId: job.sessionId,
        language: job.language,
        verdict: result.verdict,
        runtimeMs: result.runtimeMs,
        memoryKb: result.memoryKb,
        /*
         * Null for a scratchpad run, always. `0 / 0` reads as a failure rather
         * than as "there was nothing to check", and there never will be
         * anything to check for a problem hosted elsewhere.
         */
        testsPassed: null,
        testsTotal: null,
        stdout: result.stdout,
        stderr: result.stderr,
        compileOutput: result.compileOutput,
      });
    });
  } catch (error) {
    /*
     * The job failed; the code did not. No `run_attempts` row is written,
     * because a verdict would say something about the user's program that
     * nothing observed — and `internal_error` is a verdict, not an absence.
     */
    const finishedAt = new Date();
    const message =
      error instanceof ProviderUnavailableError
        ? error.message
        : 'The runner failed before your code could be executed.';

    await db
      .update(executionJobs)
      .set({
        status: 'failed',
        finishedAt,
        heartbeatAt: finishedAt,
        error: message,
        updatedAt: finishedAt,
      })
      .where(eq(executionJobs.id, jobId));

    if (!(error instanceof ProviderUnavailableError)) throw error;
  }
}

/**
 * What the polling endpoint returns.
 *
 * Scoped to the owner: another user's execution is a not-found, not a 403 —
 * the same rule F1.4 applies, for the same reason.
 */
export async function getExecution(
  db: Database,
  input: { userId: string; jobId: string },
): Promise<ExecutionView | null> {
  const [row] = await db
    .select({
      jobId: executionJobs.id,
      status: executionJobs.status,
      language: executionJobs.language,
      error: executionJobs.error,
      sourceType: problems.sourceType,
      verdict: runAttempts.verdict,
      runtimeMs: runAttempts.runtimeMs,
      memoryKb: runAttempts.memoryKb,
      testsPassed: runAttempts.testsPassed,
      testsTotal: runAttempts.testsTotal,
      stdout: runAttempts.stdout,
      stderr: runAttempts.stderr,
      compileOutput: runAttempts.compileOutput,
    })
    .from(executionJobs)
    .innerJoin(problems, eq(problems.id, executionJobs.problemId))
    .leftJoin(runAttempts, eq(runAttempts.jobId, executionJobs.id))
    .where(and(eq(executionJobs.id, input.jobId), eq(executionJobs.userId, input.userId)))
    .limit(1);

  if (!row) return null;

  return {
    jobId: row.jobId,
    status: row.status,
    language: row.language,
    scratchpad: row.sourceType === 'external_link',
    verdict: row.verdict,
    runtimeMs: row.runtimeMs,
    memoryKb: row.memoryKb,
    testsPassed: row.testsPassed,
    testsTotal: row.testsTotal,
    stdout: row.stdout,
    stderr: row.stderr,
    compileOutput: row.compileOutput,
    error: row.error,
  };
}

/**
 * The in-process runner.
 *
 * F1.2's shape exactly (D17): `enqueue` takes an id, the payload is already in
 * the database, and the work happens after the response has gone. Nothing
 * retries, and a process that dies mid-run leaves a row the sweep below can
 * find.
 */
export class InProcessExecutionRunner implements ExecutionRunner {
  constructor(
    private readonly db: Database,
    private readonly provider: ExecutionProvider,
  ) {}

  async enqueue(jobId: string): Promise<void> {
    setImmediate(() => {
      void runExecutionJob(this.db, this.provider, jobId).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: 'execution.job_failed',
            jobId,
            reason: error instanceof Error ? error.message : 'unknown',
          }),
        );
      });
    });
  }
}

/**
 * Mark executions whose runner went away.
 *
 * Detection only — nothing restarts them (D17). Without it a killed process
 * leaves a job at `running` forever, the UI polls a result nobody is producing,
 * and the row counts against the user's concurrency cap permanently. That last
 * consequence is the one that would lock someone out of the feature entirely.
 */
export async function sweepStalledExecutions(db: Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - EXECUTION_STALE_SECONDS * 1000);

  const swept = await db
    .update(executionJobs)
    .set({
      status: 'failed',
      finishedAt: now,
      error: 'The runner stopped responding. Your code may or may not have run.',
      updatedAt: now,
    })
    .where(
      and(
        inArray(executionJobs.status, [...LIVE_STATUSES]),
        lt(executionJobs.heartbeatAt, cutoff),
      ),
    )
    .returning({ id: executionJobs.id });

  return swept.length;
}
