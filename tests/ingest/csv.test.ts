/**
 * F1.2 · CSV parsing, the caps, and spreadsheet safety.
 *
 * The cap tests assert something stronger than "it throws": they assert the
 * work was NOT done. A limit that rejects an oversized file after parsing all
 * of it has protected nothing, and from the outside it looks identical to one
 * that aborted at the cap — same exception, same message.
 */
import { describe, expect, it } from 'vitest';
import {
  ImportFileTooLargeError,
  ImportMissingColumnsError,
  ImportTooManyRowsError,
  parseImportCsv,
} from '@/server/services/ingest/csv';
import { IMPORT_LIMITS } from '@/server/services/ingest/limits';
import {
  escapeCell,
  unescapeCell,
  wouldExecuteInSpreadsheet,
} from '@/server/services/ingest/spreadsheet-safety';

const HEADER = 'title,platform,url,difficulty,topic';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

const GOOD = 'Two Sum,leetcode,https://leetcode.com/problems/two-sum/,easy,arrays';

describe('F1.2 · parseImportCsv — the happy path', () => {
  it('parses a well-formed row completely', async () => {
    const result = await parseImportCsv(csv(GOOD));

    expect(result.totalRows).toBe(1);
    expect(result.invalid).toEqual([]);
    expect(result.valid[0]).toMatchObject({
      rowNumber: 1,
      title: 'Two Sum',
      platform: 'leetcode',
      difficulty: 'easy',
      normalisedUrl: 'leetcode.com/problems/two-sum',
      topics: ['arrays'],
    });
  });

  it('handles the things real CSV files actually contain', async () => {
    const messy = [
      HEADER,
      // a quoted field containing the delimiter
      '"Sum, Two",leetcode,https://leetcode.com/problems/two-sum/,EASY,"arrays, hashing"',
      // padded cells and mixed-case difficulty
      '  Three Sum  , ,https://leetcode.com/problems/three-sum/ ,  Medium  ,arrays',
    ].join('\r\n'); // CRLF, as Excel writes

    const result = await parseImportCsv(messy);

    expect(result.invalid).toEqual([]);
    expect(result.valid[0]?.title).toBe('Sum, Two');
    expect(result.valid[0]?.topics).toEqual(['arrays', 'hashing']);
    expect(result.valid[1]?.title).toBe('Three Sum');
    expect(result.valid[1]?.difficulty).toBe('medium');
  });

  it('reads a file with a BOM, which is what Excel produces', async () => {
    // Without `bom: true` the first header becomes '﻿title' and every row
    // fails for a missing title — a whole-file failure caused by one invisible
    // character.
    const result = await parseImportCsv(`﻿${csv(GOOD)}`);
    expect(result.valid).toHaveLength(1);
  });

  it('infers the platform from the URL when the column is blank', async () => {
    const result = await parseImportCsv(
      csv('Two Sum,,https://codeforces.com/contest/1000/problem/A,easy,'),
    );
    expect(result.valid[0]?.platform).toBe('codeforces');
  });

  it('lets an explicit platform override inference', async () => {
    const result = await parseImportCsv(
      csv('Two Sum,MyMirror,https://leetcode.com/problems/two-sum/,easy,'),
    );
    expect(result.valid[0]?.platform).toBe('mymirror');
  });
});

