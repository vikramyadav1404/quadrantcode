/**
 * Build admin-catalog CSVs from Codeforces' official problemset API.
 *
 *   npm run catalog:codeforces
 *   npm run catalog:codeforces -- --min-rating 800 --max-rating 2400 --out .tmp/catalog
 *   npm run catalog:codeforces -- --from saved-problemset.json
 *
 * One plain GET to https://codeforces.com/api/problemset.problems (the API is
 * meant for programs), or `--from` a JSON file saved from that URL. Nothing is
 * written to any database: the output is CSV files for `/admin/problems/import`,
 * which an admin uploads.
 *
 * Every file is re-parsed with the import's own parser before this exits, so a
 * file that would not import cleanly is a failure here, not a surprise there.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type CodeforcesProblem,
  DEFAULT_RATING_RANGE,
  ROWS_PER_FILE,
  splitIntoFiles,
  toCatalogCsv,
  toCatalogRows,
} from '@/server/services/ingest/codeforces';
import { parseImportCsv } from '@/server/services/ingest/csv';
import { CATALOG_IMPORT_LIMITS } from '@/server/services/ingest/limits';

const API_URL = 'https://codeforces.com/api/problemset.problems';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberFlag(name: string, fallback: number): number {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${name} must be a positive whole number`);
  return value;
}

async function loadProblems(): Promise<CodeforcesProblem[]> {
  const from = flag('from');
  const body: unknown = from
    ? JSON.parse(readFileSync(resolve(from), 'utf8'))
    : await fetch(API_URL, {
        headers: {
          'user-agent': 'quadrantcode-catalog-script/1.0',
          accept: 'application/json',
        },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Codeforces API answered ${response.status}`);
        return response.json();
      });

  const payload = body as { status?: string; result?: { problems?: CodeforcesProblem[] } };
  if (payload.status !== 'OK' || !Array.isArray(payload.result?.problems)) {
    throw new Error(
      'Unexpected response: expected { status: "OK", result: { problems: [...] } }',
    );
  }
  return payload.result.problems;
}

async function main(): Promise<void> {
  const range = {
    minRating: numberFlag('min-rating', DEFAULT_RATING_RANGE.minRating),
    maxRating: numberFlag('max-rating', DEFAULT_RATING_RANGE.maxRating),
  };
  if (range.minRating > range.maxRating) throw new Error('--min-rating is above --max-rating');
  const perFile = Math.min(
    numberFlag('per-file', ROWS_PER_FILE),
    CATALOG_IMPORT_LIMITS.maxRows,
  );
  const outDir = resolve(flag('out') ?? '.tmp/catalog');

  const problems = await loadProblems();
  const rows = toCatalogRows(problems, range);
  const files = splitIntoFiles(rows, perFile);
  mkdirSync(outDir, { recursive: true });

  console.log(`Codeforces problems in the response: ${problems.length}`);
  console.log(`Kept for rating ${range.minRating}-${range.maxRating}: ${rows.length}`);

  for (const [i, fileRows] of files.entries()) {
    const csv = toCatalogCsv(fileRows);
    const path = join(outDir, `codeforces-${i + 1}.csv`);

    // The import's own parser, with the admin limits: 0 invalid, every row present.
    const parsed = await parseImportCsv(csv, CATALOG_IMPORT_LIMITS);
    if (parsed.invalid.length > 0 || parsed.valid.length !== fileRows.length) {
      const first = parsed.invalid[0];
      throw new Error(
        `${path}: ${parsed.invalid.length} invalid row(s)` +
          (first ? `, first at row ${first.rowNumber}: ${first.error}` : ''),
      );
    }

    writeFileSync(path, csv, 'utf8');
    const byDifficulty = { easy: 0, medium: 0, hard: 0 };
    for (const row of fileRows) byDifficulty[row.difficulty] += 1;
    console.log(
      `${path}: ${fileRows.length} rows (easy ${byDifficulty.easy}, medium ${byDifficulty.medium}, hard ${byDifficulty.hard}), ${(Buffer.byteLength(csv) / 1024).toFixed(0)} KB, 0 invalid`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
