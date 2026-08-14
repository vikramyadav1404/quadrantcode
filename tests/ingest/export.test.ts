/**
 * F1.2 · export, and the round trip.
 *
 * The acceptance criterion — "export → import produces zero new rows" — is a
 * SECOND-LAP claim, so the tests run the cycle twice. Escape and unescape being
 * inverses on fresh data is a different property from the pipeline being stable
 * across laps, and the first version of the escaper satisfied the first while
 * failing the second.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseImportCsv } from '@/server/services/ingest/csv';
import { exportTrackedCsv } from '@/server/services/ingest/export';
import { importRows } from '@/server/services/ingest/import';
import {
  escapeCell,
  unescapeCell,
  wouldExecuteInSpreadsheet,
} from '@/server/services/ingest/spreadsheet-safety';
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

describe('F1.2 · escape/unescape is a true inverse, across laps', () => {
  const INPUTS = [
    '=HYPERLINK("x","y")',
    '+1',
    '-1 is not a valid index',
    '@SUM(A1)',
    '\t=cmd',
    '\r=cmd',
    'Two Sum',
    '',
    "'tis a title", // ordinary apostrophe
    "'=x", // LOOKS escaped but the user typed it
    "''=x", // and one more layer
    "'''", // apostrophes with no formula behind them
  ];

  it('unescape(escape(x)) === x for every input', () => {
    for (const input of INPUTS) {
      expect(unescapeCell(escapeCell(input)), JSON.stringify(input)).toBe(input);
    }
  });

  it('SURVIVES A SECOND LAP — the property the criterion actually needs', () => {
    /*
     * The bug this pins. The first escaper stripped a marker whenever the next
     * character was a formula lead, so a title the user genuinely typed as
     * `'=x` came back as `=x`: a silent one-time data change that then
     * stabilised and looked correct forever after. `unescape(escape(x)) === x`
     * on fresh values could not see it, because the damaged value only exists
     * after a cycle has already run.
     */
    for (const input of INPUTS) {
      const lap1 = unescapeCell(escapeCell(input));
      const lap2 = unescapeCell(escapeCell(lap1));
      const lap3 = unescapeCell(escapeCell(lap2));

      expect(lap1, `lap 1 changed ${JSON.stringify(input)}`).toBe(input);
      expect(lap2, `lap 2 drifted from ${JSON.stringify(input)}`).toBe(input);
      expect(lap3, `lap 3 drifted from ${JSON.stringify(input)}`).toBe(input);
    }
  });

  it('still neutralises the payload on every lap', () => {
    // Convergence must not be achieved by giving up on escaping.
    let value = '=HYPERLINK("evil","x")';
    for (let lap = 0; lap < 3; lap += 1) {
      const exported = escapeCell(value);
      expect(wouldExecuteInSpreadsheet(exported), `lap ${lap}`).toBe(false);
      value = unescapeCell(exported);
    }
    expect(value).toBe('=HYPERLINK("evil","x")');
  });
});

