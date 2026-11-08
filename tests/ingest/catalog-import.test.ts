/**
 * The admin catalog import (`server/services/ingest/catalog.ts`), against a
 * real database.
 *
 * As in `import.test.ts`, what matters is what the DATABASE ends up holding, so
 * the assertions count rows rather than trusting the returned counts alone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseImportCsv } from '@/server/services/ingest/csv';
import {
  importCatalogChunk,
  previewCatalogImport,
  toTopicTag,
  uniqueByUrl,
} from '@/server/services/ingest/catalog';
import { importRows } from '@/server/services/ingest/import';
import { CATALOG_IMPORT_LIMITS } from '@/server/services/ingest/limits';
import { listProblems, parseFilters } from '@/server/services/problems';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const HEADER = 'title,url,difficulty,topic,platform';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

/** Invented judge, so no row depends on a real platform's catalogue. */
const row = (n: number, topic = 'Binary Search; arrays') =>
  `Catalog Problem ${n},https://judge.example.com/problems/catalog-${n},medium,"${topic}",`;

async function parse(source: string) {
  return parseImportCsv(source, CATALOG_IMPORT_LIMITS);
}

/** Runs every chunk of a file the way the route does, and sums the results. */
async function importAll(ctx: TestContext, source: string, actorId: string) {
  const { unique } = uniqueByUrl((await parse(source)).valid);
  const totals = { created: 0, published: 0, alreadyInCatalog: 0, chunks: 0 };
  for (let offset = 0; offset < unique.length; offset += CATALOG_IMPORT_LIMITS.chunkRows) {
    const result = await importCatalogChunk(
      ctx.db,
      unique.slice(offset, offset + CATALOG_IMPORT_LIMITS.chunkRows),
      actorId,
    );
    totals.created += result.created;
    totals.published += result.published;
    totals.alreadyInCatalog += result.alreadyInCatalog;
    totals.chunks += 1;
  }
  return totals;
}

describe('toTopicTag', () => {
  it('turns a written topic into a catalog tag', () => {
    expect(toTopicTag('Binary Search')).toBe('binary-search');
    expect(toTopicTag('  Dynamic   Programming ')).toBe('dynamic-programming');
    expect(toTopicTag('two-pointers')).toBe('two-pointers');
    expect(toTopicTag('C++ / STL')).toBe('c-stl');
  });

  it('returns null when nothing usable is left', () => {
    expect(toTopicTag('---')).toBeNull();
    expect(toTopicTag('  ')).toBeNull();
  });
});

describe('uniqueByUrl', () => {
  it('keeps the first row for each link and counts the repeats', async () => {
    const parsed = await parse(
      csv(row(1), row(2), 'Repeat,https://judge.example.com/problems/catalog-1/,easy,,'),
    );
    const { unique, repeated } = uniqueByUrl(parsed.valid);
    expect(unique.map((r) => r.title)).toEqual(['Catalog Problem 1', 'Catalog Problem 2']);
    expect(repeated).toBe(1);
  });
});