describe('F1.2 · parseImportCsv — partial success', () => {
  it('reports 3 bad rows and still returns the good ones', async () => {
    // The acceptance criterion, at the parse layer.
    const result = await parseImportCsv(
      csv(
        GOOD,
        ',leetcode,https://leetcode.com/problems/no-title/,easy,', // no title
        'No URL,leetcode,,easy,', // no url
        'Bad Difficulty,leetcode,https://leetcode.com/problems/x/,trivial,', // bad enum
        'Three Sum,leetcode,https://leetcode.com/problems/three-sum/,hard,arrays',
      ),
    );

    expect(result.totalRows).toBe(5);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(3);

    expect(result.invalid.map((row) => row.rowNumber)).toEqual([2, 3, 4]);
    expect(result.invalid.map((row) => row.field)).toEqual(['title', 'url', 'difficulty']);
  });

  it('rejects a row whose URL is a javascript: payload', async () => {
    // The normaliser is the validator, so its refusals surface as row errors
    // rather than needing a second rule here.
    const result = await parseImportCsv(csv('Evil,leetcode,"javascript:alert(1)",easy,'));
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0]).toMatchObject({ field: 'url' });
  });

  it('rejects a row whose URL is a bare slug', async () => {
    const result = await parseImportCsv(csv('Two Sum,leetcode,two-sum,easy,'));
    expect(result.invalid[0]).toMatchObject({ field: 'url' });
  });

  it('keeps the raw row so the preview can show the user their own data', async () => {
    const result = await parseImportCsv(
      csv(',leetcode,https://leetcode.com/problems/x/,easy,'),
    );
    expect(result.invalid[0]?.raw).toMatchObject({ platform: 'leetcode' });
  });
});

