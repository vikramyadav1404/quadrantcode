/**
 * Keep test, e2e and local-build processes off production's OTHER services
 * (issue #32). The sibling of `production-guard.ts`, which covers the database.
 *
 * ## Why this exists
 *
 * `.env.local` may hold production values on the owner's machine, and Next
 * loads it in `next build` and `next start`. Each test config already pins the
 * database variables (#27); before this, everything else came through:
 *
 * - Upstash: e2e traffic would count against PRODUCTION rate limits, and could
 *   lock real users, or the tests, out of a limited action.
 * - Sentry, server side: errors from deliberately hostile fixtures would be
 *   reported to the production project as noise or false alerts.
 * - Sentry, client side: `NEXT_PUBLIC_SENTRY_DSN` is inlined into the browser
 *   bundle at BUILD time, so a local build would report browser errors too.
 * - Sentry source maps: `SENTRY_AUTH_TOKEN` makes a local `next build` upload
 *   them to the production project.
 *
 * ## How: set them to the empty string
 *
 * Not deleted. Next's env loading (and dotenv) never overrides a variable that
 * is already set, and the empty string counts as set, so `.env.local` cannot
 * fill it. `tests/db/production-services.test.ts` proves that against Next's
 * own loader. The app already treats empty as absent: the env schema maps `''`
 * to undefined, the rate limiter needs both Upstash halves to be truthy, and
 * every `Sentry.init` is `enabled: Boolean(dsn)`.
 *
 * Production is untouched: nothing here runs in a deployment.
 */

/** Production services a test process must never reach, by the variable that reaches them. */
export const PRODUCTION_SERVICE_VARIABLES = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
] as const;

export type ProductionServiceVariable = (typeof PRODUCTION_SERVICE_VARIABLES)[number];

/** Each variable set to `''`, to spread into a child process's environment. */
export function blankedProductionServices(): Record<ProductionServiceVariable, ''> {
  return Object.fromEntries(PRODUCTION_SERVICE_VARIABLES.map((name) => [name, ''])) as Record<
    ProductionServiceVariable,
    ''
  >;
}

/** Sets each variable to `''` in `env`, in place. */
export function blankProductionServices(
  env: Record<string, string | undefined> = process.env,
): void {
  Object.assign(env, blankedProductionServices());
}

export class ProductionServiceError extends Error {
  readonly code = 'PRODUCTION_SERVICE_REFUSED';

  constructor(message: string) {
    super(message);
    this.name = 'ProductionServiceError';
  }
}

/**
 * Throws if any of the variables is non-empty in `env`, naming the variables
 * and never their values (the message may reach CI logs).
 *
 * Unset passes as well as empty: CI sets none of them, and there is nothing to
 * reach. What it refuses is a value, wherever it came from.
 */
export function assertNoProductionServices(
  env: Record<string, string | undefined>,
  context: string,
): void {
  const set = PRODUCTION_SERVICE_VARIABLES.filter((name) => Boolean(env[name]));
  if (set.length === 0) return;

  throw new ProductionServiceError(
    `${set.join(', ')} ${set.length === 1 ? 'is' : 'are'} set in ${context}. ` +
      'Test, e2e and local e2e-build processes must not reach production services. ' +
      'Refusing to start. See the "Testing" section of the README.',
  );
}
