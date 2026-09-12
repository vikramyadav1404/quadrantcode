import { randomUUID } from 'node:crypto';
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { executionJobs, runAttempts } from '@/server/db/schema';
import { GLOBAL_SANDBOX_CONCURRENCY } from './limits';

export const EXECUTION_LEASE_SECONDS = 75;
export const MAX_EXECUTION_ATTEMPTS = 3;

export type ClaimResult =
  | { kind: 'claimed'; leaseToken: string; attempt: number }
  | { kind: 'retry'; afterSeconds: number; reason: 'leased' | 'capacity' | 'not_due' }
  | { kind: 'noop'; reason: 'missing' | 'terminal' | 'attempts_exhausted' };

export class RetryableExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly afterSeconds: number,
  ) {
    super('Execution infrastructure is temporarily unavailable.');
    this.name = 'RetryableExecutionError';
  }
}

const leaseEnd = (now: Date) => new Date(now.getTime() + EXECUTION_LEASE_SECONDS * 1_000);

/** Claim one job under a row lock and a shared database capacity lock. */
export async function claimExecutionJob(
  db: Database,
  jobId: string,
  now: Date = new Date(),
): Promise<ClaimResult> {
  return db.transaction(async (tx): Promise<ClaimResult> => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('quadrantcode-execution-capacity-v1'))`,
    );

    const [job] = await tx
      .select({
        status: executionJobs.status,
        attemptCount: executionJobs.attemptCount,
        nextAttemptAt: executionJobs.nextAttemptAt,
        leaseExpiresAt: executionJobs.leaseExpiresAt,
        startedAt: executionJobs.startedAt,
        cleanupPending: executionJobs.cleanupPending,
        sandboxExpiresAt: executionJobs.sandboxExpiresAt,
      })
      .from(executionJobs)
      .where(eq(executionJobs.id, jobId))
      .limit(1)
      .for('update');

    if (!job) return { kind: 'noop', reason: 'missing' };
    if (job.status === 'completed' || job.status === 'failed') {
      return { kind: 'noop', reason: 'terminal' };
    }
    if (job.cleanupPending && (!job.sandboxExpiresAt || job.sandboxExpiresAt > now)) {
      return {
        kind: 'retry',
        reason: 'leased',
        afterSeconds: job.sandboxExpiresAt
          ? Math.max(1, Math.ceil((job.sandboxExpiresAt.getTime() - now.getTime()) / 1_000))
          : 60,
      };
    }
    if (job.status === 'running' && job.leaseExpiresAt && job.leaseExpiresAt > now) {
      return {
        kind: 'retry',
        reason: 'leased',
        afterSeconds: Math.max(
          1,
          Math.ceil((job.leaseExpiresAt.getTime() - now.getTime()) / 1_000),
        ),
      };
    }
    if (job.status === 'queued' && job.nextAttemptAt > now) {
      return {
        kind: 'retry',
        reason: 'not_due',
        afterSeconds: Math.max(
          1,
          Math.ceil((job.nextAttemptAt.getTime() - now.getTime()) / 1_000),
        ),
      };
    }
    if (job.attemptCount >= MAX_EXECUTION_ATTEMPTS) {
      await tx
        .update(executionJobs)
        .set({
          status: 'failed',
          finishedAt: now,
          heartbeatAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: 'EXECUTION_ATTEMPTS_EXHAUSTED',
          error: 'Execution infrastructure could not complete this run after several attempts.',
          updatedAt: now,
        })
        .where(eq(executionJobs.id, jobId));
      return { kind: 'noop', reason: 'attempts_exhausted' };
    }

    const active = await tx
      .select({ id: executionJobs.id })
      .from(executionJobs)
      .where(
        and(
          or(
            and(eq(executionJobs.status, 'running'), gt(executionJobs.leaseExpiresAt, now)),
            and(
              eq(executionJobs.cleanupPending, true),
              or(
                isNull(executionJobs.sandboxExpiresAt),
                gt(executionJobs.sandboxExpiresAt, now),
              ),
            ),
          ),
          ne(executionJobs.id, jobId),
        ),
      )
      .limit(GLOBAL_SANDBOX_CONCURRENCY);
    if (active.length >= GLOBAL_SANDBOX_CONCURRENCY) {
      return { kind: 'retry', reason: 'capacity', afterSeconds: 5 };
    }

    const leaseToken = randomUUID();
    const attempt = job.attemptCount + 1;
    await tx
      .update(executionJobs)
      .set({
        status: 'running',
        attemptCount: attempt,
        startedAt: job.startedAt ?? now,
        heartbeatAt: now,
        leaseToken,
        leaseExpiresAt: leaseEnd(now),
        lastErrorCode: null,
        error: null,
        sandboxName: null,
        sandboxExpiresAt: null,
        cleanupPending: false,
        updatedAt: now,
      })
      .where(eq(executionJobs.id, jobId));

    return { kind: 'claimed', leaseToken, attempt };
  });
}

/** Extend a lease only when this exact worker still owns it. */
export async function heartbeatExecutionJob(
  db: Database,
  jobId: string,
  leaseToken: string,
  now: Date = new Date(),
): Promise<void> {
  const rows = await db
    .update(executionJobs)
    .set({ heartbeatAt: now, leaseExpiresAt: leaseEnd(now), updatedAt: now })
    .where(
      and(
        eq(executionJobs.id, jobId),
        eq(executionJobs.status, 'running'),
        eq(executionJobs.leaseToken, leaseToken),
        gt(executionJobs.leaseExpiresAt, now),
      ),
    )
    .returning({ id: executionJobs.id });
  if (rows.length !== 1) throw new RetryableExecutionError('LEASE_LOST', 5);
}

export async function recordSandboxCreated(
  db: Database,
  input: {
    jobId: string;
    leaseToken: string;
    name: string;
    expiresAt: Date | null;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const rows = await db
    .update(executionJobs)
    .set({
      sandboxName: input.name,
      sandboxExpiresAt: input.expiresAt,
      cleanupPending: true,
      heartbeatAt: now,
      leaseExpiresAt: leaseEnd(now),
      updatedAt: now,
    })
    .where(
      and(
        eq(executionJobs.id, input.jobId),
        eq(executionJobs.status, 'running'),
        eq(executionJobs.leaseToken, input.leaseToken),
        gt(executionJobs.leaseExpiresAt, now),
      ),
    )
    .returning({ id: executionJobs.id });
  if (rows.length !== 1) throw new RetryableExecutionError('LEASE_LOST', 5);
}

export async function recordSandboxCleanup(
  db: Database,
  input: { jobId: string; leaseToken: string; confirmed: boolean; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(executionJobs)
    .set({ cleanupPending: !input.confirmed, updatedAt: now })
    .where(
      and(
        eq(executionJobs.id, input.jobId),
        eq(executionJobs.status, 'running'),
        eq(executionJobs.leaseToken, input.leaseToken),
      ),
    );
}

export async function retryClaimedExecution(
  db: Database,
  input: { jobId: string; leaseToken: string; attempt: number; code: string; now?: Date },
): Promise<{ terminal: boolean; afterSeconds: number | null }> {
  const now = input.now ?? new Date();
  const terminal = input.attempt >= MAX_EXECUTION_ATTEMPTS;
  const [job] = await db
    .select({
      cleanupPending: executionJobs.cleanupPending,
      sandboxExpiresAt: executionJobs.sandboxExpiresAt,
    })
    .from(executionJobs)
    .where(
      and(
        eq(executionJobs.id, input.jobId),
        eq(executionJobs.status, 'running'),
        eq(executionJobs.leaseToken, input.leaseToken),
      ),
    )
    .limit(1);
  const platformCleanupDelay =
    job?.cleanupPending && job.sandboxExpiresAt
      ? Math.max(0, Math.ceil((job.sandboxExpiresAt.getTime() - now.getTime()) / 1_000))
      : 0;
  const afterSeconds = Math.max(input.attempt === 1 ? 15 : 60, platformCleanupDelay);
  const rows = await db
    .update(executionJobs)
    .set(
      terminal
        ? {
            status: 'failed',
            finishedAt: now,
            heartbeatAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: input.code,
            error:
              'Execution infrastructure could not complete this run after several attempts.',
            updatedAt: now,
          }
        : {
            status: 'queued',
            heartbeatAt: now,
            nextAttemptAt: new Date(now.getTime() + afterSeconds * 1_000),
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: input.code,
            error: null,
            updatedAt: now,
          },
    )
    .where(
      and(
        eq(executionJobs.id, input.jobId),
        eq(executionJobs.status, 'running'),
        eq(executionJobs.leaseToken, input.leaseToken),
      ),
    )
    .returning({ id: executionJobs.id });

  if (rows.length !== 1) return { terminal: false, afterSeconds: null };
  return { terminal, afterSeconds: terminal ? null : afterSeconds };
}

export async function failClaimedExecution(
  db: Database,
  input: { jobId: string; leaseToken: string; code: string; message: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(executionJobs)
    .set({
      status: 'failed',
      finishedAt: now,
      heartbeatAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: input.code,
      error: input.message,
      updatedAt: now,
    })
    .where(
      and(
        eq(executionJobs.id, input.jobId),
        eq(executionJobs.status, 'running'),
        eq(executionJobs.leaseToken, input.leaseToken),
      ),
    );
}

export async function failQueuedExecution(
  db: Database,
  input: { jobId: string; code: string; message: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(executionJobs)
    .set({
      status: 'failed',
      finishedAt: now,
      heartbeatAt: now,
      lastErrorCode: input.code,
      error: input.message,
      updatedAt: now,
    })
    .where(and(eq(executionJobs.id, input.jobId), eq(executionJobs.status, 'queued')));
}

export async function finalizeClaimedExecution(
  db: Database,
  input: {
    jobId: string;
    leaseToken: string;
    finishedAt: Date;
    attempt: typeof runAttempts.$inferInsert;
    applyEffects(tx: Transaction): Promise<void>;
  },
): Promise<'completed' | 'stale' | 'duplicate'> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({
        status: executionJobs.status,
        leaseToken: executionJobs.leaseToken,
        leaseExpiresAt: executionJobs.leaseExpiresAt,
        cleanupPending: executionJobs.cleanupPending,
      })
      .from(executionJobs)
      .where(eq(executionJobs.id, input.jobId))
      .limit(1)
      .for('update');
    if (
      !job ||
      job.status !== 'running' ||
      job.leaseToken !== input.leaseToken ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= input.finishedAt ||
      job.cleanupPending
    ) {
      return 'stale' as const;
    }
    if (input.attempt.jobId !== input.jobId)
      throw new Error('Attempt does not belong to this job.');

    const inserted = await tx
      .insert(runAttempts)
      .values(input.attempt)
      .onConflictDoNothing({ target: runAttempts.jobId })
      .returning({ id: runAttempts.id });
    if (inserted.length === 0) {
      await tx
        .update(executionJobs)
        .set({
          status: 'completed',
          finishedAt: input.finishedAt,
          heartbeatAt: input.finishedAt,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: input.finishedAt,
        })
        .where(eq(executionJobs.id, input.jobId));
      return 'duplicate' as const;
    }

    await input.applyEffects(tx);
    await tx
      .update(executionJobs)
      .set({
        status: 'completed',
        finishedAt: input.finishedAt,
        heartbeatAt: input.finishedAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        error: null,
        updatedAt: input.finishedAt,
      })
      .where(
        and(
          eq(executionJobs.id, input.jobId),
          eq(executionJobs.status, 'running'),
          eq(executionJobs.leaseToken, input.leaseToken),
        ),
      );
    return 'completed' as const;
  });
}

/** Recover abandoned leases and expire messages that can no longer be delivered. */
export async function reconcileExecutionLeases(
  db: Database,
  now: Date = new Date(),
): Promise<{ reclaimed: number; expired: number }> {
  const reclaimed = await db
    .update(executionJobs)
    .set({
      status: 'queued',
      nextAttemptAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
      // Preserve the original Queue identity/expiry. Redelivery resumes the
      // job; republishing its deduplicated ID cannot create a fresh delivery.
      lastErrorCode: 'LEASE_EXPIRED',
      updatedAt: now,
    })
    .where(
      and(
        eq(executionJobs.status, 'running'),
        isNotNull(executionJobs.leaseExpiresAt),
        lte(executionJobs.leaseExpiresAt, now),
        or(isNull(executionJobs.queueExpiresAt), gte(executionJobs.queueExpiresAt, now)),
      ),
    )
    .returning({ id: executionJobs.id });

  const expired = await db
    .update(executionJobs)
    .set({
      status: 'failed',
      finishedAt: now,
      heartbeatAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: 'QUEUE_RETENTION_EXPIRED',
      error: 'This run expired before execution infrastructure could process it.',
      updatedAt: now,
    })
    .where(
      and(
        inArray(executionJobs.status, ['queued', 'running']),
        or(
          lt(executionJobs.queueExpiresAt, now),
          lt(executionJobs.queuedAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000)),
        ),
      ),
    )
    .returning({ id: executionJobs.id });

  return { reclaimed: reclaimed.length, expired: expired.length };
}

export async function cleanupPendingSandboxes(
  db: Database,
  stop: (name: string) => Promise<void>,
  now: Date = new Date(),
): Promise<{ examined: number; cleaned: number }> {
  const rows = await db
    .select({ id: executionJobs.id, sandboxName: executionJobs.sandboxName })
    .from(executionJobs)
    .where(
      and(
        eq(executionJobs.cleanupPending, true),
        isNotNull(executionJobs.sandboxName),
        inArray(executionJobs.status, ['queued', 'completed', 'failed']),
      ),
    )
    .limit(50);
  let cleaned = 0;
  for (const row of rows) {
    try {
      await stop(row.sandboxName!);
      await db
        .update(executionJobs)
        .set({ cleanupPending: false, updatedAt: now })
        .where(
          and(eq(executionJobs.id, row.id), eq(executionJobs.sandboxName, row.sandboxName!)),
        );
      cleaned += 1;
    } catch {
      // Keep cleanup_pending=true for the next bounded reconciliation pass.
    }
  }
  return { examined: rows.length, cleaned };
}