describe('F1.2 · parseImportCsv — caps enforced BEFORE the work', () => {
  it('rejects an oversized file without parsing it', async () => {
    /*
     * The header says "before any parsing begins", so assert that rather than
     * just the throw: a 3 MiB file of valid rows would parse into tens of
     * thousands of records if the check were downstream. This completes in
     * milliseconds because nothing is parsed.
     */
    const oversized = 'x'.repeat(IMPORT_LIMITS.maxBytes + 1);

    const started = Date.now();
    await expect(parseImportCsv(oversized)).rejects.toThrow(ImportFileTooLargeError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('measures BYTES, not string length', async () => {
    /*
     * The positive control for the multibyte trap. This string is under the cap
     * by `.length` and over it by UTF-8 byte count; measuring the wrong one
     * would let a file through at up to 3x the intended size.
     */
    const multibyte = '√'.repeat(IMPORT_LIMITS.maxBytes / 2);
    expect(multibyte.length).toBeLessThan(IMPORT_LIMITS.maxBytes);
    expect(Buffer.byteLength(multibyte, 'utf8')).toBeGreaterThan(IMPORT_LIMITS.maxBytes);

    await expect(parseImportCsv(multibyte)).rejects.toThrow(ImportFileTooLargeError);
  });

  it('aborts a 60k-row file at the cap rather than reading all of it', async () => {
    /*
     * The row count here is 60,000, not the 100,000 originally written, and the
     * reason is worth recording: at realistic row widths a 100k-row CSV is
     * ~3 MiB, so the BYTE cap rejects it first and the test would have been
     * asserting the wrong limit while looking correct. The two caps are not
     * independent — the byte cap bounds rows at roughly 70-90k, so `maxRows` is
     * only ever the binding constraint below that.
     *
     * Rows are kept deliberately narrow so 60k fits under the byte cap, leaving
     * the ROW cap as the only thing that can stop this. The assertion below the
     * throw is what distinguishes "aborted at 5,001" from "parsed 60,000 then
     * counted" — both throw, and only one of them is a working limit.
     */
    const rows = Array.from(
      { length: 60_000 },
      (_, index) => `P${index},l,l.co/${index},easy,a`,
    );
    const huge = [HEADER, ...rows].join('\n');
    expect(
      Buffer.byteLength(huge, 'utf8'),
      'fixture must sit UNDER the byte cap or it tests the wrong limit',
    ).toBeLessThan(IMPORT_LIMITS.maxBytes);

    const started = Date.now();
    await expect(parseImportCsv(huge)).rejects.toThrow(ImportTooManyRowsError);
    const elapsed = Date.now() - started;

    // Parsing all 60k takes far longer than parsing 5,001 of them.
    expect(elapsed, `took ${elapsed}ms — did it abort, or parse everything?`).toBeLessThan(
      2_000,
    );
  });

  it('accepts a file exactly AT the row cap', async () => {
    // The positive control for the row cap: off-by-one in the other direction
    // would reject a legitimate file at the documented limit.
    const rows = Array.from(
      { length: IMPORT_LIMITS.maxRows },
      (_, index) => `P${index},leetcode,https://leetcode.com/problems/p${index}/,easy,arrays`,
    );
    const result = await parseImportCsv([HEADER, ...rows].join('\n'));
    expect(result.totalRows).toBe(IMPORT_LIMITS.maxRows);
    expect(result.valid).toHaveLength(IMPORT_LIMITS.maxRows);
  });

  it('rejects a file missing a required column', async () => {
    await expect(
      parseImportCsv('title,platform,difficulty\nTwo Sum,leetcode,easy'),
    ).rejects.toThrow(ImportMissingColumnsError);
  });

  it('names WHICH columns are missing', async () => {
    // "Missing required columns" without saying which is a puzzle, not an error.
    await expect(parseImportCsv('platform,difficulty\nleetcode,easy')).rejects.toThrow(
      /title.*url|url.*title/,
    );
  });
});

describe('F1.2 · spreadsheet safety — CSV injection on the EXPORT side', () => {
  const PAYLOADS = [
    '=HYPERLINK("https://evil.example","Click")',
    '+1+1',
    '-1+1',
    '@SUM(A1:A9)',
    '\t=cmd|calc',
    '\r=cmd|calc',
  ];

  it.each(PAYLOADS)('neutralises %j', (payload) => {
    const escaped = escapeCell(payload);
    expect(escaped.startsWith("'")).toBe(true);
    expect(wouldExecuteInSpreadsheet(escaped)).toBe(false);
  });

  it('confirms the payloads WOULD execute unescaped', () => {
    // The positive control. Without this, a bug making every payload look safe
    // would pass the test above.
    for (const payload of PAYLOADS) {
      expect(wouldExecuteInSpreadsheet(payload), payload).toBe(true);
    }
  });

  it('leaves ordinary values completely alone', () => {
    for (const safe of ['Two Sum', 'https://leetcode.com/problems/two-sum/', 'easy', '']) {
      expect(escapeCell(safe)).toBe(safe);
    }
  });

  it('round-trips: unescape(escape(x)) === x', () => {
    /*
     * The property the acceptance criterion depends on. Escaping mutates the
     * data, so if the two functions are not exact inverses, an export → import
     * cycle would drift and "zero new rows" would fail on the second lap.
     */
    const inputs = [
      ...PAYLOADS,
      'Two Sum',
      '',
      "'tis a title", // a genuine leading apostrophe, NOT our marker
      '-1 is not a valid index', // legitimately starts with a formula lead
      'a',
    ];
    for (const input of inputs) {
      expect(unescapeCell(escapeCell(input)), input).toBe(input);
    }
  });

  it('does not strip an apostrophe that is part of the title', () => {
    // The narrowness of unescape: only a marker followed by a formula lead is
    // a marker. Otherwise "'tis" would come back as "tis".
    expect(unescapeCell("'tis a title")).toBe("'tis a title");
  });

  it('an escaped payload re-imports as the original text', async () => {
    /*
     * End to end through the parser: what our export writes is what our import
     * reads back, with the neutralisation invisible to the user.
     *
     * The inner quotes are DOUBLED, because that is how CSV quotes a quote.
     * Writing the payload in raw broke the parse and cost a debugging round —
     * which is precisely the argument for csv-stringify owning the export
     * rather than any hand-rolled join.
     */
    const payload = '=HYPERLINK("https://evil.example","x")';
    const cell = escapeCell(payload).replaceAll('"', '""');
    const result = await parseImportCsv(
      csv(`"${cell}",leetcode,https://leetcode.com/problems/two-sum/,easy,`),
    );

    expect(result.invalid).toEqual([]);
    expect(result.valid[0]?.title).toBe(payload);
  });
});
