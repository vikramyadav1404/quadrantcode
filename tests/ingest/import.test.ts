/**
 * F1.2 · the import service, against a real database.
 *
 * Idempotency and dedup are claims about what the DATABASE ends up containing,
 * so they are asserted by counting rows after the fact rather than by trusting
 * the service's own return value. A service that reported `duplicate` while
 * quietly inserting would pass any test that only read what it returned.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseImportCsv } from '@/server/services/ingest/csv';
import { importRows, slugForImportedUrl } from '@/server/services/ingest/import';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;
const HEADER = 'title,platform,url,difficulty,topic';

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const TWO_SUM = 'Two Sum,leetcode,https://leetcode.com/problems/two-sum/,easy,arrays';
const THREE_SUM = 'Three Sum,leetcode,https://leetcode.com/problems/three-sum/,medium,arrays';

async function rowsFrom(source: string) {
  return (await parseImportCsv(source)).valid;
}

suite('F1.2 · importRows', () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    userId = (await createUser(ctx.db, { email: 'importer@example.com' })).id;
  });

  it('creates a draft problem and links it to the user', async () => {
    const results = await importRows(ctx.db, userId, await rowsFrom(csv(TWO_SUM)));

    expect(results[0]?.outcome).toBe('created');

    const [problem] = await ctx.sql`
      SELECT status, source_type, external_url_normalised, statement FROM problems
    `;
    expect(problem!.status).toBe('draft');
    expect(problem!.source_type).toBe('external_link');
    expect(problem!.external_url_normalised).toBe('leetcode.com/problems/two-sum');
    // C1: the importer has no statement field to populate, and does not.
    expect(problem!.statement).toBeNull();

    const links = await ctx.sql`SELECT id FROM user_problems WHERE user_id = ${userId}`;
    expect(links).toHaveLength(1);
  });

  it('keeps an imported problem OUT of the public catalog', async () => {
    /*
     * The whole basis of the draft decision. If this ever failed, one user's
     * 500-row import would appear in everyone's /problems list.
     */
    await importRows(ctx.db, userId, await rowsFrom(csv(TWO_SUM)));

    const published = await ctx.sql`SELECT id FROM problems WHERE status = 'published'`;
    expect(published).toHaveLength(0);
  });

  it('is idempotent — the same file twice changes nothing', async () => {
    // The acceptance criterion. Counted from the database, not from the return.
    const rows = await rowsFrom(csv(TWO_SUM, THREE_SUM));

    const first = await importRows(ctx.db, userId, rows);
    expect(first.map((row) => row.outcome)).toEqual(['created', 'created']);

    const second = await importRows(ctx.db, userId, rows);
    expect(second.map((row) => row.outcome)).toEqual(['duplicate', 'duplicate']);

    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(2);
    expect(await ctx.sql`SELECT id FROM user_problems`).toHaveLength(2);
  });

  it('detects a duplicate across DIFFERENT surface forms of the same URL', async () => {
    /*
     * The acceptance criterion the normaliser exists for: http vs https, a
     * trailing slash, a ?ref=, and the /description/ tab are one problem.
     */
    await importRows(ctx.db, userId, await rowsFrom(csv(TWO_SUM)));

    const disguised = await rowsFrom(
      csv(
        'Two Sum,leetcode,http://www.leetcode.com/problems/two-sum,easy,',
        'Two Sum,leetcode,https://leetcode.com/problems/Two-Sum/description/?ref=hn,easy,',
      ),
    );
    const results = await importRows(ctx.db, userId, disguised);

    expect(results.map((row) => row.outcome)).toEqual(['duplicate', 'duplicate']);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(1);
  });

  it('LINKS rather than creates when another user already imported the URL', async () => {
    // The catalog is shared. The second user gets a link, not a second copy,
    // and their count must say `linked` so the UI does not claim they added a
    // problem that already existed.
    const other = await createUser(ctx.db, { email: 'other@example.com' });
    await importRows(ctx.db, other.id, await rowsFrom(csv(TWO_SUM)));

    const results = await importRows(ctx.db, userId, await rowsFrom(csv(TWO_SUM)));

    expect(results[0]?.outcome).toBe('linked');
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(1);
    expect(await ctx.sql`SELECT id FROM user_problems`).toHaveLength(2);
  });

  it('imports the valid rows from a file that also has invalid ones', async () => {
    // Partial success, end to end: parse reports 3 errors, import commits 2.
    const parsed = await parseImportCsv(
      csv(
        TWO_SUM,
        ',leetcode,https://leetcode.com/problems/a/,easy,',
        'No URL,leetcode,,easy,',
        'Bad,leetcode,https://leetcode.com/problems/b/,trivial,',
        THREE_SUM,
      ),
    );

    expect(parsed.invalid).toHaveLength(3);
    const results = await importRows(ctx.db, userId, parsed.valid);

    expect(results).toHaveLength(2);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(2);
  });

  it('attaches topic tags from the CSV', async () => {
    await importRows(
      ctx.db,
      userId,
      await rowsFrom(
        csv('Two Sum,leetcode,https://leetcode.com/problems/two-sum/,easy,"arrays, hashing"'),
      ),
    );

    const tags = await ctx.sql`SELECT tag_value FROM problem_tags ORDER BY tag_value`;
    expect(tags.map((tag) => tag.tag_value)).toEqual(['arrays', 'hashing']);
  });

  it('deduplicates repeated URLs WITHIN one file', async () => {
    // A user's own CSV routinely contains the same link twice. The in-chunk
    // map has to catch that, or the second occurrence hits the unique index.
    const results = await importRows(
      ctx.db,
      userId,
      await rowsFrom(csv(TWO_SUM, TWO_SUM, TWO_SUM)),
    );

    expect(results.map((row) => row.outcome)).toEqual(['created', 'duplicate', 'duplicate']);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(1);
  });

  it('does not resurrect an archived problem into the public catalog', async () => {
    await importRows(ctx.db, userId, await rowsFrom(csv(TWO_SUM)));
    await ctx.sql`UPDATE problems SET status = 'archived'`;

    const other = await createUser(ctx.db, { email: 'second@example.com' });
    await importRows(ctx.db, other.id, await rowsFrom(csv(TWO_SUM)));

    /*
     * The archived row is invisible to the dedup lookup, matching the partial
     * unique index, so a NEW draft is created rather than the archived one
     * being silently un-archived. Un-archiving on import would let any user
     * undo an admin's moderation decision by importing a CSV.
     */
    /*
     * `ORDER BY status::text`, not `ORDER BY status`. A Postgres enum sorts by
     * DECLARATION order, and problem_status is declared
     * draft → review → tested → published → archived — so the bare ordering
     * returns draft first and reads as alphabetical only by accident.
     */
    const rows = await ctx.sql`SELECT status FROM problems ORDER BY status::text`;
    expect(rows.map((row) => row.status)).toEqual(['archived', 'draft']);

    // And the live one is the draft, not a resurrected archive.
    const live = await ctx.sql`SELECT status FROM problems WHERE status <> 'archived'`;
    expect(live).toHaveLength(1);
  });
});

