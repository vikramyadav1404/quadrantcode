/**
 * The execution queue numbers /admin/health shows, against real rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executionQueueHealth } from '@/server/services/execution';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('execution queue health', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  const byName = (metrics: Awaited<ReturnType<typeof executionQueueHealth>>) =>
    Object.fromEntries(metrics.map((metric) => [metric.name, metric]));

  it('an empty queue is within every limit', async () => {
    const metrics = await executionQueueHealth(ctx.db, new Date());
    expect(metrics.every((metric) => metric.ok)).toBe(true);
    expect(metrics.every((metric) => metric.value === 0)).toBe(true);
  });

  it('flags an old queued job, an expired lease and pending cleanup', async () => {
    const user = await createUser(ctx.db);
    const [problem] = await ctx.sql<{ id: string }[]>`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      VALUES ('qh-one', 'Queue Health', 'external_link', 'leetcode',
              'https://leetcode.com/problems/qh-one/', 'easy', 'published')
      RETURNING id
    `;
    const now = new Date('2026-11-14T12:00:00Z');

    await ctx.sql`
      INSERT INTO execution_jobs (user_id, problem_id, language, source, status, queued_at, created_at)
      VALUES (${user.id}, ${problem!.id}, 'python3', 'print(1)', 'queued',
              ${new Date(now.getTime() - 10 * 60_000).toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    `;
    await ctx.sql`
      INSERT INTO execution_jobs (user_id, problem_id, language, source, status, attempt_count,
                                  lease_token, lease_expires_at, cleanup_pending, created_at)
      VALUES (${user.id}, ${problem!.id}, 'python3', 'print(2)', 'running', 2,
              gen_random_uuid(), ${new Date(now.getTime() - 60_000).toISOString()}::timestamptz, true,
              ${now.toISOString()}::timestamptz)
    `;

    const metrics = byName(await executionQueueHealth(ctx.db, now));
    expect(metrics['Oldest queued job (seconds)']).toMatchObject({ value: 600, ok: false });
    expect(metrics['Running jobs with an expired lease']).toMatchObject({
      value: 1,
      ok: false,
    });
    expect(metrics['Jobs awaiting sandbox cleanup']).toMatchObject({ value: 1, ok: false });
    expect(metrics['Highest attempt among live jobs']).toMatchObject({ value: 2, ok: true });
    expect(metrics['Jobs admitted today (UTC)']).toMatchObject({ value: 2, ok: true });
  });
});
