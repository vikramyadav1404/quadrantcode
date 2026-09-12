/**
 * Backfill `problems.external_url_normalised` — idempotent.
 *
 *   npx tsx scripts/backfill-normalised-urls.ts
 *   npx tsx scripts/backfill-normalised-urls.ts --dry-run
 *
 * Migration 0007 adds the column as NULL for every existing row. It cannot fill
 * it: the normaliser is TypeScript, and expressing LeetCode's tab suffixes and
 * Codeforces' two-URL problem in SQL would mean maintaining the rule twice.
 * So the migration adds the column and this fills it.
 *
 * **Run this after migrating an environment that already has problems.** Until
 * it runs, those rows have a NULL dedup key, so an import would not recognise
 * them as duplicates and would create second copies. On a fresh database there
 * is nothing to do — the seed derives the column itself — and this exits
 * immediately.
 *
 * Idempotent: re-running rewrites the same values, because the normaliser is
 * idempotent (asserted in `tests/ingest/normalise-url.test.ts`).
 */
import 'dotenv/config';
import { isNotNull } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from '@/server/db/client';
import { problems } from '@/server/db/schema';
import { normaliseProblemUrl } from '@/server/services/ingest/normalise-url';

type Outcome = { scanned: number; updated: number; unchanged: number; unparseable: string[] };

export async function backfillNormalisedUrls(
  db: ReturnType<typeof getDb>,
  options: { dryRun?: boolean } = {},
): Promise<Outcome> {
  const rows = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      externalUrl: problems.externalUrl,
      stored: problems.externalUrlNormalised,
    })
    .from(problems)
    .where(isNotNull(problems.externalUrl));

  const outcome: Outcome = { scanned: rows.length, updated: 0, unchanged: 0, unparseable: [] };

  for (const row of rows) {
    const expected = normaliseProblemUrl(row.externalUrl);

    /*
     * A stored URL the normaliser refuses is reported, never silently written
     * as NULL. It means a row got in before the rule existed, or through a path
     * that did not validate — either way somebody needs to look at it, and a
     * script that quietly nulled the dedup key would hide exactly that.
     */
    if (expected === null) {
      outcome.unparseable.push(`${row.slug} → ${row.externalUrl}`);
      continue;
    }

    if (row.stored === expected) {
      outcome.unchanged += 1;
      continue;
    }

    if (!options.dryRun) {
      await db
        .update(problems)
        .set({ externalUrlNormalised: expected })
        .where(eq(problems.id, row.id));
    }
    outcome.updated += 1;
  }

  return outcome;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const db = getDb();

  const outcome = await backfillNormalisedUrls(db, { dryRun });

  console.log(
    JSON.stringify({
      event: 'backfill.normalised_urls',
      dryRun,
      ...outcome,
      unparseable: outcome.unparseable.length,
    }),
  );

  for (const entry of outcome.unparseable) {
    console.warn(`  UNPARSEABLE (left as-is, needs a human): ${entry}`);
  }

  await closeDb();

  // A non-zero exit on unparseable rows: this is the one outcome that needs
  // attention, and a green exit would bury it in a log nobody reads.
  if (outcome.unparseable.length > 0) process.exitCode = 1;
}

// Only run when invoked directly, so the function above stays importable by
// tests without the script's process-level side effects.
if (process.argv[1]?.includes('backfill-normalised-urls')) {
  void main();
}
