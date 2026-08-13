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
  DATABASE_URL_UNPOOLED: z.string().optional(),
  REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  JUDGE0_URL: z.string().optional(),
  JUDGE0_API_KEY: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

const serverEnvSchema = requiredServerSchema.and(optionalServerSchema).and(publicEnvSchema);

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

/** Exported for tests: validate an arbitrary env object without touching the cache. */
export const __testing = { parseServerEnv, serverEnvSchema };
