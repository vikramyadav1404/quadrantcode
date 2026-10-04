/**
 * Refuse to start a test, e2e or seed process against the production database
 * (issue #27).
 *
 * ## Why this exists
 *
 * `.env.local` holds production values on the owner's machine, and Next loads
 * it in `next build`, `next start` and `next dev`. The app-side check in
 * `server/env.ts` exempts `NODE_ENV=production` — which is exactly what
 * Playwright's `next start` runs as — so a local e2e run had nothing standing
 * between it and production. This module is that thing, for every process that
 * creates fixtures, truncates tables or seeds.
 *
 * ## Matched on the host, without the host in the repo
 *
 * The repository is public, so the production hostname is not written here.
 * What is written is the SHA-256 of its Neon **endpoint id** — the first DNS
 * label with Neon's `-pooler` suffix removed — so the pooled and the direct
 * URL of the same database both match, and nothing in this file or in any
 * error message reveals which host it is.
 *
 * `PRODUCTION_DB_HOST` may name further hosts (comma-separated) without a code
 * change; it is matched the same way and is never printed either.
 *
 * ## What it deliberately does not do
 *
 * It does not refuse every remote host. A Neon branch made for testing is a
 * legitimate target, and the risk this guards is one specific database.
 */
import { createHash } from 'node:crypto';

/** SHA-256 of the production Neon endpoint id. A hash, because this repo is public. */
export const PRODUCTION_ENDPOINT_SHA256 =
  '852ce3d2c17f77dc778c2a22ea878c49e9e0acdc4c9de87eabd013c3d2ba1c65';

export class ProductionDatabaseError extends Error {
  readonly code = 'PRODUCTION_DATABASE_REFUSED';

  constructor(message: string) {
    super(message);
    this.name = 'ProductionDatabaseError';
  }
}

/** The first DNS label, lower-cased, with Neon's `-pooler` suffix removed. */
export function endpointIdOf(hostname: string): string {
  const first = hostname.trim().toLowerCase().split('.')[0] ?? '';
  return first.replace(/-pooler$/, '');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * True when `hostname` is the production database, by hash or by `PRODUCTION_DB_HOST`.
 *
 * `hashes` is a parameter only so the test can exercise the hash path with an
 * invented endpoint instead of writing the real one into the repo.
 */
export function isProductionHost(
  hostname: string,
  extraHosts: string | undefined = process.env['PRODUCTION_DB_HOST'],
  hashes: readonly string[] = [PRODUCTION_ENDPOINT_SHA256],
): boolean {
  const id = endpointIdOf(hostname);
  if (id === '') return false;
  if (hashes.includes(sha256(id))) return true;

  return (extraHosts ?? '')
    .split(',')
    .map((host) => endpointIdOf(host))
    .some((extra) => extra !== '' && extra === id);
}

/**
 * Throws before any connection is opened if `url` points at production.
 *
 * `label` names the variable and the process ("TEST_DATABASE_URL in
 * playwright.config.ts"). The message never contains the URL or the host —
 * it may end up in CI logs, and the point of hashing above is lost the moment
 * an error prints what was matched.
 *
 * An unset URL passes: there is nothing to connect to, and each caller already
 * reports a missing variable its own way. An unparseable one is refused,
 * because it cannot be shown NOT to be production.
 */
export function assertNotProductionDatabase(
  url: string | undefined,
  label: string,
  hint = 'Tests, e2e runs and seed scripts must use the local test database — see ' +
    'the "Testing" section of the README.',
): void {
  if (!url) return;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new ProductionDatabaseError(
      `${label} could not be parsed, so it cannot be checked against the production ` +
        'database. Refusing to start.',
    );
  }

  if (isProductionHost(hostname)) {
    throw new ProductionDatabaseError(
      `${label} points at the PRODUCTION database. Refusing to start. ${hint}`,
    );
  }
}

/** The command-line flag that lets a content script write to production on purpose. */
export const PRODUCTION_FLAG = '--production';

/**
 * For the content loaders that production is legitimately seeded with
 * (`seed.ts`, `seed-companies.ts`, `import-native-problems.ts`).
 *
 * Refused like everything else unless `--production` is typed on THIS command
 * line. A flag, not an environment variable, so it cannot be left set in a
 * shell or a `.env` file and quietly apply to the next run.
 */
export function assertNotProductionUnlessFlagged(
  url: string | undefined,
  label: string,
  argv: readonly string[] = process.argv,
): void {
  if (argv.includes(PRODUCTION_FLAG)) return;
  assertNotProductionDatabase(
    url,
    label,
    `If you really mean to write to production, re-run with ${PRODUCTION_FLAG} on the ` +
      'command line, after taking a backup.',
  );
}

/** Checks each of `names` in `env`, so a caller can guard every variable it might read. */
export function assertEnvNotProduction(
  names: readonly string[],
  context: string,
  env: Record<string, string | undefined> = process.env,
): void {
  for (const name of names) assertNotProductionDatabase(env[name], `${name} (${context})`);
}
