/**
 * Typed, validated environment.
 *
 * F0.1 requirement 3: a Zod-parsed `process.env` that throws at boot on a
 * missing or malformed variable, imported by BOTH the Next app and the
 * standalone worker.
 *
 * Why this file does NOT `import 'server-only'`:
 * the `server-only` package resolves to a module that throws unless the
 * `react-server` export condition is active. The Next.js server bundle sets
 * that condition; a plain Node process (our worker) does not. Importing it
 * here would make `npm run worker` crash on boot. The client boundary is
 * instead enforced by (a) the explicit `assertServer()` guard below and
 * (b) the ESLint `no-restricted-imports` rule in eslint.config.mjs.
 */
import { z } from 'zod';

/** Throws if a server-only module is evaluated inside a browser bundle. */
function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      'lib/env.ts was imported from client code. Server environment variables ' +
        'must never reach the browser. Pass the value down as a prop, or add a ' +
        'NEXT_PUBLIC_ variable to publicEnvSchema instead.',
    );
  }
}

const nonEmpty = (label: string) => z.string().min(1, `${label} must not be empty`);

/**
 * Variables the application cannot boot without.
 * Everything phase-gated lives in `optionalEnvSchema` and is asserted by the
 * feature that needs it, so Phase 0 stays runnable with two variables set.
 */
const requiredEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Postgres connection string (Supabase pooled URL in hosted environments).
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
const optionalEnvSchema = z.object({
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

const publicEnvSchema = z.object({
  // Absolute origin used for magic links, OG images and webhook callbacks.
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

const envSchema = requiredEnvSchema.and(optionalEnvSchema).and(publicEnvSchema);

export type Env = z.infer<typeof envSchema>;

/**
 * Deliberately looser than `NodeJS.ProcessEnv`, whose Next.js augmentation
 * marks `NODE_ENV` required — that would stop tests from passing a partial
 * environment to prove the validation actually fails.
 */
export type EnvSource = Record<string, string | undefined>;

function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration.\n${issues}\n\n` +
        'Copy .env.example to .env.local (app) or .env (worker) and fill the ' +
        'missing values. Every variable is documented in .env.example.',
    );
  }

  return result.data;
}

let cached: Env | undefined;

/** Parsed environment. Throws on first access if configuration is invalid. */
export function getEnv(): Env {
  assertServer();
  cached ??= parseEnv(process.env);
  return cached;
}

/**
 * Reads a phase-gated variable, failing loudly with the feature name attached
 * so the operator knows which integration is unconfigured.
 */
export function requireEnv<K extends keyof Env>(key: K, feature: string): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === '') {
    throw new Error(
      `${String(key)} is required for ${feature} but is not set. See .env.example.`,
    );
  }
  return value as NonNullable<Env[K]>;
}

/** Exported for tests: validate an arbitrary env object without touching the cache. */
export const __testing = { parseEnv, envSchema };
