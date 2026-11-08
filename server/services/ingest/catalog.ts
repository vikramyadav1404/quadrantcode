/**
 * The admin catalog import: a CSV of external-link problems, PUBLISHED to the
 * public catalog in chunks (`/admin/problems/import`).
 *
 * ## How it differs from the personal import (`import.ts`)
 *
 * The personal import creates `draft` problems linked to one user, invisible to
 * everyone else. This one is the catalog's: rows are created `published`, no
 * user is linked, and every chunk is audited against the admin who ran it.
 *
 * ## Stateless chunks, driven by the browser
 *
 * There is no job table here. The browser posts the same file once per chunk
 * with an offset; the route re-parses it (milliseconds) and hands this module
 * one slice. Every step is keyed on the normalised URL, which the partial
 * unique index `problems_external_url_normalised_key` protects, so running a
 * chunk twice changes nothing and "resume" is simply "upload it again". That
 * replaces a background job, which on serverless can be suspended mid-import.
 *
 * ## What happens to a URL that already exists
 *
 *   new                          created as `published`, with its topic tags
 *   a user's `draft` (personal)  PUBLISHED with this file's title, difficulty
 *                                and platform, topics added. The index allows
 *                                one live row per link, so this is the only way
 *                                that link can join the catalog. The user's own
 *                                link to it is untouched.
 *   anything else live           left exactly as it is: an admin edits a
 *                                published problem one at a time
 *   archived                     ignored by the index, so a new row is created
 *
 * C1: like the personal import, nothing here can write a statement. External
 * links carry metadata and a link only, and the database enforces it too.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import { problemTags, problems } from '@/server/db/schema';
import { recordAudit } from '@/server/lib/observability/audit';
import type { InvalidImportRow, ParsedCsv, ValidImportRow } from './csv';
import { slugForImportedUrl } from './import';

/** How many invalid rows a preview lists; the rest are counted. */
const PREVIEW_INVALID_ROWS = 100;

/** Lookup batch size, so a 10,000-row file is a few queries, not one huge IN list. */
const LOOKUP_BATCH = 1_000;

/**
 * A topic as a catalog tag: lowercase kebab-case ("Binary Search" →
 * `binary-search`), the form the catalog's topic filter and the
 * `problem_tags` CHECK accept. Null when nothing usable is left.
 */
export function toTopicTag(topic: string): string | null {
  const tag = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return tag.length > 0 ? tag : null;
}

function topicTagsOf(row: ValidImportRow): string[] {
  return [...new Set(row.topics.map(toTopicTag).filter((tag): tag is string => tag !== null))];
}

/**
 * Valid rows in file order, each normalised URL kept once (the first wins).
 *
 * The route chunks THIS list, so a link repeated in the file is imported once
 * and the offsets mean the same thing on every request for the same file.
 */
export function uniqueByUrl(rows: readonly ValidImportRow[]): {
  unique: ValidImportRow[];
  repeated: number;
} {
  const seen = new Set<string>();
  const unique: ValidImportRow[] = [];
  for (const row of rows) {
    if (seen.has(row.normalisedUrl)) continue;
    seen.add(row.normalisedUrl);
    unique.push(row);
  }
  return { unique, repeated: rows.length - unique.length };
}

type Existing = { id: string; status: string };

/**
 * The live (non-archived) problems for these URLs.
 *
 * `status <> 'archived'` mirrors the partial unique index exactly, as in
 * `importRows`: if the two disagreed, an insert could conflict on a row this
 * lookup did not see.
 */
async function findExisting(
  db: Database | Transaction,
  urls: readonly string[],
): Promise<Map<string, Existing>> {
  const found = new Map<string, Existing>();
  for (let start = 0; start < urls.length; start += LOOKUP_BATCH) {
    const batch = urls.slice(start, start + LOOKUP_BATCH);
    const rows = await db
      .select({
        id: problems.id,
        status: problems.status,
        normalisedUrl: problems.externalUrlNormalised,
      })
      .from(problems)
      .where(
        and(
          inArray(problems.externalUrlNormalised, batch),
          sql`${problems.status} <> 'archived'`,
        ),
      );
    for (const row of rows) {
      if (row.normalisedUrl) found.set(row.normalisedUrl, { id: row.id, status: row.status });
    }
  }
  return found;
}

export type CatalogPreview = {
  totalRows: number;
  validCount: number;
  invalid: Pick<InvalidImportRow, 'rowNumber' | 'error' | 'field'>[];
  invalidCount: number;
  /** Valid rows whose link appears earlier in the same file. */
  repeatedInFile: number;
  /** Unique links that will be imported, and therefore what the chunks cover. */
  importable: number;
  toCreate: number;
  toPublish: number;
  alreadyInCatalog: number;
};

