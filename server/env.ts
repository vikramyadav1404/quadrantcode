/**
 * SERVER environment — secrets. Never reaches a browser bundle.
 *
 * Imported by Next.js server code AND by the standalone worker, which is why
 * it does not `import 'server-only'`: that package throws unless the
 * `react-server` export condition is set, and a plain Node process does not
 * set it. Rather than making the worker pretend to be an RSC environment, the
 * boundary is enforced by three mechanisms that do not lie about the runtime:
 *
 *   1. the `assertServer()` check below — fails immediately in a browser
 *   2. the ESLint `no-restricted-imports` rule blocking `@/server/**` from
 *      client files (components/, lib/, app/)
 *   3. `tests/boundary/server-boundary.test.ts`, which lints Client Component
 *      source through the real project config and asserts the rule fires
 *
 * Public values live in `lib/env.ts` and are importable anywhere.
 */
import { z } from 'zod';
import { type EnvSource, formatEnvIssues, publicEnvSchema } from '@/lib/env';

function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      'server/env.ts was imported from client code. Server secrets must never ' +
        'reach the browser. Read a NEXT_PUBLIC_ value from lib/env.ts instead, ' +
        'or pass the value down as a prop from a Server Component.',
    );
  }
}

const nonEmpty = (label: string) => z.string().min(1, `${label} must not be empty`);
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

/**
 * A machine credential: trimmed, and long enough to be worth comparing.
 *
 * Trimmed because `'  secret  '` pasted out of a dashboard is a different byte
 * string from the one the caller sends, and the failure looks like "cron is
 * broken" rather than "the value has spaces". Whitespace-only collapses to ''
 * and is then treated as absent, so the route's `!env.CRON_SECRET` guard
 * refuses every caller instead of comparing against a blank.
 *
 * 32 characters because this is the entire credential — there is no session,
 * no second factor and no user behind it. The same floor AUTH_SECRET already
 * uses.
 */
const optionalSecret = (label: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    },
    z.string().min(32, `${label} must be at least 32 characters`).optional(),
  );

/** Variables the server cannot boot without. */
const requiredServerSchema = z.object({
  DATABASE_URL: nonEmpty('DATABASE_URL').refine(
    (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
    'DATABASE_URL must be a postgres:// or postgresql:// connection string',
  ),
});

/**
 * Phase 1–4 integrations. Absent by default so the repo runs without secrets;
 * `requireEnv()` turns a missing value into a readable failure at the point of
 * use rather than a silent `undefined` deep inside a provider call.
 */
const optionalServerSchema = z.object({
  /** Provider-neutral alias used by migration tooling; Neon also supplies the legacy name. */
  DIRECT_DATABASE_URL: optionalString,
  DATABASE_URL_UNPOOLED: optionalString,
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  /** Test-only escape from the production rate-limiter guard. See ratelimit.ts. */
  ALLOW_IN_MEMORY_RATE_LIMIT: optionalString,
  /** Test-server escape hatch for the console OTP provider. See otp/console.ts. */
  ALLOW_CONSOLE_OTP: optionalString,
  AUTH_SECRET: optionalString,
  AUTH_URL: optionalUrl,
  AUTH_TRUST_HOST: optionalString,
  /** Trust forwarded client IP headers outside Vercel only when a known proxy sets them. */
  TRUST_PROXY: optionalString,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  MSG91_AUTH_KEY: optionalString,
  MSG91_TEMPLATE_ID: optionalString,
  /**
   * GitHub OAuth. Optional, and the provider is only offered when BOTH are set
   * — a half-configured provider renders a button that fails on click, which is
   * worse than no button.
   */
  GITHUB_ID: optionalString,
  GITHUB_SECRET: optionalString,
  JUDGE0_URL: optionalUrl,
  JUDGE0_API_KEY: optionalString,
  EXECUTION_BACKEND: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['vercel_sandbox', 'judge0', 'fake']).optional(),
  ),
  EXECUTION_SANDBOX_IMAGE: optionalString,
  CRON_SECRET: optionalSecret('CRON_SECRET'),
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: optionalString,
  SENTRY_ORG: optionalString,
  SENTRY_PROJECT: optionalString,
  SENTRY_AUTH_TOKEN: optionalString,

  // F0.5 avatar storage — S3-compatible (Cloudflare R2). Supabase Storage
  // cannot enforce a caller-supplied presign expiry; see decisions D11.
  S3_ENDPOINT: optionalUrl,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_BUCKET: optionalString,
  S3_PUBLIC_BASE_URL: optionalUrl,
});

