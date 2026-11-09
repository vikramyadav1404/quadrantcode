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
import { resolveEmailDelivery } from '@/server/services/auth/email-delivery';

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

const NO_REDIS =
  'no Redis — rate limiting is per-process and would not limit anything on serverless (F0.3)';

/**
 * Why a fetch failed, WITHOUT the error's message.
 *
 * On 2026-11-09 a token pasted with a stray quote made `Headers.append` throw,
 * and its message quoted the header value — the Upstash token — into the
 * runtime logs. Anything shown here must never echo an error message, only a
 * fixed phrase or a system error code.
 */
function describeFetchFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `no answer within ${timeoutMs}ms`;
  }
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) return `could not connect (${code})`;
  if (error instanceof TypeError) {
    return 'the request could not be built — check the token for quotes, spaces or line breaks';
  }
  return 'the request failed';
}

/**
 * A real round trip to Upstash: `PING` over its REST API.
 *
 * Admin-only on purpose (see `checkHealth`). The public health endpoints keep
 * the configuration-only check, so an anonymous caller cannot turn them into a
 * stream of Redis commands. On 2026-11-09 the configuration-only check said
 * `up` for a database that had been deleted, while every rate-limited route
 * returned 500; this is what would have shown it.
 */
export async function probeRedis(
  url: string | undefined,
  token: string | undefined,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<DependencyHealth> {
  if (!url || !token) {
    return { name: 'redis', state: 'not_configured', latencyMs: null, detail: NO_REDIS };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return {
        name: 'redis',
        state: 'down',
        latencyMs,
        detail: `Upstash answered HTTP ${response.status} to PING`,
      };
    }
    const body = (await response.json().catch(() => null)) as { result?: unknown } | null;
    return body?.result === 'PONG'
      ? { name: 'redis', state: 'up', latencyMs, detail: 'PING answered PONG' }
      : { name: 'redis', state: 'down', latencyMs, detail: 'unexpected reply to PING' };
  } catch (error) {
    return {
      name: 'redis',
      state: 'down',
      latencyMs: Date.now() - started,
      detail: describeFetchFailure(error, timeoutMs),
    };
  } finally {
    clearTimeout(timer);
  }
}

export type HealthOptions = {
  /**
   * Call Upstash instead of only checking it is configured. Only the admin
   * dashboard sets this; `/api/health` and `/api/health/ready` are public.
   */
  probeRedis?: boolean;
  fetchImpl?: typeof fetch;
};

export async function checkHealth(
  db: Database,
  env: Record<string, string | undefined>,
  now: Date,
  options: HealthOptions = {},
): Promise<HealthReport> {
  const dependencies: DependencyHealth[] = [
    await checkDatabase(db),

    checkConfigured(
      'execution_backend',
      env['EXECUTION_BACKEND'],
      'no EXECUTION_BACKEND — code execution is unavailable; production never invents a verdict',
    ),
    options.probeRedis
      ? await probeRedis(env['UPSTASH_REDIS_REST_URL'], env['UPSTASH_REDIS_REST_TOKEN'], {
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        })
      : checkConfigured('redis', env['UPSTASH_REDIS_REST_URL'], NO_REDIS),
    checkConfigured(
      'email',
      resolveEmailDelivery(env) ?? undefined,
      'neither Resend nor Gmail SMTP is configured — sign-in links are never delivered',
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
    : dependencies.some((entry) => entry.state !== 'up')
      ? 'degraded'
      : 'ok';

  return { status, checkedAt: now, dependencies };
}
