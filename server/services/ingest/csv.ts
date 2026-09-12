/**
 * CSV parsing and per-row validation.
 *
 * Returns `{ valid, invalid }` rather than throwing on a bad row: partial
 * success is the requirement, and the preview has to render every row's verdict
 * before anything is committed. A parser that throws on row 3 cannot tell the
 * user that rows 1, 2 and 4-500 are fine.
 *
 * It DOES throw for the things that are not a row problem — an oversized file,
 * a missing required column, a file that is not CSV at all. Those are conditions
 * where no per-row verdict exists to report.
 */
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { IMPORT_LIMITS } from './limits';
import { normaliseProblemUrl } from './normalise-url';
import { unescapeCell } from './spreadsheet-safety';

export class ImportFileTooLargeError extends Error {
  readonly code = 'IMPORT_FILE_TOO_LARGE';
  constructor(
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(`File is ${bytes} bytes; the limit is ${limit}.`);
    this.name = 'ImportFileTooLargeError';
  }
}

export class ImportTooManyRowsError extends Error {
  readonly code = 'IMPORT_TOO_MANY_ROWS';
  constructor(readonly limit: number) {
    super(`File has more than ${limit} rows.`);
    this.name = 'ImportTooManyRowsError';
  }
}

export class ImportMissingColumnsError extends Error {
  readonly code = 'IMPORT_MISSING_COLUMNS';
  constructor(readonly missing: string[]) {
    super(`Missing required column(s): ${missing.join(', ')}.`);
    this.name = 'ImportMissingColumnsError';
  }
}

export class ImportUnreadableError extends Error {
  readonly code = 'IMPORT_UNREADABLE';
  constructor(reason: string) {
    super(`Could not read this file as CSV: ${reason}`);
    this.name = 'ImportUnreadableError';
  }
}

/**
 * One validated row, ready to import.
 *
 * `normalisedUrl` is carried through rather than recomputed downstream, so the
 * value the validator accepted is exactly the value that gets stored and
 * deduplicated against.
 */
export type ValidImportRow = {
  rowNumber: number;
  raw: Record<string, string>;
  title: string;
  url: string;
  normalisedUrl: string;
  platform: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  topics: string[];
};

export type InvalidImportRow = {
  rowNumber: number;
  raw: Record<string, string>;
  error: string;
  field: string | null;
};

export type ParsedCsv = {
  valid: ValidImportRow[];
  invalid: InvalidImportRow[];
  /** Every data row seen, valid or not. Excludes the header. */
  totalRows: number;
};

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/**
 * Per-row schema.
 *
 * Cells arrive already `unescapeCell`d, so a title our own export neutralised
 * (`'=x`) is validated as the original (`=x`) — otherwise a round trip would
 * accumulate a quote per cycle.
 */
const rowSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(200, 'Title must be 200 characters or fewer'),

  url: z
    .string()
    .trim()
    .min(1, 'URL is required')
    /*
     * The normaliser is the validator. Anything it refuses is not a problem
     * link we can store — including the javascript: and bare-slug cases it
     * rejects — so there is no second opinion to have here.
     */
    .refine((value) => normaliseProblemUrl(value) !== null, {
      message: 'Not a usable problem URL',
    }),

  difficulty: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(DIFFICULTIES, { message: 'Difficulty must be easy, medium or hard' })),

  platform: z.string().trim().max(50).optional(),
  topic: z.string().trim().max(500).optional(),
});

/** Header cells are matched case- and whitespace-insensitively. */
function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Platform, from the column if given, else inferred from the URL host.
 *
 * Inference is a convenience for a hand-written CSV, never an override: an
 * explicit value always wins, because the user knows something we do not about
 * a host we have no rule for.
 */
function derivePlatform(explicit: string | undefined, normalisedUrl: string): string | null {
  if (explicit && explicit.length > 0) return explicit.toLowerCase();

  const host = normalisedUrl.split('/')[0] ?? '';
  const known: Record<string, string> = {
    'leetcode.com': 'leetcode',
    'leetcode.cn': 'leetcode',
    'codeforces.com': 'codeforces',
    'hackerrank.com': 'hackerrank',
    'atcoder.jp': 'atcoder',
    'codechef.com': 'codechef',
  };
  return known[host] ?? null;
}

