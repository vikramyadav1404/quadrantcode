/**
 * Codeforces problemset → catalog CSV (`server/services/ingest/codeforces.ts`).
 *
 * The fixture is invented: names, ids and ratings do not describe real
 * problems, so no platform content lives in the repo.
 */
import { describe, expect, it } from 'vitest';
import {
  type CodeforcesProblem,
  difficultyForRating,
  problemUrl,
  splitIntoFiles,
  toCatalogCsv,
  toCatalogRows,
  topicsForTags,
} from '@/server/services/ingest/codeforces';
import { parseImportCsv } from '@/server/services/ingest/csv';
import { CATALOG_IMPORT_LIMITS } from '@/server/services/ingest/limits';

const problem = (overrides: Partial<CodeforcesProblem>): CodeforcesProblem => ({
  contestId: 9001,
  index: 'A',
  name: 'Invented Lantern Count',
  type: 'PROGRAMMING',
  rating: 1000,
  tags: ['greedy'],
  ...overrides,
});

describe('difficultyForRating', () => {
  it('bands the rating onto the catalog scale', () => {
    expect(difficultyForRating(800)).toBe('easy');
    expect(difficultyForRating(1200)).toBe('easy');
    expect(difficultyForRating(1300)).toBe('medium');
    expect(difficultyForRating(1900)).toBe('medium');
    expect(difficultyForRating(2000)).toBe('hard');
    expect(difficultyForRating(3500)).toBe('hard');
  });
});

describe('topicsForTags', () => {
  it('maps Codeforces tags onto the catalog vocabulary', () => {
    expect(topicsForTags(['dp', 'sortings', 'binary search', 'dsu', 'bitmasks'])).toEqual([
      'dynamic-programming',
      'sorting',
      'binary-search',
      'union-find',
      'bit-manipulation',
    ]);
  });

  it('drops *special, merges duplicates, and kebab-cases anything unmapped', () => {
    expect(
      topicsForTags(['*special', 'number theory', 'chinese remainder theorem', 'Some New Tag']),
    ).toEqual(['number-theory', 'some-new-tag']);
  });
});

describe('toCatalogRows', () => {
  const fixture: CodeforcesProblem[] = [
    problem({ contestId: 9002, index: 'B', rating: 1500, name: 'Invented Ferry Queue' }),
    problem({ contestId: 9001, index: 'A', rating: 900 }),
    problem({ contestId: 9003, index: 'C', rating: undefined, name: 'Unrated' }),
    problem({ contestId: 9004, index: 'D', tags: ['*special', 'math'], name: 'Special Round' }),
    problem({ contestId: 9005, index: 'E', type: 'QUESTION', name: 'Not Programming' }),
    problem({ contestId: 9006, index: 'F', rating: 2600, name: 'Out Of Range' }),
    problem({ contestId: undefined, index: 'G', name: 'No Contest' }),
  ];

  it('keeps rated programming problems in range, without *special, sorted by rating', () => {
    const rows = toCatalogRows(fixture, { minRating: 800, maxRating: 2000 });
    expect(rows).toEqual([
      {
        title: 'Invented Lantern Count',
        url: 'https://codeforces.com/problemset/problem/9001/A',
        difficulty: 'easy',
        topic: 'greedy',
        platform: 'codeforces',
      },
      {
        title: 'Invented Ferry Queue',
        url: 'https://codeforces.com/problemset/problem/9002/B',
        difficulty: 'medium',
        topic: 'greedy',
        platform: 'codeforces',
      },
    ]);
  });

  it('honours a wider range', () => {
    const rows = toCatalogRows(fixture, { minRating: 800, maxRating: 3000 });
    expect(rows.map((row) => row.title)).toContain('Out Of Range');
  });
});

describe('the CSV the admin import receives', () => {
  it('parses with the import parser: 0 invalid, URLs normalised, platform kept', async () => {
    const rows = toCatalogRows([
      problem({ tags: ['two pointers', 'dp'] }),
      problem({ contestId: 9002, index: 'B1', rating: 2000, name: '=Starts Like A Formula' }),
    ]);
    const parsed = await parseImportCsv(toCatalogCsv(rows), CATALOG_IMPORT_LIMITS);

    expect(parsed.invalid).toEqual([]);
    expect(parsed.valid.map((row) => row.normalisedUrl)).toEqual([
      'codeforces.com/problemset/problem/9001/A',
      'codeforces.com/problemset/problem/9002/B1',
    ]);
    expect(parsed.valid[0]).toMatchObject({
      platform: 'codeforces',
      difficulty: 'easy',
      topics: ['two-pointers', 'dynamic-programming'],
    });
    // Escaped for spreadsheets in the file, restored by the importer.
    expect(parsed.valid[1]?.title).toBe('=Starts Like A Formula');
  });

  it('builds the canonical problemset URL', () => {
    expect(problemUrl(1, 'A')).toBe('https://codeforces.com/problemset/problem/1/A');
  });
});

describe('splitIntoFiles', () => {
  it('splits into files of at most the given size', () => {
    const files = splitIntoFiles(
      Array.from({ length: 12 }, (_, i) => i),
      5,
    );
    expect(files.map((file) => file.length)).toEqual([5, 5, 2]);
  });
});
