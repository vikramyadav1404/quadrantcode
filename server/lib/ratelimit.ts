/**
 * Fixed-window rate limiter.
 *
 * Backed by Upstash Redis when configured, and by an in-process map otherwise
 * so tests and local dev work without a Redis. The in-memory store is NOT a
 * production fallback: it is per-process, so on serverless it would give each
 * cold instance its own budget. `createRateLimiter` therefore refuses to fall
 * back in production — an unconfigured limiter should be a loud boot failure,
 * not a silently disabled control.
 *
 * OTP endpoints are limited by BOTH phone number and IP (F0.3 security
 * requirement): per-phone alone lets one host walk a list of numbers, per-IP
 * alone lets a botnet hammer one number.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** When the current window ends, so the caller can tell the user. */
  resetAt: Date;
};

export type RateLimiter = {
  limit(key: string): Promise<RateLimitResult>;
};

export type RateLimitRule = {
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
  /** Namespace, keeps unrelated counters from colliding. */
  prefix: string;
};

/** Documented limits, in one place so F4.8's audit can enumerate them. */
export const RATE_LIMITS = {
  otpRequestPerPhone: { limit: 3, windowSeconds: 3600, prefix: 'otp:req:phone' },
  otpRequestPerIp: { limit: 10, windowSeconds: 3600, prefix: 'otp:req:ip' },
  otpVerifyPerUser: { limit: 10, windowSeconds: 900, prefix: 'otp:vfy:user' },
  otpVerifyPerIp: { limit: 30, windowSeconds: 900, prefix: 'otp:vfy:ip' },
  magicLinkPerEmail: { limit: 5, windowSeconds: 3600, prefix: 'auth:link:email' },
  /** F0.5: 10 presign requests per user per hour. */
  avatarPresignPerUser: { limit: 10, windowSeconds: 3600, prefix: 'avatar:presign:user' },
} as const satisfies Record<string, RateLimitRule>;

// ── In-memory store (tests and local dev only) ──────────────────────────────

type Bucket = { count: number; resetAt: number };

export function createMemoryRateLimiter(
  rule: RateLimitRule,
  now = () => Date.now(),
): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    limit(key: string): Promise<RateLimitResult> {
      const current = now();
      const composite = `${rule.prefix}:${key}`;
      const existing = buckets.get(composite);

      if (!existing || existing.resetAt <= current) {
        const resetAt = current + rule.windowSeconds * 1000;
        buckets.set(composite, { count: 1, resetAt });
        return Promise.resolve({
          allowed: true,
          remaining: rule.limit - 1,
          resetAt: new Date(resetAt),
        });
      }

      existing.count += 1;
      return Promise.resolve({
        allowed: existing.count <= rule.limit,
        remaining: Math.max(0, rule.limit - existing.count),
        resetAt: new Date(existing.resetAt),
      });
    },
  };
}

// ── Upstash REST store ──────────────────────────────────────────────────────

export type UpstashConfig = { url: string; token: string; fetchImpl?: typeof fetch };

/**
 * Fixed window via INCR + EXPIRE. Chosen over a sliding log because it is one
 * round trip and the burst error at a window edge (up to 2x for one second) is
 * irrelevant for an hourly OTP cap.
 */
export function createUpstashRateLimiter(
  rule: RateLimitRule,
  config: UpstashConfig,
): RateLimiter {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    async limit(key: string): Promise<RateLimitResult> {
      const composite = `${rule.prefix}:${key}`;
      const response = await doFetch(`${config.url}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', composite],
          ['EXPIRE', composite, String(rule.windowSeconds), 'NX'],
          ['TTL', composite],
        ]),
      });

      if (!response.ok) {
        // Fail CLOSED. An unavailable limiter must not become an open door on
        // an authentication endpoint.
        throw new Error(`rate limiter unavailable: upstash responded ${response.status}`);
      }

      const results = (await response.json()) as Array<{ result: number }>;
      const used = Number(results[0]?.result ?? 0);
      const ttl = Number(results[2]?.result ?? rule.windowSeconds);

      return {
        allowed: used <= rule.limit,
        remaining: Math.max(0, rule.limit - used),
        resetAt: new Date(Date.now() + Math.max(0, ttl) * 1000),
      };
    },
  };
}

export function createRateLimiter(
  rule: RateLimitRule,
  env: { UPSTASH_REDIS_REST_URL?: string; UPSTASH_REDIS_REST_TOKEN?: string; NODE_ENV: string },
): RateLimiter {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = env;

  if (url && token) return createUpstashRateLimiter(rule, { url, token });

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production. ' +
        'The in-memory rate limiter is per-process and would not limit anything on serverless.',
    );
  }

  return createMemoryRateLimiter(rule);
}

/** Applies every rule that guards one action; the first denial wins. */
export async function checkAll(
  checks: Array<{ limiter: RateLimiter; key: string }>,
): Promise<RateLimitResult> {
  let tightest: RateLimitResult | undefined;

  for (const { limiter, key } of checks) {
    const result = await limiter.limit(key);
    if (!result.allowed) return result;
    if (!tightest || result.remaining < tightest.remaining) tightest = result;
  }

  return tightest ?? { allowed: true, remaining: 0, resetAt: new Date() };
}
