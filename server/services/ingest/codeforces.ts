/**
 * Codeforces' public problemset → rows for the admin catalog import.
 *
 * Source: the official API, `GET https://codeforces.com/api/problemset.problems`,
 * which is meant for programs. One request returns every problem's metadata:
 * contest id, index, name, rating and tags. Nothing here fetches or stores a
 * statement (C1): a row is a title, a link to Codeforces, a difficulty and
 * topics, and the platform stays visible as `codeforces`.
 *
 * What is ours: the difficulty bands and the topic vocabulary. Codeforces'
 * rating and tags are mapped onto the catalog's own scale and tags, so these
 * problems filter and group with everything else in Quadrantcode.
 *
 * Pure: the script (`scripts/catalog-from-codeforces.ts`) does the I/O.
 */
import { stringify } from 'csv-stringify/sync';
import { toTopicTag } from './catalog';
import { escapeCell } from './spreadsheet-safety';

/** One problem as the API returns it (fields this module reads). */
export type CodeforcesProblem = {
  contestId?: number;
  index: string;
  name: string;
  type: string;
  rating?: number;
  tags: string[];
};

export type CatalogCsvRow = {
  title: string;
  url: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  platform: 'codeforces';
};

export type RatingRange = { minRating: number; maxRating: number };

/** The default: approachable practice, still well over 4,000 problems. */
export const DEFAULT_RATING_RANGE: RatingRange = { minRating: 800, maxRating: 2000 };

/** Rows per output file. Under the admin import's 10,000-row cap, and quick to upload. */
export const ROWS_PER_FILE = 5_000;

/** Our banding of Codeforces' rating onto the catalog's three levels. */
export function difficultyForRating(rating: number): CatalogCsvRow['difficulty'] {
  if (rating <= 1200) return 'easy';
  if (rating <= 1900) return 'medium';
  return 'hard';
}

/**
 * Codeforces tag → catalog topic, aligned with the tags the catalog already
 * uses (the seed data: `dynamic-programming`, `sorting`, `binary-search`, …).
 * `null` drops a tag. Anything unmapped falls back to `toTopicTag`.
 */
const TAG_TO_TOPIC: Readonly<Record<string, string | null>> = {
  '*special': null,
  dp: 'dynamic-programming',
  sortings: 'sorting',
  'binary search': 'binary-search',
  'two pointers': 'two-pointers',
  'data structures': 'data-structures',
  'constructive algorithms': 'constructive',
  'brute force': 'brute-force',
  'number theory': 'number-theory',
  'chinese remainder theorem': 'number-theory',
  'dfs and similar': 'dfs',
  'shortest paths': 'shortest-paths',
  dsu: 'union-find',
  bitmasks: 'bit-manipulation',
  'divide and conquer': 'divide-and-conquer',
  probabilities: 'probability',
  games: 'game-theory',
  flows: 'network-flow',
  'graph matchings': 'matching',
  'string suffix structures': 'suffix-structures',
  'ternary search': 'ternary-search',
  'expression parsing': 'parsing',
  matrices: 'matrix',
  schedules: 'scheduling',
};

export function topicsForTags(tags: readonly string[]): string[] {
  const topics = tags.map((tag) => {
    const key = tag.trim().toLowerCase();
    return key in TAG_TO_TOPIC ? (TAG_TO_TOPIC[key] ?? null) : toTopicTag(key);
  });
  return [...new Set(topics.filter((topic): topic is string => topic !== null))];
}

/** The canonical problemset URL, the form the catalog's URL normaliser keeps. */
export function problemUrl(contestId: number, index: string): string {
  return `https://codeforces.com/problemset/problem/${contestId}/${index}`;
}

/**
 * Keep: programming problems with a contest id and a rating inside the range,
 * and not tagged `*special` (April Fools and other unusual rounds).
 *
 * Sorted by rating, then contest and index, so files are stable between runs
 * and the easier problems land in the first file.
 */
export function toCatalogRows(
  problems: readonly CodeforcesProblem[],
  range: RatingRange = DEFAULT_RATING_RANGE,
): CatalogCsvRow[] {
  return problems
    .filter(
      (problem): problem is CodeforcesProblem & { contestId: number; rating: number } =>
        problem.type === 'PROGRAMMING' &&
        typeof problem.contestId === 'number' &&
        typeof problem.rating === 'number' &&
        problem.rating >= range.minRating &&
        problem.rating <= range.maxRating &&
        !problem.tags.includes('*special') &&
        problem.name.trim().length > 0,
    )
    .sort(
      (a, b) =>
        a.rating - b.rating || a.contestId - b.contestId || a.index.localeCompare(b.index),
    )
    .map((problem) => ({
      title: problem.name.trim().slice(0, 200),
      url: problemUrl(problem.contestId, problem.index),
      difficulty: difficultyForRating(problem.rating),
      topic: topicsForTags(problem.tags).join(', '),
      platform: 'codeforces' as const,
    }));
}

/** CSV text in the admin template's columns, Excel-friendly like the export. */
export function toCatalogCsv(rows: readonly CatalogCsvRow[]): string {
  return stringify(
    rows.map((row) => [
      escapeCell(row.title),
      escapeCell(row.url),
      row.difficulty,
      escapeCell(row.topic),
      row.platform,
    ]),
    {
      header: true,
      columns: ['title', 'url', 'difficulty', 'topic', 'platform'],
      record_delimiter: 'windows',
      bom: true,
    },
  );
}

/** Splits rows into files of at most `perFile` rows. */
export function splitIntoFiles<T>(rows: readonly T[], perFile = ROWS_PER_FILE): T[][] {
  const files: T[][] = [];
  for (let start = 0; start < rows.length; start += perFile) {
    files.push(rows.slice(start, start + perFile));
  }
  return files;
}
