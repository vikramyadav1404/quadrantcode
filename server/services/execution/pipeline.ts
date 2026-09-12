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
import { executionJobs, problems, runAttempts, solveSessions } from '@/server/db/schema';
import { checkExecutionLimits, type LimitVerdict } from './limits';
import {
  ExecutionConfigurationError,
  type ExecutionProvider,
  ProviderUnavailableError,
  type ConfiguredExecutionBackend,
} from './provider';
import { LIVE_STATUSES } from './statemachine';
import type { ExecutionResultView } from '@/lib/execution/view';
import type { ExecutionLanguage } from './types';
import type { ExecutionMode } from '@/lib/native/constants';
import { executeNativeProblem, type NativeExecutionResult } from './native';
import type { ExecutionResult } from './provider';
import { applyVerifiedSubmissionEffectsTx } from './submission-effects';
import { recomputeStreak, type LocalDate } from '@/server/services/streak';
import { syncAssessmentAnswerForExecutionTx } from '@/server/services/assessments/scoring';
import { recordEvent } from '@/server/services/session';
import { assertFeatureEnabled } from '@/lib/flags';
import type { EnvSource } from '@/lib/env';
import {
  claimExecutionJob,
  failClaimedExecution,
  finalizeClaimedExecution,
  heartbeatExecutionJob,
  recordSandboxCleanup,
  recordSandboxCreated,
  retryClaimedExecution,
} from './claim';

/** A job whose heartbeat is older than this is treated as dead. */
export const EXECUTION_STALE_SECONDS = 120;

/** The seam a queue would sit behind. `enqueue` takes an id and nothing else. */
export interface ExecutionRunner {
  enqueue(jobId: string): Promise<void>;
}