suite('F1.2 · exportTrackedCsv', () => {
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
    userId = (await createUser(ctx.db, { email: 'exporter@example.com' })).id;
  });

  async function importCsv(source: string) {
    const parsed = await parseImportCsv(source);
    return importRows(ctx.db, userId, parsed.valid);
  }

  it('exports the columns the importer reads, in order', async () => {
    await importCsv(csv(TWO_SUM));
    const { csv: out } = await exportTrackedCsv(ctx.db, userId);

    // BOM stripped for the comparison; it is asserted separately below.
    expect(out.replace(/^﻿/, '').split('\r\n')[0]).toBe(HEADER);
  });

  it('writes a BOM and CRLF, because the audience is Excel', async () => {
    await importCsv(csv(TWO_SUM));
    const { csv: out } = await exportTrackedCsv(ctx.db, userId);

    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toContain('\r\n');
  });

  it('ROUND TRIP: export → import produces zero new rows', async () => {
    await importCsv(csv(TWO_SUM, THREE_SUM));

    const before = await ctx.sql`SELECT id FROM problems`;
    const links = await ctx.sql`SELECT id FROM user_problems`;

    const { csv: exported } = await exportTrackedCsv(ctx.db, userId);
    const results = await importCsv(exported);

    expect(results.every((row) => row.outcome === 'duplicate')).toBe(true);
    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(before.length);
    expect(await ctx.sql`SELECT id FROM user_problems`).toHaveLength(links.length);
  });

  it('ROUND TRIP twice — the second lap is where drift would show', async () => {
    /*
     * A title that is a formula payload AND one that already looks escaped.
     * Both go through two full cycles; the titles in the database must be
     * byte-identical to what went in, on both laps.
     */
    await importCsv(
      csv(
        '"=HYPERLINK(""evil"",""x"")",leetcode,https://leetcode.com/problems/a/,easy,arrays',
        `"'=already",leetcode,https://leetcode.com/problems/b/,easy,arrays`,
        TWO_SUM,
      ),
    );

    const titlesAfterImport = (await ctx.sql`SELECT title FROM problems ORDER BY title`).map(
      (row) => row.title,
    );

    for (let lap = 1; lap <= 2; lap += 1) {
      const { csv: exported } = await exportTrackedCsv(ctx.db, userId);
      const results = await importCsv(exported);

      expect(
        results.every((row) => row.outcome === 'duplicate'),
        `lap ${lap}`,
      ).toBe(true);
      expect(await ctx.sql`SELECT id FROM problems`, `lap ${lap}`).toHaveLength(3);

      const titles = (await ctx.sql`SELECT title FROM problems ORDER BY title`).map(
        (row) => row.title,
      );
      expect(titles, `titles drifted on lap ${lap}`).toEqual(titlesAfterImport);
    }
  });

  it('neutralises a formula title in the exported bytes', async () => {
    await importCsv(
      csv('"=HYPERLINK(""evil"",""x"")",leetcode,https://leetcode.com/problems/a/,easy,'),
    );

    const { csv: exported } = await exportTrackedCsv(ctx.db, userId);

    // The cell as Excel would read it must not begin with `=`.
    const dataLine = exported.replace(/^﻿/, '').split('\r\n')[1] ?? '';
    expect(dataLine.startsWith('"=')).toBe(false);
    expect(dataLine).toContain("'=HYPERLINK");
  });

  it('OMITS archived problems, and says how many', async () => {
    /*
     * The decision, asserted. Including an archived problem would round-trip it
     * back in as a NEW live draft — the dedup lookup skips archived rows, so on
     * re-import it does not match — letting a user silently undo an admin's
     * moderation by exporting and re-importing their own list.
     */
    await importCsv(csv(TWO_SUM, THREE_SUM));
    await ctx.sql`
      UPDATE problems SET status = 'archived'
      WHERE external_url_normalised = 'leetcode.com/problems/three-sum'
    `;

    const result = await exportTrackedCsv(ctx.db, userId);

    expect(result.rowCount).toBe(1);
    expect(result.omittedArchived).toBe(1);
    expect(result.csv).not.toContain('three-sum');
  });

  it('the round trip still produces zero new rows WITH an archived problem present', async () => {
    // The omission is what makes the criterion hold. If archived rows were
    // exported, this re-import would create one new draft.
    await importCsv(csv(TWO_SUM, THREE_SUM));
    await ctx.sql`
      UPDATE problems SET status = 'archived'
      WHERE external_url_normalised = 'leetcode.com/problems/three-sum'
    `;

    const before = await ctx.sql`SELECT id FROM problems`;
    const { csv: exported } = await exportTrackedCsv(ctx.db, userId);
    await importCsv(exported);

    expect(await ctx.sql`SELECT id FROM problems`).toHaveLength(before.length);
  });

  it('exports topic tags only, not pattern tags', async () => {
    // The importer's `topic` column is the only tag type it understands.
    // Exporting a pattern tag would re-import it AS a topic — a quiet type
    // change that would compound on every lap.
    await importCsv(csv(TWO_SUM));
    const [problem] = await ctx.sql`SELECT id FROM problems LIMIT 1`;
    await ctx.sql`
      INSERT INTO problem_tags (problem_id, tag_type, tag_value)
      VALUES (${problem!.id}, 'pattern', 'two-pointers')
    `;

    const { csv: exported } = await exportTrackedCsv(ctx.db, userId);

    expect(exported).toContain('arrays');
    expect(exported).not.toContain('two-pointers');
  });

  it('exports nothing but a header for a user with no problems', async () => {
    const result = await exportTrackedCsv(ctx.db, userId);
    expect(result.rowCount).toBe(0);
    expect(result.csv.replace(/^﻿/, '').trim()).toBe(HEADER);
  });
});