describe('F1.2 · slugForImportedUrl', () => {
  it('is NOT deterministic, deliberately', () => {
    /*
     * This assertion is inverted from how it was first written, and the reason
     * is the bug it caught. A URL-derived slug quietly asserts "one URL, one
     * row forever" — but the partial unique index lets an archived problem and
     * a live one share a URL, so that a user who archived something can add it
     * back. Deterministic slugs made that second insert collide on
     * `problems_slug_key`, and the row came back neither created nor findable.
     *
     * Identity is `external_url_normalised`. The slug is a readable handle.
     */
    const url = 'leetcode.com/problems/two-sum';
    expect(slugForImportedUrl(url)).not.toBe(slugForImportedUrl(url));
  });

  it('keeps a readable stem so the slug is still recognisable', () => {
    expect(slugForImportedUrl('leetcode.com/problems/two-sum')).toMatch(
      /^problems-two-sum-[0-9a-f]{8}$/,
    );
  });

  it('cannot collide with a curated slug', () => {
    // The seed uses bare slugs like `two-sum`. An import of the same URL must
    // not try to claim that slug, or the insert fails on `problems_slug_key`
    // for a reason that has nothing to do with dedup.
    expect(slugForImportedUrl('leetcode.com/problems/two-sum')).not.toBe('two-sum');
  });

  it('does not repeat across many calls', () => {
    // The property the uniqueness actually rests on.
    const url = 'leetcode.com/problems/two-sum';
    const slugs = new Set(Array.from({ length: 500 }, () => slugForImportedUrl(url)));
    expect(slugs.size).toBe(500);
  });

  it('stays a sane length for a pathological URL', () => {
    const long = `example.com/${'a'.repeat(500)}`;
    expect(slugForImportedUrl(long).length).toBeLessThanOrEqual(70);
  });
});
