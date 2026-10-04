/**
 * Seed the company directory — and nothing else.
 *
 *   npm run companies:seed
 *
 * ## Why this exists separately from `native:import`
 *
 * `/companies` renders "Run the native content importer to populate the
 * directory", and the only importer that did so was
 * `scripts/import-native-problems.ts`, which is all-or-nothing: it seeds the
 * ten companies *inside* `importNativeProblemLibrary`, in the same transaction
 * as the hundred generated problems, and then imports twenty papers that hold
 * foreign keys into those problems.
 *
 * The problems are ten problems wearing a hundred skins — identical test cases,
 * identical reference solutions, identical function contract, distinct prose.
 * See `docs/decisions.md` D27. They are being replaced with hand-authored ones,
 * so importing them to fix an empty directory would have meant inserting
 * content we intend to throw away.
 *
 * The companies are the one genuinely non-generated piece: ten records with
 * written overviews. This script inserts those and stops.
 *
 * ## What it does NOT do
 *
 * No problems. No papers. Papers are not merely omitted here — they *cannot* be
 * imported without the problems, because `importAssessmentPaperLibrary` resolves
 * every `problemSlug` to a row and throws when one is missing. That is a
 * property of the data, not a limitation of this script.
 *
 * Idempotent: upserts on `companies_slug_key`, so running it twice updates the
 * overviews rather than failing or duplicating.
 */
import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { companies } from '@/server/db/schema';
import { requireDirectDatabaseUrl } from '@/server/db/direct-url';
import { assertNotProductionUnlessFlagged } from '@/lib/db/production-guard';

/**
 * The same shape `import-native-problems.ts` validates, deliberately duplicated
 * rather than shared: if that importer's schema ever loosens, this one should
 * not loosen with it silently.
 *
 * `min(40)` on the overview is not decoration. A company entry with a one-line
 * overview cannot carry the "-style" framing and the non-affiliation sentence
 * that C3 requires, so the length floor is what stops a thin entry passing.
 */
const companySeedSchema = z.array(
  z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(2),
    overview: z.string().min(40),
  }),
);

const url = requireDirectDatabaseUrl(process.env, 'seed companies');
assertNotProductionUnlessFlagged(url, 'the database URL (scripts/seed-companies.ts)');

const seeds = companySeedSchema.parse(
  JSON.parse(await readFile('data/companies.json', 'utf8')),
);

/*
 * C3 as an assertion rather than a convention.
 *
 * Every overview must carry the "-style" framing and must never describe its
 * content as a real interview question. The database CHECK
 * `problem_tags_company_style_suffix` enforces this for TAGS; nothing enforced
 * it for the company overviews, which is why it is checked here, before a
 * single row is written.
 */
/*
 * Deliberately strict, and deliberately blind to negation: it fires on the
 * phrase wherever it appears, including inside a disclaimer that is saying the
 * opposite. Flipkart's overview originally read "nothing here is presented as
 * an official or previously asked question" and was rejected by this check, so
 * the sentence was reworded rather than the check loosened. A false positive
 * costs one edit; a false negative ships a C3 breach.
 */
const FORBIDDEN =
  /\b(actual|real|previously asked|past)\s+(company\s+)?(interview\s+)?questions?\b/i;

/** A company name is data, so it is escaped before becoming part of a pattern. */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const violations = seeds.flatMap((seed) => {
  const problems: string[] = [];
  if (!new RegExp(`${escapeRegExp(seed.name)}-style`, 'i').test(seed.overview)) {
    problems.push(`overview does not contain "${seed.name}-style"`);
  }
  if (FORBIDDEN.test(seed.overview)) {
    problems.push('overview claims a real or previously asked question');
  }
  if (!/not affiliated/i.test(seed.overview)) {
    problems.push('overview does not state non-affiliation');
  }
  return problems.map((problem) => `${seed.slug}: ${problem}`);
});

if (violations.length > 0) {
  throw new Error(`C3 violations in data/companies.json:\n  ${violations.join('\n  ')}`);
}

const client = postgres(url, { max: 1 });

try {
  const db = drizzle(client, { casing: 'snake_case' });

  const rows = await db
    .insert(companies)
    .values(
      seeds.map((seed) => ({ slug: seed.slug, name: seed.name, overview: seed.overview })),
    )
    .onConflictDoUpdate({
      target: companies.slug,
      set: {
        name: sql`excluded.name`,
        overview: sql`excluded.overview`,
        updatedAt: new Date(),
      },
    })
    .returning({ slug: companies.slug });

  console.log(
    JSON.stringify(
      {
        companies: rows.length,
        slugs: rows.map((row) => row.slug),
        problems: 0,
        papers: 0,
        note: 'Companies only. Problems and papers are deliberately not imported.',
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
