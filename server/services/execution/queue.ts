import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { send, type SendResult } from '@vercel/queue';
import { z } from 'zod';
import type { Database } from '@/server/db';
import { executionJobs } from '@/server/db/schema';
import type { ServerEnv } from '@/server/env';
import { InProcessExecutionRunner, type ExecutionRunner } from './pipeline';
import { resolveProvider } from './provider';

export const EXECUTION_QUEUE_TOPIC = 'quadrantcode-executions-v1';
export const EXECUTION_QUEUE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const DISPATCH_ATTEMPTS = 3;

export const executionQueueMessageSchema = z
  .object({ version: z.literal(1), jobId: z.string().uuid() })
  .strict();

export type ExecutionQueueMessageV1 = z.infer<typeof executionQueueMessageSchema>;
export type QueueSend = (
  topic: string,
  payload: ExecutionQueueMessageV1,
  options: { idempotencyKey: string; retentionSeconds: number },
) => Promise<SendResult>;

export type DispatchResult =
  | { dispatched: true; messageId: string | null }
  | { dispatched: false; reason: 'already_dispatched' | 'send_failed' };

/** Publish a persisted outbox row without ever putting job contents on Queue. */
export async function dispatchExecutionJob(
  db: Database,
  jobId: string,
  now: Date = new Date(),
  sendMessage: QueueSend = send,
): Promise<DispatchResult> {
  const [job] = await db
    .select({
      id: executionJobs.id,
      dispatchedAt: executionJobs.dispatchedAt,
      queuedAt: executionJobs.queuedAt,
    })
    .from(executionJobs)
    .where(and(eq(executionJobs.id, jobId), eq(executionJobs.status, 'queued')))
    .limit(1);

  if (!job || job.dispatchedAt) return { dispatched: false, reason: 'already_dispatched' };

  const expiresAt = new Date(
    job.queuedAt.getTime() + EXECUTION_QUEUE_RETENTION_SECONDS * 1_000,
  );
  if (expiresAt <= now) return { dispatched: false, reason: 'send_failed' };

  const payload: ExecutionQueueMessageV1 = { version: 1, jobId };
  let sent: SendResult | null = null;
  for (let attempt = 0; attempt < DISPATCH_ATTEMPTS; attempt += 1) {
    await db
      .update(executionJobs)
      .set({
        dispatchAttemptCount: sql`least(${executionJobs.dispatchAttemptCount} + 1, 32767)`,
        queueExpiresAt: expiresAt,
        updatedAt: now,
      })
      .where(eq(executionJobs.id, jobId));
    try {
      sent = await sendMessage(EXECUTION_QUEUE_TOPIC, payload, {
        idempotencyKey: jobId,
        retentionSeconds: EXECUTION_QUEUE_RETENTION_SECONDS,
      });
      break;
    } catch {
      // Same idempotency key on every retry; the outbox row remains recoverable.
    }
  }

  if (!sent) {
    await db
      .update(executionJobs)
      .set({ nextAttemptAt: new Date(now.getTime() + 60_000), updatedAt: now })
      .where(and(eq(executionJobs.id, jobId), isNull(executionJobs.dispatchedAt)));
    return { dispatched: false, reason: 'send_failed' };
  }

  await db
    .update(executionJobs)
    .set({
      queueMessageId: sent.messageId,
      dispatchedAt: now,
      queueExpiresAt: expiresAt,
      updatedAt: now,
    })
    .where(and(eq(executionJobs.id, jobId), isNull(executionJobs.dispatchedAt)));

  return { dispatched: true, messageId: sent.messageId };
}

export class VercelQueueExecutionRunner implements ExecutionRunner {
  constructor(
    private readonly db: Database,
    private readonly sendMessage: QueueSend = send,
  ) {}

  async enqueue(jobId: string): Promise<void> {
    // An exhausted send is intentionally not thrown into the request path: the
    // committed job is the outbox and the cron reconciler will republish it.
    await dispatchExecutionJob(this.db, jobId, new Date(), this.sendMessage);
  }
}

/**
 * Production always uses Vercel Queue. The sole exception is the repository's
 * production-build browser harness, which is already rejected by deploy:check
 * and must target localhost with its explicit capture flag.
 */
export function createRequestExecutionRunner(
  db: Database,
  env: ServerEnv,
  source: Record<string, string | undefined> = process.env,
): ExecutionRunner {
  const localBrowserContract =
    source['E2E_EMAIL_CAPTURE'] === '1' &&
    env.ALLOW_IN_MEMORY_RATE_LIMIT === '1' &&
    env.EXECUTION_BACKEND === 'judge0' &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(env.NEXT_PUBLIC_APP_URL);
  return localBrowserContract
    ? new InProcessExecutionRunner(db, resolveProvider(env))
    : new VercelQueueExecutionRunner(db);
}

export async function reconcileUndispatchedJobs(
  db: Database,
  now: Date = new Date(),
  sendMessage: QueueSend = send,
): Promise<{ examined: number; dispatched: number }> {
  const jobs = await db
    .select({ id: executionJobs.id })
    .from(executionJobs)
    .where(
      and(
        eq(executionJobs.status, 'queued'),
        isNull(executionJobs.dispatchedAt),
        lte(executionJobs.nextAttemptAt, now),
      ),
    )
    .limit(100);

  let dispatched = 0;
  for (const job of jobs) {
    const result = await dispatchExecutionJob(db, job.id, now, sendMessage);
    if (result.dispatched) dispatched += 1;
  }
  return { examined: jobs.length, dispatched };
}
