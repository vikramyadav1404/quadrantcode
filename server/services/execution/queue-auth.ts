import type { MessageMetadata } from '@vercel/queue';
import { isFeatureEnabled } from '@/lib/flags';
import { EXECUTION_QUEUE_RETENTION_SECONDS, EXECUTION_QUEUE_TOPIC } from './queue';

/**
 * Authentication is enforced by Vercel's private queue/v2beta trigger, not by
 * caller-supplied CloudEvent headers. Fail closed on every other host. Keep the
 * trigger in vercel.json: the SDK alone does NOT authenticate a public route.
 * https://vercel.com/changelog/vercel-queues-now-in-public-beta
 */
export function permitsQueueConsumer(env: Record<string, string | undefined>): boolean {
  return env.VERCEL === '1' && isFeatureEnabled('FEATURE_EXECUTION', env);
}

/** Retries within retention are legitimate; expired or foreign deliveries are not. */
export function validExecutionDelivery(metadata: MessageMetadata, now = new Date()): boolean {
  const created = metadata.createdAt?.getTime();
  const expires = metadata.expiresAt?.getTime();
  return (
    metadata.topicName === EXECUTION_QUEUE_TOPIC &&
    typeof metadata.messageId === 'string' &&
    metadata.messageId.length > 0 &&
    metadata.messageId.length <= 256 &&
    Number.isSafeInteger(metadata.deliveryCount) &&
    metadata.deliveryCount > 0 &&
    Number.isFinite(created) &&
    Number.isFinite(expires) &&
    created <= now.getTime() + 30_000 &&
    expires > now.getTime() &&
    expires > created &&
    expires - created <= EXECUTION_QUEUE_RETENTION_SECONDS * 1_000 + 30_000
  );
}
