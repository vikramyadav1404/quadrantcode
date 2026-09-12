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
export const maxDuration = 90;

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