/** `topic` is a single cell holding a comma- or semicolon-separated list. */
function parseTopics(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;]/)
        .map((topic) => topic.trim().toLowerCase())
        .filter((topic) => topic.length > 0 && topic.length <= 40),
    ),
  ];
}

/**
 * Parse and validate an uploaded CSV.
 *
 * @throws ImportFileTooLargeError before any parsing begins
 * @throws ImportTooManyRowsError  from inside the stream, at the first row past
 *   the cap — the remaining rows are never read
 * @throws ImportMissingColumnsError when `title` or `url` is absent
 */
export async function parseImportCsv(source: string | Buffer): Promise<ParsedCsv> {
  /*
   * THE SIZE CAP, BEFORE THE PARSER EXISTS.
   *
   * Byte length, not string length: a 2 MiB limit on a UTF-8 file means bytes,
   * and `'√'.length === 1` while its encoding is 3 bytes. Measuring the wrong
   * one lets a multibyte file through at up to 3x the intended cap.
   */
  const bytes = Buffer.isBuffer(source) ? source.length : Buffer.byteLength(source, 'utf8');
  if (bytes > IMPORT_LIMITS.maxBytes) {
    throw new ImportFileTooLargeError(bytes, IMPORT_LIMITS.maxBytes);
  }

  const parser = Readable.from([source]).pipe(
    parse({
      columns: (header: string[]) => header.map(normaliseHeader),
      skip_empty_lines: true,
      trim: false, // Zod trims per field; trimming here would hide a padded cell
      bom: true, // Excel writes a BOM and it would otherwise corrupt the first header
      relax_column_count: true, // a short row is a ROW error, not a file error
    }),
  );

  const valid: ValidImportRow[] = [];
  const invalid: InvalidImportRow[] = [];
  let totalRows = 0;
  let headerChecked = false;

  try {
    for await (const record of parser as AsyncIterable<Record<string, string>>) {
      if (!headerChecked) {
        headerChecked = true;
        const missing = ['title', 'url'].filter((column) => !(column in record));
        if (missing.length > 0) {
          parser.destroy();
          throw new ImportMissingColumnsError(missing);
        }
      }

      totalRows += 1;

      /*
       * THE ROW CAP, MID-STREAM.
       *
       * Abort at the first row past the limit. `parser.destroy()` stops the
       * source, so a 1-million-row file costs `maxRows + 1` rows of work rather
       * than being fully read and then rejected.
       */
      if (totalRows > IMPORT_LIMITS.maxRows) {
        parser.destroy();
        throw new ImportTooManyRowsError(IMPORT_LIMITS.maxRows);
      }

      // 1-based, header excluded — the number the user sees in a spreadsheet
      // is this + 1, and the preview says so rather than guessing for them.
      const rowNumber = totalRows;

      // Undo our own export's spreadsheet neutralisation before validating.
      const raw: Record<string, string> = {};
      for (const [key, value] of Object.entries(record)) {
        raw[key] = typeof value === 'string' ? unescapeCell(value) : value;
      }

      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        invalid.push({
          rowNumber,
          raw,
          error: issue?.message ?? 'Invalid row',
          field: issue?.path[0] ? String(issue.path[0]) : null,
        });
        continue;
      }

      const normalisedUrl = normaliseProblemUrl(parsed.data.url);
      if (normalisedUrl === null) {
        // Unreachable — the schema refine above already rejected it. Kept as a
        // type narrowing that also fails loudly if the two ever disagree.
        invalid.push({ rowNumber, raw, error: 'Not a usable problem URL', field: 'url' });
        continue;
      }

      valid.push({
        rowNumber,
        raw,
        title: parsed.data.title,
        url: parsed.data.url,
        normalisedUrl,
        platform: derivePlatform(parsed.data.platform, normalisedUrl),
        difficulty: parsed.data.difficulty,
        topics: parseTopics(parsed.data.topic),
      });
    }
  } catch (error) {
    if (
      error instanceof ImportTooManyRowsError ||
      error instanceof ImportMissingColumnsError ||
      error instanceof ImportFileTooLargeError
    ) {
      throw error;
    }
    throw new ImportUnreadableError(error instanceof Error ? error.message : 'unknown');
  }

  return { valid, invalid, totalRows };
}