/** What the file would do, without writing anything. */
export async function previewCatalogImport(
  db: Database,
  parsed: ParsedCsv,
): Promise<CatalogPreview> {
  const { unique, repeated } = uniqueByUrl(parsed.valid);
  const existing = await findExisting(
    db,
    unique.map((row) => row.normalisedUrl),
  );

  let toPublish = 0;
  let alreadyInCatalog = 0;
  for (const row of unique) {
    const found = existing.get(row.normalisedUrl);
    if (!found) continue;
    if (found.status === 'draft') toPublish += 1;
    else alreadyInCatalog += 1;
  }

  return {
    totalRows: parsed.totalRows,
    validCount: parsed.valid.length,
    invalid: parsed.invalid
      .slice(0, PREVIEW_INVALID_ROWS)
      .map(({ rowNumber, error, field }) => ({ rowNumber, error, field })),
    invalidCount: parsed.invalid.length,
    repeatedInFile: repeated,
    importable: unique.length,
    toCreate: unique.length - toPublish - alreadyInCatalog,
    toPublish,
    alreadyInCatalog,
  };
}

export type CatalogChunkResult = {
  created: number;
  published: number;
  alreadyInCatalog: number;
};

/**
 * Import one chunk of unique rows into the catalog, in one transaction, with
 * one audit entry for it.
 *
 * Safe to run twice: the second run finds every link live and reports it as
 * `alreadyInCatalog`, writing only the audit entry.
 */
export async function importCatalogChunk(
  db: Database,
  rows: readonly ValidImportRow[],
  actorId: string,
): Promise<CatalogChunkResult> {
  if (rows.length === 0) return { created: 0, published: 0, alreadyInCatalog: 0 };

  return db.transaction(async (tx) => {
    const existing = await findExisting(
      tx,
      rows.map((row) => row.normalisedUrl),
    );
    const fresh = rows.filter((row) => !existing.has(row.normalisedUrl));
    const drafts = rows.filter((row) => existing.get(row.normalisedUrl)?.status === 'draft');

    let created = 0;
    if (fresh.length > 0) {
      const inserted = await tx
        .insert(problems)
        .values(
          fresh.map((row) => ({
            slug: slugForImportedUrl(row.normalisedUrl),
            title: row.title,
            sourceType: 'external_link' as const,
            platform: row.platform,
            externalUrl: row.url,
            externalUrlNormalised: row.normalisedUrl,
            difficulty: row.difficulty,
            status: 'published' as const,
          })),
        )
        /*
         * Targeted at the dedup index with its predicate, as in `import.ts`: a
         * link created by someone else between the lookup and this insert is
         * skipped (and counted as already in the catalog), while any OTHER
         * unique violation still fails the chunk loudly.
         */
        .onConflictDoNothing({
          target: problems.externalUrlNormalised,
          where: sql`${problems.externalUrlNormalised} is not null and ${problems.status} <> 'archived'`,
        })
        .returning({ id: problems.id, normalisedUrl: problems.externalUrlNormalised });

      created = inserted.length;
      const idByUrl = new Map(inserted.map((row) => [row.normalisedUrl, row.id]));
      const tags = fresh.flatMap((row) => {
        const problemId = idByUrl.get(row.normalisedUrl);
        return problemId
          ? topicTagsOf(row).map((tagValue) => ({
              problemId,
              tagType: 'topic' as const,
              tagValue,
            }))
          : [];
      });
      if (tags.length > 0) await tx.insert(problemTags).values(tags).onConflictDoNothing();
    }

    let published = 0;
    for (const row of drafts) {
      const problemId = existing.get(row.normalisedUrl)!.id;
      const updated = await tx
        .update(problems)
        .set({
          status: 'published',
          title: row.title,
          difficulty: row.difficulty,
          platform: row.platform,
          updatedAt: new Date(),
        })
        // Still a draft: a row published in between is left as it is.
        .where(and(eq(problems.id, problemId), eq(problems.status, 'draft')))
        .returning({ id: problems.id });
      if (updated.length === 0) continue;
      published += 1;

      const tags = topicTagsOf(row).map((tagValue) => ({
        problemId,
        tagType: 'topic' as const,
        tagValue,
      }));
      if (tags.length > 0) await tx.insert(problemTags).values(tags).onConflictDoNothing();
    }

    const result = { created, published, alreadyInCatalog: rows.length - created - published };

    await recordAudit(tx, {
      actorId,
      action: 'catalog.csv_imported',
      target: 'problems',
      after: { rows: rows.length, ...result },
    });

    return result;
  });
}
