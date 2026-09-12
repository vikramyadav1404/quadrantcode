/**
 * F1.2 · the dedup key as a DATABASE guarantee, not a service convention.
 *
 * The import service looks up `external_url_normalised` before inserting. That
 * lookup is a read followed by a write, so two concurrent imports of the same
 * list can both read "not present" and both insert. The unique index is what
 * makes that impossible, and it is the reason the service can treat a unique
 * violation as "someone else just created it" instead of an error.
 *
 * These tests exercise the constraint DIRECTLY rather than through the service,
 * for the same reason `tests/schema/constraints.test.ts` does: if the guarantee
 * only holds because the service happens to check first, it is not a guarantee.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { problems } from '@/server/db/schema';
import { normaliseProblemUrl } from '@/server/services/ingest/normalise-url';
import {
  type TestContext,
  expectDbRejection,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

const URL_A = 'https://leetcode.com/problems/two-sum/';

function externalProblem(overrides: Record<string, unknown> = {}) {
  return {
    slug: `dedup-${Math.random().toString(36).slice(2, 10)}`,
    title: 'Two Sum',
    sourceType: 'external_link' as const,
    platform: 'leetcode',
    externalUrl: URL_A,
    externalUrlNormalised: normaliseProblemUrl(URL_A),
    difficulty: 'easy' as const,
    status: 'published' as const,
    ...overrides,
  };
}

suite('F1.2 · problems_external_url_normalised_key', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
  });

  it('rejects a second problem with the same normalised URL', async () => {
    await ctx.db.insert(problems).values(externalProblem());

    await expectDbRejection(
      ctx.db.insert(problems).values(externalProblem()),
      'problems_external_url_normalised_key',
    );
  });

  it('rejects it even when the two URLs LOOK different', async () => {
    /*
     * The whole point. These are four distinct strings in `external_url`, and
     * the database still refuses the second one — because the column it is
     * unique on is derived, not the raw URL.
     */
    await ctx.db.insert(problems).values(externalProblem());

    for (const surfaceForm of [
      'http://leetcode.com/problems/two-sum',
      'https://www.leetcode.com/problems/two-sum/',
      'https://leetcode.com/problems/Two-Sum/description/?ref=x',
    ]) {
      await expectDbRejection(
        ctx.db.insert(problems).values(
          externalProblem({
            externalUrl: surfaceForm,
            externalUrlNormalised: normaliseProblemUrl(surfaceForm),
          }),
        ),
        'problems_external_url_normalised_key',
      );
    }
  });

  it('ACCEPTS two genuinely different problems', async () => {
    // The positive control. A constraint that rejects everything would pass
    // every test above.
    const other = 'https://leetcode.com/problems/three-sum/';

    await ctx.db.insert(problems).values(externalProblem());
    await ctx.db.insert(problems).values(
      externalProblem({
        title: 'Three Sum',
        externalUrl: other,
        externalUrlNormalised: normaliseProblemUrl(other),
      }),
    );

    const rows = await ctx.sql`SELECT id FROM problems`;
    expect(rows).toHaveLength(2);
  });

  it('frees the URL once a problem is archived', async () => {
    /*
     * The `status <> 'archived'` half of the partial index, and the reason it
     * is there: archiving is a visibility change, so a user who archived a
     * problem must be able to add it again. A plain unique index would reserve
     * that URL permanently and the second attempt would fail with a conflict
     * against a row nobody can see.
     */
    await ctx.db.insert(problems).values(externalProblem());
    await ctx.sql`UPDATE problems SET status = 'archived'`;

    await ctx.db.insert(problems).values(externalProblem());

    const live = await ctx.sql`SELECT id FROM problems WHERE status <> 'archived'`;
    expect(live).toHaveLength(1);
  });

  it('does not collide original problems, which have no URL', async () => {
    // Every original problem has NULL here. Postgres treats NULLs as distinct
    // in a unique index, but asserting it means a future switch to NULLS NOT
    // DISTINCT cannot land silently and break original-problem authoring.
    for (let index = 0; index < 3; index += 1) {
      await ctx.db.insert(problems).values({
        slug: `original-${index}`,
        title: `Original ${index}`,
        sourceType: 'original',
        externalUrl: null,
        externalUrlNormalised: null,
        difficulty: 'medium',
        status: 'draft',
      });
    }

    const rows = await ctx.sql`SELECT id FROM problems WHERE source_type = 'original'`;
    expect(rows).toHaveLength(3);
  });
});

suite('F1.2 · the stored key cannot drift from the function', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('every seeded row matches normaliseProblemUrl(external_url)', async () => {
    /*
     * The drift detector the column comment promises.
     *
     * `external_url_normalised` is maintained by application code rather than
     * being GENERATED, which buys the ability to express platform rules in
     * TypeScript and costs the guarantee that the two agree. This is what buys
     * that guarantee back — and specifically what catches a NEW write path
     * being added without deriving the column, which is how the seed script
     * nearly shipped wrong.
     */
    await truncateAll(ctx.sql);
    const { seedProblems } = await import('../../scripts/seed');
    await seedProblems(ctx.db as never);

    const rows = await ctx.sql`
      SELECT slug, external_url, external_url_normalised FROM problems
    `;
    expect(rows.length).toBeGreaterThan(0);

    const drifted = rows
      .filter((row) => row.external_url_normalised !== normaliseProblemUrl(row.external_url))
      .map((row) => row.slug);

    expect(drifted, 'these rows have a stale or missing dedup key').toEqual([]);
  });
});
