/**
 * What a client is allowed to send.
 *
 * **Read this as the list of things the server does NOT accept.** There is no
 * duration here, no timestamp, no elapsed count, no "started at". The ticket's
 * requirement — "the client sends intent only" — is not a convention the
 * handlers follow; it is the absence of any field that could carry a time.
 *
 * Zod strips unknown keys by default, so a request carrying
 * `activeDurationSeconds: 99999` parses successfully and arrives at the service
 * without it. That is the behaviour the adversarial test asserts: forging
 * something the schema does not mention is not an error, it is a no-op.
 *
 * If a future ticket ever needs a client-supplied time, it does not belong
 * here. It belongs in a field named for what it is — `clientReportedAt` — that
 * the server stores separately and never computes from.
 */
import { z } from 'zod';

/** Every action is scoped to one session the caller owns. */
export const sessionIdSchema = z.object({
  sessionId: z.string().uuid(),
});

export const startSessionSchema = z.object({
  problemId: z.string().uuid(),
});

export const completeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  outcome: z.enum(['solved', 'stuck']),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
});

export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type CompleteSessionInput = z.infer<typeof completeSessionSchema>;
export type SessionIdInput = z.infer<typeof sessionIdSchema>;

/**
 * Field names a client might try, none of which any schema above accepts.
 *
 * Exported so the adversarial test cannot drift from the thing it is testing:
 * it forges exactly this list, and adding a name here makes every endpoint's
 * test cover it. A hand-written list inside the test would go stale the first
 * time someone added a field.
 */
export const FORGEABLE_TIME_FIELDS = [
  'activeDurationSeconds',
  'durationSeconds',
  'elapsedMs',
  'startedAt',
  'endedAt',
  'occurredAt',
  'lastHeartbeatAt',
  'now',
  'clientTimestamp',
  'timestamp',
] as const;
