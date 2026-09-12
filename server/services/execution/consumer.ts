import { eq } from 'drizzle-orm';
import type { MessageMetadata } from '@vercel/queue';
import { isFeatureEnabled } from '@/lib/flags';
import { validExecutionDelivery } from './queue-auth';
import type { Database } from '@/server/db';
import { executionJobs } from '@/server/db/schema';
import type { ServerEnv } from '@/server/env';
import { failQueuedExecution, RetryableExecutionError } from './claim';
import { executionQueueMessageSchema } from './queue';
import { FakeExecutionProvider, resolveProvider } from './provider';
import { VercelSandboxProvider } from './sandbox';
import { runExecutionJob } from './pipeline';

export class InvalidExecutionQueueMessageError extends Error {
  constructor() {
    super('Invalid execution queue message.');
    this.name = 'InvalidExecutionQueueMessageError';
  }
}

/** Process a queue envelope containing only its version and persisted job id. */
export async function processExecutionQueueMessage(
  db: Database,
  env: ServerEnv,
  rawMessage: unknown,
  metadata: MessageMetadata,
): Promise<void> {
  if (!isFeatureEnabled('FEATURE_EXECUTION'))
    throw new RetryableExecutionError('EXECUTION_DISABLED', 60);
  if (!validExecutionDelivery(metadata)) throw new InvalidExecutionQueueMessageError();
  const parsed = executionQueueMessageSchema.safeParse(rawMessage);
  if (!parsed.success) throw new InvalidExecutionQueueMessageError();

  const [job] = await db
    .select({
      backend: executionJobs.backend,
      status: executionJobs.status,
      queueMessageId: executionJobs.queueMessageId,
      queuedAt: executionJobs.queuedAt,
    })
    .from(executionJobs)
    .where(eq(executionJobs.id, parsed.data.jobId))
    .limit(1);
  if (!job) return;
  if (job.status === 'completed' || job.status === 'failed') return;
  if (
    (job.queueMessageId && job.queueMessageId !== metadata.messageId) ||
    metadata.createdAt.getTime() < job.queuedAt.getTime() - 30_000
  ) {
    throw new InvalidExecutionQueueMessageError();
  }

  const provider = (() => {
    if (job.backend === 'vercel_sandbox') {
      return env.EXECUTION_SANDBOX_IMAGE
        ? new VercelSandboxProvider(env.EXECUTION_SANDBOX_IMAGE)
        : null;
    }
    if (job.backend === 'judge0') {
      return env.JUDGE0_URL ? resolveProvider({ ...env, EXECUTION_BACKEND: 'judge0' }) : null;
    }
    if (job.backend === 'fake' && env.NODE_ENV !== 'production') {
      return new FakeExecutionProvider();
    }
    return null;
  })();

  if (!provider) {
    await failQueuedExecution(db, {
      jobId: parsed.data.jobId,
      code: 'EXECUTION_BACKEND_INVALID',
      message: 'This run cannot start because its execution backend is unavailable.',
    });
    return;
  }

  const result = await runExecutionJob(db, provider, parsed.data.jobId);
  if (result.kind === 'retry') {
    throw new RetryableExecutionError('EXECUTION_RETRY', result.afterSeconds);
  }
}
