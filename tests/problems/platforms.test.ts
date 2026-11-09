/**
 * The catalog's platform filter: what it offers, and how a platform reads.
 *
 * The options are read from the data, so the two claims worth pinning are
 * that only PUBLISHED problems contribute a platform (an archived import must
 * not offer an empty page) and that originals, which have no platform, add no
 * blank option.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCatalogPlatforms } from '@/server/services/problems';
import { platformLabel } from '@/lib/problems/platforms';
import { type TestContext, hasTestDatabase, setupTestDb, truncateAll } from '../helpers/db';

describe('platformLabel', () => {
  it('spells the known platforms the way they spell themselves', () => {
    expect(platformLabel('leetcode')).toBe('LeetCode');
    expect(platformLabel('codeforces')).toBe('Codeforces');
    expect(platformLabel('gfg')).toBe('GeeksforGeeks');
    expect(platformLabel('geeksforgeeks')).toBe('GeeksforGeeks');
  });

  it('matches regardless of case and surrounding space', () => {
    expect(platformLabel(' LeetCode ')).toBe('LeetCode');
    expect(platformLabel('CODEFORCES')).toBe('Codeforces');
  });

  it('capitalises an unknown platform instead of showing the raw key', () => {
    expect(platformLabel('kattis')).toBe('Kattis');
    expect(platformLabel('')).toBe('');
  });
});

const suite = hasTestDatabase ? describe : describe.skip;

suite('listCatalogPlatforms', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    await truncateAll(ctx.sql);
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
      VALUES
        ('plat-lc-a', 'Platform LC A', 'external_link', 'leetcode', 'https://leetcode.com/problems/plat-lc-a/', 'easy', 'published'),
        ('plat-lc-b', 'Platform LC B', 'external_link', 'leetcode', 'https://leetcode.com/problems/plat-lc-b/', 'hard', 'published'),
        ('plat-cf-a', 'Platform CF A', 'external_link', 'codeforces', 'https://codeforces.com/problemset/problem/1/A', 'easy', 'published'),
        ('plat-ac-a', 'Platform AC A', 'external_link', 'atcoder', 'https://atcoder.jp/contests/abc001/tasks/abc001_a', 'easy', 'archived')
    `;
    await ctx.sql`
      INSERT INTO problems (slug, title, source_type, difficulty, status)
      VALUES ('plat-original', 'Platform Original', 'original', 'easy', 'published')
    `;
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('lists each platform with a published problem once, sorted', async () => {
    expect(await listCatalogPlatforms(ctx.db)).toEqual(['codeforces', 'leetcode']);
  });

  it('leaves out a platform whose only problems are archived', async () => {
    expect(await listCatalogPlatforms(ctx.db)).not.toContain('atcoder');
  });
});