function addPairIssue(
  value: Record<string, unknown>,
  context: z.RefinementCtx,
  left: string,
  right: string,
): void {
  if (Boolean(value[left]) === Boolean(value[right])) return;
  context.addIssue({
    code: 'custom',
    path: [value[left] ? right : left],
    message: `${left} and ${right} must be set together`,
  });
}

const serverEnvSchema = requiredServerSchema
  .and(optionalServerSchema)
  .and(publicEnvSchema)
  .superRefine((value, context) => {
    addPairIssue(value, context, 'GITHUB_ID', 'GITHUB_SECRET');
    addPairIssue(value, context, 'RESEND_API_KEY', 'EMAIL_FROM');
    addPairIssue(value, context, 'MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID');
    addPairIssue(value, context, 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN');

    if (
      value.EXECUTION_SANDBOX_IMAGE &&
      !/^.+@sha256:[a-f0-9]{64}$/i.test(value.EXECUTION_SANDBOX_IMAGE)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['EXECUTION_SANDBOX_IMAGE'],
        message: 'EXECUTION_SANDBOX_IMAGE must use an immutable sha256 digest',
      });
    }
    if (value.NODE_ENV === 'production' && value.EXECUTION_BACKEND === 'fake') {
      context.addIssue({
        code: 'custom',
        path: ['EXECUTION_BACKEND'],
        message: 'fake execution is not allowed in production',
      });
    }

    const storageKeys = [
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_BUCKET',
      'S3_PUBLIC_BASE_URL',
    ] as const;
    const storageCount = storageKeys.filter((key) => Boolean(value[key])).length;
    if (storageCount > 0 && storageCount !== storageKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['S3_ENDPOINT'],
        message: `${storageKeys.join(', ')} must be set together`,
      });
    }

    if (
      value.NODE_ENV === 'production' &&
      (!value.AUTH_SECRET || value.AUTH_SECRET.length < 32)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message:
          'AUTH_SECRET must be a cryptographically random string of at least 32 characters',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function parseServerEnv(source: EnvSource): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration.\n${formatEnvIssues(result.error)}\n\n` +
        'Copy .env.example to .env.local (app) or .env (worker) and fill the ' +
        'missing values. Every variable is documented in .env.example.',
    );
  }

  return result.data;
}

let cached: ServerEnv | undefined;

/** Parsed server environment. Throws on first access if configuration is invalid. */
export function getServerEnv(): ServerEnv {
  assertServer();
  cached ??= parseServerEnv(process.env);
  return cached;
}

/**
 * Reads a phase-gated variable, failing loudly with the feature name attached
 * so the operator knows which integration is unconfigured.
 */
export function requireEnv<K extends keyof ServerEnv>(
  key: K,
  feature: string,
): NonNullable<ServerEnv[K]> {
  const value = getServerEnv()[key];
  if (value === undefined || value === '') {
    throw new Error(
      `${String(key)} is required for ${feature} but is not set. See .env.example.`,
    );
  }
  return value as NonNullable<ServerEnv[K]>;
}

/** One source of truth for OTP HMAC and Auth.js secret handling. */
export function getAuthSecret(env = getServerEnv()): string {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  if (env.NODE_ENV !== 'production')
    return 'quadrantcode-development-secret-not-for-production';
  throw new Error('AUTH_SECRET is required in production. See .env.example.');
}

/** Exported for tests: validate an arbitrary env object without touching the cache. */
export const __testing = { parseServerEnv, serverEnvSchema };
