/**
 * The execution queue at a glance, for /admin/health.
 *
 * The launch checklist asks for queue age, retry count, expired leases,
 * cleanup-pending jobs and the UTC-day admission count to be visible and
 * within their limits. Each number below is one of those, read straight from
 * `execution_jobs`, next to the limit it is judged against. Read-only: nothing
 * here claims, retries or cleans a job — the consumer and the daily reconcile
 * cron do that.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { MAX_EXECUTION_ATTEMPTS, EXECUTION_LEASE_SECONDS } from './claim';
import { globalDailyLimit } from './limits';

/**
 * How old the oldest queued job may be before it counts as stuck: one lease
 * plus the longest retry backoff (60 s), so a job mid-retry never trips it.
 */
export const QUEUE_AGE_LIMIT_SECONDS = EXECUTION_LEASE_SECONDS + 60;

export type QueueMetric = {
  name: string;
  value: number;
  limit: number;
  /** Plain words for the limit, shown beside the number. */
  limitLabel: string;
  ok: boolean;
};

export async function executionQueueHealth(db: Database, now: Date): Promise<QueueMetric[]> {
  const utcDayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const at = now.toISOString();
  const dayStart = utcDayStart.toISOString();
  const dailyLimit = globalDailyLimit();

  const [row] = await db.execute<{
    queued: number;
    oldest_queued_seconds: number;
    expired_leases: number;
    max_live_attempts: number;
    cleanup_pending: number;
    admitted_today: number;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE status = 'queued')::int AS queued,
      coalesce(
        extract(epoch FROM (${at}::timestamptz - min(queued_at) FILTER (WHERE status = 'queued'))),
        0
      )::int AS oldest_queued_seconds,
      count(*) FILTER (
        WHERE status = 'running' AND lease_expires_at IS NOT NULL
          AND lease_expires_at < ${at}::timestamptz
      )::int AS expired_leases,
      coalesce(max(attempt_count) FILTER (WHERE status IN ('queued', 'running')), 0)::int
        AS max_live_attempts,
      count(*) FILTER (WHERE cleanup_pending)::int AS cleanup_pending,
      count(*) FILTER (WHERE created_at >= ${dayStart}::timestamptz)::int AS admitted_today
    FROM execution_jobs
  `);

  const value = (n: number | undefined) => Number(n ?? 0);
  const metric = (
    name: string,
    current: number,
    limit: number,
    limitLabel: string,
  ): QueueMetric => ({ name, value: current, limit, limitLabel, ok: current <= limit });

  return [
    metric(
      'Oldest queued job (seconds)',
      value(row?.oldest_queued_seconds),
      QUEUE_AGE_LIMIT_SECONDS,
      `at most ${QUEUE_AGE_LIMIT_SECONDS} s — one lease plus the longest backoff`,
    ),
    metric('Queued jobs', value(row?.queued), Number.POSITIVE_INFINITY, 'no fixed cap'),
    metric(
      'Highest attempt among live jobs',
      value(row?.max_live_attempts),
      MAX_EXECUTION_ATTEMPTS,
      `at most ${MAX_EXECUTION_ATTEMPTS}, then the job fails`,
    ),
    metric(
      'Running jobs with an expired lease',
      value(row?.expired_leases),
      0,
      'none — the daily reconcile sweeps them',
    ),
    metric('Jobs awaiting sandbox cleanup', value(row?.cleanup_pending), 0, 'none'),
    metric(
      'Jobs admitted today (UTC)',
      value(row?.admitted_today),
      dailyLimit,
      `shared daily allowance of ${dailyLimit}`,
    ),
  ];
}
