import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { executionJobs, problems } from '@/server/db/schema';
import {
  EXECUTION_QUEUE_RETENTION_SECONDS,
  EXECUTION_QUEUE_TOPIC,
  dispatchExecutionJob,
  executionQueueMessageSchema,
  reconcileUndispatchedJobs,
  type QueueSend,
} from '@/server/services/execution';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

describe('execution queue envelope', () => {
  it('accepts only a version and job id', () => {
    const message = { version: 1 as const, jobId: crypto.randomUUID() };
    expect(executionQueueMessageSchema.parse(message)).toEqual(message);
    expect(() =>
      executionQueueMessageSchema.parse({ ...message, source: 'secret code' }),
    ).toThrow();
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('execution transactional outbox', () => {
  let ctx: TestContext;
  let jobId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    const user = await createUser(ctx.db);
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'queue-contract',
        title: 'Queue Contract',
        sourceType: 'external_link',
        platform: 'leetcode',
        externalUrl: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'easy',
      })
      .returning();
    const [job] = await ctx.db
      .insert(executionJobs)
      .values({
        userId: user.id,
        problemId: problem!.id,
        language: 'python3',
        source: 'print(1)',
        backend: 'vercel_sandbox',
      })
      .returning();
    jobId = job!.id;
  });

  it('uses the job id as the stable idempotency key and stores dispatch state', async () => {
    const sendMessage = vi.fn<QueueSend>().mockResolvedValue({ messageId: 'message-1' });
    expect(await dispatchExecutionJob(ctx.db, jobId, new Date(), sendMessage)).toMatchObject({
      dispatched: true,
      messageId: 'message-1',
    });
    expect(sendMessage).toHaveBeenCalledWith(
      EXECUTION_QUEUE_TOPIC,
      { version: 1, jobId },
      { idempotencyKey: jobId, retentionSeconds: EXECUTION_QUEUE_RETENTION_SECONDS },
    );
    const [job] = await ctx.db.select().from(executionJobs);
    expect(job).toMatchObject({ dispatchedAt: expect.any(Date), dispatchAttemptCount: 1 });
  });

  it('retries ambiguous publishing with the same key and remains recoverable', async () => {
    const sendMessage = vi
      .fn<QueueSend>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ messageId: null });
    await dispatchExecutionJob(ctx.db, jobId, new Date(), sendMessage);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage.mock.calls.map((call) => call[2].idempotencyKey)).toEqual([
      jobId,
      jobId,
      jobId,
    ]);
    const [job] = await ctx.db.select().from(executionJobs);
    expect(job).toMatchObject({ dispatchedAt: expect.any(Date), dispatchAttemptCount: 3 });
  });

  it('reconciliation republishes a committed undispatched row', async () => {
    const sendMessage = vi.fn<QueueSend>().mockResolvedValue({ messageId: 'reconciled' });
    expect(await reconcileUndispatchedJobs(ctx.db, new Date(), sendMessage)).toEqual({
      examined: 1,
      dispatched: 1,
    });
  });
});