suite('admin catalog import', () => {
  let ctx: TestContext;
  let adminId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    adminId = (await createUser(ctx.db, { email: 'admin@example.com', role: 'admin' })).id;
  });

  it('creates PUBLISHED external links with kebab-case topics, visible in the catalog', async () => {
    const totals = await importAll(ctx, csv(row(1), row(2)), adminId);
    expect(totals).toMatchObject({ created: 2, published: 0, alreadyInCatalog: 0 });

    const problems = await ctx.sql`
      SELECT status, source_type, statement, external_url_normalised FROM problems ORDER BY title
    `;
    expect(problems.map((p) => p.status)).toEqual(['published', 'published']);
    expect(
      problems.every((p) => p.source_type === 'external_link' && p.statement === null),
    ).toBe(true);

    const tags = await ctx.sql`SELECT DISTINCT tag_value FROM problem_tags ORDER BY tag_value`;
    expect(tags.map((t) => t.tag_value)).toEqual(['arrays', 'binary-search']);

    const page = await listProblems({
      db: ctx.db,
      filters: parseFilters({ limit: 50, topic: 'binary-search' }),
    });
    expect(page.rows.map((r) => r.title).sort()).toEqual([
      'Catalog Problem 1',
      'Catalog Problem 2',
    ]);
  });

  it('is idempotent: running the same file again adds nothing', async () => {
    await importAll(ctx, csv(row(1), row(2)), adminId);
    const again = await importAll(ctx, csv(row(1), row(2)), adminId);

    expect(again).toMatchObject({ created: 0, published: 0, alreadyInCatalog: 2 });
    const [counted] = await ctx.sql`SELECT count(*)::int AS count FROM problems`;
    expect(counted!.count).toBe(2);
  });

  it("publishes a user's private draft of the same link, keeping the user's link to it", async () => {
    const user = await createUser(ctx.db, { email: 'learner@example.com' });
    const personal = await parseImportCsv(
      'title,url,difficulty\nmy notes,https://judge.example.com/problems/catalog-1,easy',
    );
    await importRows(ctx.db, user.id, personal.valid);

    const totals = await importAll(ctx, csv(row(1)), adminId);
    expect(totals).toMatchObject({ created: 0, published: 1, alreadyInCatalog: 0 });

    const [problem] = await ctx.sql`SELECT id, status, title, difficulty FROM problems`;
    expect(problem).toMatchObject({
      status: 'published',
      title: 'Catalog Problem 1',
      difficulty: 'medium',
    });
    const links = await ctx.sql`
      SELECT 1 FROM user_problems WHERE user_id = ${user.id} AND problem_id = ${problem!.id}
    `;
    expect(links).toHaveLength(1);
  });

  it('leaves an already-published problem exactly as it is', async () => {
    await importAll(ctx, csv(row(1)), adminId);
    await ctx.sql`UPDATE problems SET title = 'Edited by an admin'`;

    const totals = await importAll(
      ctx,
      csv('Different Title,https://judge.example.com/problems/catalog-1,hard,graphs,'),
      adminId,
    );
    expect(totals).toMatchObject({ created: 0, published: 0, alreadyInCatalog: 1 });

    const [problem] = await ctx.sql`SELECT title, difficulty FROM problems`;
    expect(problem).toMatchObject({ title: 'Edited by an admin', difficulty: 'medium' });
  });

  it('creates a new row for a link whose only problem is archived', async () => {
    await importAll(ctx, csv(row(1)), adminId);
    await ctx.sql`UPDATE problems SET status = 'archived'`;

    const totals = await importAll(ctx, csv(row(1)), adminId);
    expect(totals.created).toBe(1);
    const statuses = await ctx.sql`SELECT status FROM problems`;
    // Sorted here: ORDER BY on an enum follows the enum's order, not the alphabet.
    expect(statuses.map((s) => String(s.status)).sort()).toEqual(['archived', 'published']);
  });

  it('previews without writing, counting new, drafts, existing, repeats and invalid rows', async () => {
    const user = await createUser(ctx.db, { email: 'learner@example.com' });
    await importRows(
      ctx.db,
      user.id,
      (
        await parseImportCsv(
          'title,url,difficulty\ndraft,https://judge.example.com/problems/catalog-2,easy',
        )
      ).valid,
    );
    await importAll(ctx, csv(row(3)), adminId);
    const before = await ctx.sql`SELECT count(*)::int AS count FROM problems`;

    const preview = await previewCatalogImport(
      ctx.db,
      await parse(
        csv(
          row(1),
          row(2),
          row(3),
          row(1),
          'No Link,,easy,,',
          'Bad Difficulty,https://judge.example.com/problems/x,trivial,,',
        ),
      ),
    );

    expect(preview).toMatchObject({
      totalRows: 6,
      validCount: 4,
      invalidCount: 2,
      repeatedInFile: 1,
      importable: 3,
      toCreate: 1,
      toPublish: 1,
      alreadyInCatalog: 1,
    });
    expect(preview.invalid.map((r) => r.field)).toEqual(['url', 'difficulty']);
    const after = await ctx.sql`SELECT count(*)::int AS count FROM problems`;
    expect(after[0]!.count).toBe(before[0]!.count);
  });

  it('writes one audit entry per chunk, against the admin', async () => {
    await importCatalogChunk(ctx.db, (await parse(csv(row(1), row(2)))).valid, adminId);

    const audits = await ctx.sql`
      SELECT actor_id, action, target, diff FROM audit_logs WHERE action = 'catalog.csv_imported'
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: adminId, target: 'problems' });
    expect((audits[0]!.diff as { after: unknown }).after).toMatchObject({
      rows: 2,
      created: 2,
    });
  });

  it('imports 4,000 rows in 500-row chunks', async () => {
    const rows = Array.from({ length: 4_000 }, (_, i) => row(i + 1, 'arrays'));
    const started = Date.now();
    const totals = await importAll(ctx, csv(...rows), adminId);
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `catalog import: 4,000 rows in ${totals.chunks} chunks, ${seconds.toFixed(1)} s`,
    );

    expect(totals).toMatchObject({
      created: 4_000,
      published: 0,
      alreadyInCatalog: 0,
      chunks: 8,
    });
    const [counted] = await ctx.sql`
      SELECT count(*)::int AS count FROM problems WHERE status = 'published'
    `;
    expect(counted!.count).toBe(4_000);
  }, 120_000);
});
