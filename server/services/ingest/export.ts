/**
 * CSV export — the user's tracked list, as a file they can re-import.
 *
 * Columns are identical to the import columns, in the same order, so the round
 * trip is closed by construction rather than by two lists being kept in step by
 * hand. `IMPORT_COLUMNS` is the single source.
 *
 * ## What an export contains when a problem has been ARCHIVED
 *
 * Archived problems are **omitted**, and the caller is told how many.
 *
 * This is a decision, not an oversight, and the alternative is worse in a way
 * that is hard to see. Including an archived problem would round-trip it back
 * in as a NEW live draft: the dedup lookup skips archived rows — deliberately,
 * so a user who archived something can add it back — so on re-import it does
 * not match, and a fresh `draft` is created. The user would have silently
 * resurrected a problem an admin moderated away, by doing nothing but exporting
 * and re-importing their own list. It would also break the acceptance criterion
 * outright: "export → import produces zero new rows" would produce one per
 * archived problem.
 *
 * Omitting silently would be its own quiet data change, so `exportTrackedCsv`
 * returns `omittedArchived` and the UI states it. The user's history is not
 * touched — F1.1 keeps `user_problems` rows through archival — it simply is not
 * in a file whose purpose is to be importable.
 */
import { and, eq, sql } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import type { Database } from '@/server/db';
import { problemTags, problems, userProblems } from '@/server/db/schema';
import { IMPORT_COLUMNS } from './limits';
import { escapeCell } from './spreadsheet-safety';

export type ExportResult = {
  csv: string;
  rowCount: number;
  /** Archived problems left out, so the caller can say so rather than hide it. */
  omittedArchived: number;
};

export async function exportTrackedCsv(db: Database, userId: string): Promise<ExportResult> {
  const rows = await db
    .select({
      title: problems.title,
      platform: problems.platform,
      url: problems.externalUrl,
      difficulty: problems.difficulty,
      /*
       * Topics aggregated in SQL rather than by a second query per problem.
       * `FILTER` keeps pattern and company_style tags out — the import schema
       * only understands `topic`, and exporting a tag type that cannot be
       * re-imported would break the round trip on the next lap.
       */
      topic: sql<string>`
        coalesce(
          (
            SELECT string_agg(${problemTags.tagValue}, ', ' ORDER BY ${problemTags.tagValue})
            FROM ${problemTags}
            WHERE ${problemTags.problemId} = ${problems.id}
              AND ${problemTags.tagType} = 'topic'
          ),
          ''
        )
      `.as('topic'),
    })
    .from(userProblems)
    .innerJoin(problems, eq(problems.id, userProblems.problemId))
    .where(
      and(
        eq(userProblems.userId, userId),
        // See the header: an archived problem cannot round-trip.
        sql`${problems.status} <> 'archived'`,
      ),
    )
    .orderBy(problems.title);

  const [{ count: archivedCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userProblems)
    .innerJoin(problems, eq(problems.id, userProblems.problemId))
    .where(and(eq(userProblems.userId, userId), sql`${problems.status} = 'archived'`));

  const records = rows.map((row) => [
    escapeCell(row.title),
    escapeCell(row.platform ?? ''),
    // A URL cannot begin with a formula lead, but it goes through the same
    // function anyway — per-field reasoning about which columns "could" be
    // dangerous is how one gets missed when a column is added.
    escapeCell(row.url ?? ''),
    escapeCell(row.difficulty),
    escapeCell(row.topic),
  ]);

  const csv = stringify(records, {
    header: true,
    columns: [...IMPORT_COLUMNS],
    /*
     * CRLF and a BOM, because the audience is Excel.
     *
     * Without the BOM Excel reads UTF-8 as the local codepage and mangles every
     * non-ASCII title. The parser sets `bom: true` for the same reason, so our
     * own file re-imports cleanly.
     */
    record_delimiter: 'windows',
    bom: true,
  });

  return { csv, rowCount: rows.length, omittedArchived: archivedCount };
}
