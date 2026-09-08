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
  /**
   * F0.3b: phone SIGN-IN verify, keyed on the submitted number.
   *
   * `otpVerifyPerUser` cannot be used here. The caller is signed out, so there
   * is no user id until the code is right — and looking one up to build the key
   * would make the rate limit itself depend on whether the account exists,
   * turning the 429 into the oracle the whole flow is built to avoid.
   *
   * Keyed on what the caller typed, so an existing number and a made-up one are
   * throttled identically. Tighter than the signed-in rule (5 per 15 min rather
   * than 10) because a wrong code here is an attempt on someone's account, not
   * a typo by someone already holding their session.
   */
  phoneSignInVerifyPerPhone: { limit: 5, windowSeconds: 900, prefix: 'auth:phone:vfy' },
  magicLinkPerEmail: { limit: 5, windowSeconds: 3600, prefix: 'auth:link:email' },
  /**
   * F0.3: the 60-second resend cooldown.
   *
   * SERVER-SIDE on purpose. The countdown rendered on /login is UX — it resets
   * on reload, and the resend offered by the EXPIRED-link page is a second
   * entry point entirely. A cooldown that lives in component state is bypassed
   * by both. This rule is the control; the countdown merely displays it.
   */
  magicLinkResendCooldown: { limit: 1, windowSeconds: 60, prefix: 'auth:link:cooldown' },
  /** F0.5: 10 presign requests per user per hour. */
  avatarPresignPerUser: { limit: 10, windowSeconds: 3600, prefix: 'avatar:presign:user' },
  /**
   * F1.2: 10 imports per user per hour.
   *
   * An import is the most expensive thing an authenticated user can ask for —
   * up to 5,000 rows of parse plus insert — and the row and byte caps bound one
   * request, not a sequence of them. Without this, the caps are a speed bump.
   */
  importPerUser: { limit: 10, windowSeconds: 3600, prefix: 'ingest:import:user' },
  /** F1.2: exports are read-only but aggregate every tracked row. */
  exportPerUser: { limit: 20, windowSeconds: 3600, prefix: 'ingest:export:user' },
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
  env: {
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;
    NODE_ENV: string;
    ALLOW_IN_MEMORY_RATE_LIMIT?: string;
  },
): RateLimiter {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = env;

  if (url && token) return createUpstashRateLimiter(rule, { url, token });

  /*
   * Fail closed in production — and note what that MEANS: without Upstash
   * configured, /login throws rather than degrading, so the app cannot sign
   * anyone in. That is deliberate (an unlimited auth endpoint is worse than an
   * unavailable one) and it makes Upstash a hard deployment dependency, not an
   * optimisation. Recorded in the README.
   *
   * The escape hatch exists because `next start` sets NODE_ENV=production, so
   * the browser suite runs production semantics without a Redis. It is
   * deliberately verbose and OFF by default: production without Upstash still
   * refuses unless someone has explicitly written this variable, which is not
   * something done by accident.
   */
  if (env.NODE_ENV === 'production' && env.ALLOW_IN_MEMORY_RATE_LIMIT !== '1') {
    throw new Error(
      'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production. ' +
        'The in-memory rate limiter is per-process and would not limit anything on ' +
        'serverless. Set ALLOW_IN_MEMORY_RATE_LIMIT=1 only for a single-process test run.',
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
