/**
 * A Preview build must not be pointed at the production database.
 *
 * Vercel holds these values as Sensitive: `vercel env pull` returns a redacted
 * placeholder, so they cannot be checked from a laptop. They ARE present in the
 * build environment, so `scripts/check-deployment-env.ts` (which `vercel.json`
 * runs before every build) checks them there, with the production guard, and
 * fails a Preview build that names production. D30 recorded that
 * `DATABASE_URL_UNPOOLED` was one entry shared with Production; this makes that
 * class of mistake a failed build instead of a note.
 *
 * Returns variable NAMES only. A value, URL or host is never returned, so the
 * build log cannot leak one.
 */
import { isProductionHost } from '@/lib/db/production-guard';

/** Every database variable a Preview build could hand to the app or a tool. */
export const DATABASE_VARIABLES = [
  'DATABASE_URL',
  'DIRECT_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'TEST_DATABASE_URL',
] as const;

export type PreviewDatabaseProblems = {
  /** Set, and the production database. */
  production: string[];
  /** Set, but not a URL, so it cannot be shown NOT to be production. */
  unparseable: string[];
};

export function previewDatabaseProblems(
  env: Record<string, string | undefined>,
): PreviewDatabaseProblems {
  const problems: PreviewDatabaseProblems = { production: [], unparseable: [] };

  for (const name of DATABASE_VARIABLES) {
    const value = env[name];
    if (!value) continue;

    let hostname: string;
    try {
      hostname = new URL(value).hostname;
    } catch {
      problems.unparseable.push(name);
      continue;
    }

    if (isProductionHost(hostname, env['PRODUCTION_DB_HOST'])) problems.production.push(name);
  }

  return problems;
}
