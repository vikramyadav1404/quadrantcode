import { handleCallback } from '@vercel/queue';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import {
  permitsQueueConsumer,
  validExecutionDelivery,
} from '@/server/services/execution/queue-auth';
import {
  InvalidExecutionQueueMessageError,
  RetryableExecutionError,
  processExecutionQueueMessage,
} from '@/server/services/execution';

export const runtime = 'nodejs';
/*
 * 60, not 90: the Hobby plan caps a function at 60 seconds and rejects the
 * deployment outright above it. Keep this in step with vercel.json — the two
 * are independent settings and a disagreement between them is silent.
 *
 * The budget inside it is tight. `SANDBOX_TIMEOUT_MS` is 50s, leaving ~10s for
 * provisioning the microVM and finalising the attempt. A submission that uses
 * its full sandbox allowance will be close to the ceiling, and the plan's
 * 30-minute maximum is not available here.
 *
 * Overrunning is survivable rather than corrupting: the function dies, the
 * 75-second Neon lease expires, the reconciler reclaims the job, and the
 * message is redelivered after its 120-second visibility timeout. Nothing is
 * double-counted — `run_attempts.job_id` is unique and the claim is fenced.
 */
export const maxDuration = 60;

const callback = handleCallback<unknown>(
  async (message, metadata) => {
    if (!validExecutionDelivery(metadata)) throw new InvalidExecutionQueueMessageError();
    await processExecutionQueueMessage(getDb(), getServerEnv(), message, metadata);
  },
  {
    visibilityTimeoutSeconds: 120,
    retry: (error) => {
      if (error instanceof InvalidExecutionQueueMessageError) return { acknowledge: true };
      if (error instanceof RetryableExecutionError) {
        return { afterSeconds: error.afterSeconds };
      }
      return { afterSeconds: 5 };
    },
  },
);

export async function POST(request: Request): Promise<Response> {
  if (!permitsQueueConsumer(process.env)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }
  return callback(request);
}
