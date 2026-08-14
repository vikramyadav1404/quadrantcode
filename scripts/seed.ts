/**
 * Seed script — idempotent.
 *
 * Re-running changes nothing: problems are upserted on their unique slug and
 * tags on their composite primary key. That property matters because the same
 * script runs on every fresh environment and in the integration test setup.
 *
 *   npx tsx scripts/seed.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { problemTags, problems } from '@/server/db/schema';
import { normaliseProblemUrl } from '@/server/services/ingest/normalise-url';
import { SEED_PROBLEMS } from './seed-problems';

export async function seedProblems(db: ReturnType<typeof drizzle>): Promise<number> {
  for (const problem of SEED_PROBLEMS) {
    const [row] = await db
      .insert(problems)
      .values({
        slug: problem.slug,
        title: problem.title,
        sourceType: 'external_link',
        platform: problem.platform,
        externalUrl: problem.externalUrl,
        /*
         * F1.2 dedup key. This script writes to `problems` DIRECTLY rather than
         * through `createProblem`, so it does not inherit the derivation on that
         * path and has to do it here. Same function, so the two cannot disagree
         * — and `tests/ingest/dedup.test.ts` asserts every stored row matches
         * `normaliseProblemUrl(external_url)`, which is what catches a third
         * write path being added without this line.
         */
        externalUrlNormalised: normaliseProblemUrl(problem.externalUrl),
        difficulty: problem.difficulty,
        estimatedMinutes: problem.estimatedMinutes,
        isPremium: false,
        status: 'published',
        // Statement-bearing columns stay NULL — C1, enforced by the CHECK
        // constraint `problems_external_link_no_statement`.
      })
      .onConflictDoUpdate({
        target: problems.slug,
        set: {
          title: problem.title,
          platform: problem.platform,
          externalUrl: problem.externalUrl,
          externalUrlNormalised: normaliseProblemUrl(problem.externalUrl),
          difficulty: problem.difficulty,
          estimatedMinutes: problem.estimatedMinutes,
          status: 'published',
        },
      })
      .returning({ id: problems.id });

    if (!row) throw new Error(`upsert returned no row for ${problem.slug}`);

    const tags = [
      ...problem.topics.map((value) => ({
        problemId: row.id,
        tagType: 'topic' as const,
        tagValue: value,
      })),
      ...problem.patterns.map((value) => ({
        problemId: row.id,
        tagType: 'pattern' as const,
        tagValue: value,
      })),
    ];

    await db.insert(problemTags).values(tags).onConflictDoNothing();
  }

  return SEED_PROBLEMS.length;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set to seed.');

  const client = postgres(url, { max: 1 });
  try {
    const count = await seedProblems(drizzle(client, { casing: 'snake_case' }));
    console.log(`seeded ${count} external-link problems`);
  } finally {
    await client.end();
  }
}

// Only run when invoked directly, so tests can import `seedProblems`.
if (process.argv[1]?.endsWith('seed.ts')) {
  main().catch((error: unknown) => {
    console.error('seed failed:', error);
    process.exit(1);
  });
}