export type SubmitResult =
  | { ok: true; jobId: string }
  | {
      ok: false;
      limit:
        | Extract<LimitVerdict, { allowed: false }>
        | { allowed: false; reason: 'invalid'; message: string; retryAt: null };
    };

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
    mode?: ExecutionMode;
    source: string;
    stdin?: string | null;
    now: Date;
    runner: ExecutionRunner;
    backend?: ConfiguredExecutionBackend | 'legacy';
    featureFlags?: EnvSource;
  },
): Promise<SubmitResult> {
  try {
    assertFeatureEnabled('FEATURE_EXECUTION', input.featureFlags ?? process.env);
  } catch {
    return invalidSubmission('Code execution is currently unavailable.');
  }

  const outcome = await db.transaction(async (tx): Promise<SubmitResult> => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('quadrantcode-execution-admission-v1'))`,
    );
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);

    const limit = await checkExecutionLimits(tx, { userId: input.userId, now: input.now });
    if (!limit.allowed) return { ok: false, limit };

    const [problem] = await tx
      .select({
        sourceType: problems.sourceType,
        currentVersion: problems.currentVersion,
        status: problems.status,
      })
      .from(problems)
      .where(eq(problems.id, input.problemId))
      .limit(1);

    if (!problem) {
      return invalidSubmission('No such problem.');
    }
    const mode = input.mode ?? 'run';
    if (mode !== 'run' && problem.sourceType === 'external_link') {
      return invalidSubmission('External problems can only use scratchpad Run.');
    }
    if (problem.sourceType === 'original' && problem.status !== 'published') {
      return invalidSubmission('This native problem is not published yet.');
    }

    if (input.sessionId) {
      const [ownedSession] = await tx
        .select({ id: solveSessions.id })
        .from(solveSessions)
        .where(
          and(
            eq(solveSessions.id, input.sessionId),
            eq(solveSessions.userId, input.userId),
            eq(solveSessions.problemId, input.problemId),
          ),
        )
        .limit(1);
      if (!ownedSession) return invalidSubmission('That solve session does not belong here.');
    }

    const [job] = await tx
      .insert(executionJobs)
      .values({
        userId: input.userId,
        problemId: input.problemId,
        sessionId: input.sessionId ?? null,
        language: input.language,
        mode,
        problemVersion: problem.currentVersion,
        source: input.source,
        stdin: input.stdin ?? null,
        queuedAt: input.now,
        heartbeatAt: input.now,
        nextAttemptAt: input.now,
        backend: input.backend ?? 'legacy',
      })
      .returning({ id: executionJobs.id });

    return { ok: true, jobId: job!.id };
  });

  // Outside the transaction: the runner must not start before the row it is
  // about to read has committed.
  if (outcome.ok) {
    try {
      await input.runner.enqueue(outcome.jobId);
    } catch {
      // The committed row is the outbox. Reconciliation will retry publishing.
    }
  }

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
): Promise<
  | { kind: 'completed' }
  | { kind: 'failed' }
  | { kind: 'retry'; afterSeconds: number }
  | { kind: 'noop' }
> {
  const started = Date.now();
  const clock = () => new Date(now.getTime() + Date.now() - started);
  const claim = await claimExecutionJob(db, jobId, now);
  if (claim.kind === 'retry') return { kind: 'retry', afterSeconds: claim.afterSeconds };
  if (claim.kind === 'noop') return { kind: 'noop' };

  const [job] = await db
    .select({
      id: executionJobs.id,
      userId: executionJobs.userId,
      problemId: executionJobs.problemId,
      sessionId: executionJobs.sessionId,
      status: executionJobs.status,
      language: executionJobs.language,
      mode: executionJobs.mode,
      problemVersion: executionJobs.problemVersion,
      source: executionJobs.source,
      stdin: executionJobs.stdin,
      backend: executionJobs.backend,
      sourceType: problems.sourceType,
    })
    .from(executionJobs)
    .innerJoin(problems, eq(problems.id, executionJobs.problemId))
    .where(eq(executionJobs.id, jobId))
    .limit(1);

  if (!job) return { kind: 'noop' };

  const lifecycle = {
    heartbeat: async () => heartbeatExecutionJob(db, jobId, claim.leaseToken, clock()),
    sandboxCreated: async (metadata: { name: string; expiresAt: Date | null }) =>
      recordSandboxCreated(db, {
        jobId,
        leaseToken: claim.leaseToken,
        ...metadata,
        now: clock(),
      }),
    cleanupFinished: async (confirmed: boolean) =>
      recordSandboxCleanup(db, {
        jobId,
        leaseToken: claim.leaseToken,
        confirmed,
        now: clock(),
      }),
  };

  let heartbeatFailure: unknown;
  let heartbeatPending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = lifecycle
      .heartbeat()
      .catch((error) => {
        heartbeatFailure = error;
      })
      .finally(() => {
        heartbeatPending = undefined;
      });
  }, 15_000);
  timer.unref();

  try {
    const expectedProvider =
      job.backend === 'vercel_sandbox'
        ? 'vercel-sandbox'
        : job.backend === 'judge0'
          ? 'judge0'
          : job.backend === 'fake'
            ? 'fake'
            : null;
    if (expectedProvider && provider.name !== expectedProvider) {
      throw new ExecutionConfigurationError('The configured execution backend changed.');
    }

    const result =
      job.sourceType === 'original'
        ? await executeNativeProblem(db, provider, {
            problemId: job.problemId,
            problemVersion: job.problemVersion,
            language: job.language,
            mode: job.mode,
            source: job.source,
            stdin: job.stdin,
            lifecycle,
          })
        : await provider.execute({
            language: job.language,
            source: job.source,
            stdin: job.stdin,
            // External-link problems are scratchpads; C1 forbids stored tests.
            expectedOutput: null,
            lifecycle,
          });

    await heartbeatPending;
    if (heartbeatFailure) throw heartbeatFailure;
    const finishedAt = clock();
    const nativeResult = isNativeExecutionResult(result) ? result : null;
    const attempt: typeof runAttempts.$inferInsert = {
      jobId,
      userId: job.userId,
      problemId: job.problemId,
      sessionId: job.sessionId,
      language: job.language,
      verdict: result.verdict,
      serverVerified: provider.executes,
      serverVerifiedAt: provider.executes ? finishedAt : null,
      providerName: provider.executes ? provider.name : null,
      compilerRuntimeVersion: result.compilerRuntimeVersion,
      runtimeMs: result.runtimeMs,
      memoryKb: result.memoryKb,
      testsPassed: nativeResult?.testsPassed ?? null,
      testsTotal: nativeResult?.testsTotal ?? null,
      testResults: nativeResult?.testResults ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
      compileOutput: result.compileOutput,
    };
    let streakDate: LocalDate | null = null;
    const finalized = await finalizeClaimedExecution(db, {
      jobId,
      leaseToken: claim.leaseToken,
      finishedAt,
      attempt,
      applyEffects: async (tx) => {
        /*
         * A timeline run event belongs beside the attempt that proves the run
         * completed. Recording it at queue time would claim an abandoned or
         * provider-failed job actually ran; recording it only for native Submit
         * made ordinary scratchpad Run disappear from session history.
         */
        if (job.sessionId) {
          await recordEvent(tx, {
            sessionId: job.sessionId,
            type: 'run_attempted',
            occurredAt: finishedAt,
            payload: {
              mode: job.mode,
              verdict: result.verdict,
              serverVerified: provider.executes,
            },
          });
        }

        if (provider.executes && job.mode === 'assessment') {
          await syncAssessmentAnswerForExecutionTx(tx, {
            executionJobId: jobId,
            verdict: result.verdict,
            now: finishedAt,
          });
        }

        if (provider.executes && job.mode === 'submit') {
          const effect = await applyVerifiedSubmissionEffectsTx(tx, {
            userId: job.userId,
            problemId: job.problemId,
            sessionId: job.sessionId,
            verdict: result.verdict,
            runtimeMs: result.runtimeMs,
            now: finishedAt,
          });
          streakDate = effect.streakDate;
        }
      },
    });

    if (finalized === 'stale') return { kind: 'retry', afterSeconds: 5 };
    if (finalized === 'duplicate') return { kind: 'noop' };

    if (streakDate) {
      try {
        await recomputeStreak(db, job.userId, streakDate);
      } catch {
        console.error(
          JSON.stringify({
            event: 'execution.streak_recompute_failed',
            jobId,
            reason: 'STREAK_RECOMPUTE_FAILED',
          }),
        );
      }
    }
    return { kind: 'completed' };
  } catch (error) {
    if (error instanceof ExecutionConfigurationError) {
      await failClaimedExecution(db, {
        jobId,
        leaseToken: claim.leaseToken,
        code: error.code,
        message: error.message,
      });
      return { kind: 'failed' };
    }

    const code =
      error instanceof ProviderUnavailableError ? error.code : 'EXECUTION_WORKER_ERROR';
    const retry = await retryClaimedExecution(db, {
      jobId,
      leaseToken: claim.leaseToken,
      attempt: claim.attempt,
      code,
      now: clock(),
    });
    if (retry.terminal) return { kind: 'failed' };
    if (retry.afterSeconds !== null) return { kind: 'retry', afterSeconds: retry.afterSeconds };
    return { kind: 'noop' };
  } finally {
    clearInterval(timer);
    await heartbeatPending;
  }
}

function invalidSubmission(message: string): Extract<SubmitResult, { ok: false }> {
  return { ok: false, limit: { allowed: false, reason: 'invalid', message, retryAt: null } };
}

function isNativeExecutionResult(result: ExecutionResult): result is NativeExecutionResult {
  return (
    'testsPassed' in result &&
    typeof result.testsPassed === 'number' &&
    'testsTotal' in result &&
    typeof result.testsTotal === 'number' &&
    'testResults' in result &&
    Array.isArray(result.testResults)
  );
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
      mode: executionJobs.mode,
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
      compilerRuntimeVersion: runAttempts.compilerRuntimeVersion,
      testResults: runAttempts.testResults,
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
    mode: row.mode,
    scratchpad: row.sourceType === 'external_link',
    verdict: row.verdict,
    runtimeMs: row.runtimeMs,
    memoryKb: row.memoryKb,
    testsPassed: row.testsPassed,
    testsTotal: row.testsTotal,
    stdout: row.stdout,
    stderr: row.stderr,
    compileOutput: row.compileOutput,
    compilerRuntimeVersion: row.compilerRuntimeVersion,
    testResults: sanitizeTestResults(row.testResults),
    error: row.error,
  };
}

/** Defense in depth: even a malformed stored hidden result cannot expose values. */
function sanitizeTestResults(
  results: typeof runAttempts.$inferSelect.testResults,
): NonNullable<ExecutionView['testResults']> | null {
  if (!results) return null;
  return results.map((result) =>
    result.visibility === 'hidden'
      ? {
          ordinal: result.ordinal,
          visibility: 'hidden',
          verdict: result.verdict,
          runtimeMs: result.runtimeMs,
          memoryKb: result.memoryKb,
        }
      : result,
  );
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
        eq(executionJobs.backend, 'legacy'),
        inArray(executionJobs.status, [...LIVE_STATUSES]),
        lt(executionJobs.heartbeatAt, cutoff),
      ),
    )
    .returning({ id: executionJobs.id });

  return swept.length;
}
