/**
 * The direct (non-pooled) database URL, resolved the same way everywhere.
 *
 * Six places needed this and two of them disagreed. `drizzle.config.ts` and
 * `migrate.ts` read `DIRECT_DATABASE_URL` first; `seed.ts`, `seed-companies.ts`,
 * `import-native-problems.ts` and `rollback.ts` went straight to
 * `DATABASE_URL_UNPOOLED`. With one value set and not the other, half the tools
 * pointed at one database and half at another, and nothing said so.
 *
 * That stopped being hypothetical on 2026-09-22. Vercel's `DATABASE_URL_UNPOOLED`
 * is a single entry targeting Production AND Preview, so it cannot hold a
 * different value per environment; the Preview fix was to set a Preview-scoped
 * `DIRECT_DATABASE_URL` that shadows it. Any consumer skipping
 * `DIRECT_DATABASE_URL` reached past the preview URL to the production one.
 *
 * Order, and why:
 *
 * 1. `DIRECT_DATABASE_URL` — ours, set deliberately, per environment.
 * 2. `DATABASE_URL_UNPOOLED` — Neon's integration sets this; kept for
 *    compatibility, never preferred, because we cannot scope it.
 * 3. `DATABASE_URL` — the pooled URL. A last resort: migrations cannot run over
 *    a transaction pooler, so a caller landing here may still fail, but failing
 *    with a real connection beats failing with `undefined`.
 *
 * Not a Next.js module: `drizzle.config.ts` and the scripts run under plain
 * `tsx`, so this file must stay free of `server-only` and of anything that
 * needs the `react-server` export condition.
 */
export const DIRECT_URL_VARS = [
  'DIRECT_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'DATABASE_URL',
] as const;

export function resolveDirectDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const name of DIRECT_URL_VARS) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** The same resolution, but it throws with the variable names instead of returning undefined. */
export function requireDirectDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
  purpose = 'connect to the database',
): string {
  const url = resolveDirectDatabaseUrl(env);
  if (!url) {
    throw new Error(
      `${DIRECT_URL_VARS.join(', ')} are all unset — one is required to ${purpose}. ` +
        'See .env.example.',
    );
  }
  return url;
}
