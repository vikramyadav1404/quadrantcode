/**
 * SHARED environment — safe in a client bundle.
 *
 * This half holds only values that are already public: `NEXT_PUBLIC_*` and the
 * run mode. It contains no secret, so it needs no guard and can be imported
 * from a Client Component.
 *
 * Secrets live in `server/env.ts`, which is server-side only. The split is the
 * point: a component that needs the app URL must not drag the secret schema
 * into the browser bundle just to read one variable.
 */
import { z } from 'zod';

/**
 * Deliberately looser than `NodeJS.ProcessEnv`, whose Next.js augmentation
 * marks `NODE_ENV` required — that would stop tests from passing a partial
 * environment to prove validation actually fails.
 */
export type EnvSource = Record<string, string | undefined>;

export const publicEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Absolute origin used for magic links, OG images and webhook callbacks. */
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  /** Public Sentry ingestion endpoint. A DSN identifies a project; it is not an auth secret. */
  NEXT_PUBLIC_SENTRY_DSN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  /** Public support mailbox shown on legal and contact pages. */
  NEXT_PUBLIC_SUPPORT_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().email().optional(),
  ),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function formatEnvIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export function parsePublicEnv(source: EnvSource): PublicEnv {
  const result = publicEnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(
      `Invalid public environment configuration.\n${formatEnvIssues(result.error)}\n\n` +
        'Every variable is documented in .env.example.',
    );
  }

  return result.data;
}

let cachedPublic: PublicEnv | undefined;

/** Public environment. Safe to call from anywhere, including the browser. */
export function getPublicEnv(): PublicEnv {
  cachedPublic ??= parsePublicEnv(process.env);
  return cachedPublic;
}

/** Exported for tests: parse an arbitrary object without touching the cache. */
export const __testing = { parsePublicEnv };
