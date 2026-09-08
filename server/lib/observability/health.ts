/**
 * Is the system actually working?
 *
 * ## "Not configured" is a real answer, and not a green one
 *
 * Most of this project's dependencies are unavailable: no Redis, no Judge0, no
 * Sentry. A health check that reported those as healthy — or omitted them —
 * would be a dashboard that lies by default, which is worse than no dashboard
 * because somebody would trust it.
 *
 * So every dependency reports one of three states, and `not_configured` is
 * distinct from `up`. The overall status is `degraded` when something that
 * SHOULD be there is missing, and `ok` only when everything configured is
 * reachable.
 *
 * ## What this deliberately does not check
 *
 * Queue depth, dead-letter counts, Razorpay webhooks, AI spend — the ticket
 * lists all four. F2.3, F4.4 and F3.4 are cut, so there is nothing behind any
 * of them. Reporting `0` would be a number that looks measured; they are absent
 * instead, and the dashboard says why.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@/server/db';

export const DEPENDENCY_STATES = ['up', 'down', 'not_configured'] as const;

export type DependencyState = (typeof DEPENDENCY_STATES)[number];

export type DependencyHealth = {
  name: string;
  state: DependencyState;
  /** How long the check took. Null when nothing was called. */
  latencyMs: number | null;
  /** Why it is down, or why it is absent. Never a bare state. */
  detail: string;
};

export type HealthReport = {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: Date;
  dependencies: DependencyHealth[];
};

/**
 * The database, which is the only dependency that must be up.
 *
 * `select 1` rather than a table read: this answers "can we talk to Postgres",
 * and a query against a real table would also fail on a bad migration, which is
 * a different problem with a different fix.
 */
async function checkDatabase(db: Database): Promise<DependencyHealth> {
  const started = Date.now();

  try {
    await db.execute(sql`select 1`);
    return {
      name: 'postgres',
      state: 'up',
      latencyMs: Date.now() - started,
      detail: 'reachable',
    };
  } catch (error) {
    return {
      name: 'postgres',
      state: 'down',
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : 'unreachable',
    };
  }
}

/**
 * A dependency we can only check for configuration.
 *
 * Deliberately does NOT call out to it. A health endpoint that makes a network
 * request per dependency turns one slow third party into a slow health check,
 * and a health check that times out is read as an outage of everything.
 *
 * The cost is stated in the detail line: configured is not the same as
 * reachable, and this says which one it means.
 */
function checkConfigured(
  name: string,
  value: string | undefined,
  absentMeans: string,
): DependencyHealth {
  return value
    ? {
        name,
        state: 'up',
        latencyMs: null,
        detail: 'configured — not called from here, so this is not proof it is reachable',
      }
    : { name, state: 'not_configured', latencyMs: null, detail: absentMeans };
}

export async function checkHealth(
  db: Database,
  env: Record<string, string | undefined>,
  now: Date,
): Promise<HealthReport> {
  const dependencies: DependencyHealth[] = [
    await checkDatabase(db),

    checkConfigured(
      'judge0',
      env['JUDGE0_URL'],
      'no JUDGE0_URL — code execution is unavailable; production never invents a verdict',
    ),
    checkConfigured(
      'redis',
      env['UPSTASH_REDIS_REST_URL'],
      'no Redis — rate limiting is per-process and would not limit anything on serverless (F0.3)',
    ),
    checkConfigured(
      'resend',
      env['RESEND_API_KEY'],
      'no RESEND_API_KEY — magic links are never delivered, so nobody can sign in',
    ),
    checkConfigured(
      'sentry',
      env['SENTRY_DSN'],
      'no SENTRY_DSN — errors are logged to stdout only, and no alert has anywhere to go',
    ),
  ];

  /*
   * `down` only for the database. Everything else being absent is a known,
   * recorded state of this deployment rather than a fault — calling it `down`
   * would make the endpoint red permanently and therefore useless.
   */
  const status: HealthReport['status'] = dependencies.some(
    (entry) => entry.name === 'postgres' && entry.state === 'down',
  )
    ? 'down'
    : dependencies.some((entry) => entry.state === 'not_configured')
      ? 'degraded'
      : 'ok';

  return { status, checkedAt: now, dependencies };
}
