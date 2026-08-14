/**
 * The import service — turning validated rows into catalog problems and links.
 *
 * ## What an import actually does
 *
 * Two things per row, and the distinction matters for the counts the user sees:
 *
 *   CREATED    the URL was not in the catalog; a `draft` problem is created and
 *              linked to the user
 *   LINKED     the URL was already in the catalog (someone else imported it, or
 *              it is in the curated library); only the link is created
 *   DUPLICATE  the user already has this problem; nothing happens
 *
 * `duplicate` is deliberately not `failed`. Re-importing a list you already
 * have is the normal case — it is what "idempotent" MEANS here — and folding it
 * into failures would make a successful second run look broken.
 *
 * ## Why imported problems are `draft`
 *
 * `listProblems` filters to `status = 'published'`, and `getProblemBySlug`
 * returns a non-published problem to a user who has history on it. So a draft
 * import is invisible in the public catalog and fully visible to the person who
 * imported it, with no new visibility concept and no query changes. One user's
 * 500-row import cannot pollute everyone's catalog.
 *
 * ## Idempotency
 *
 * At two levels, because they fail differently:
 *
 *   JOB   `(user_id, content_hash)` is unique, so re-uploading the same bytes
 *         returns the existing job instead of starting a second one.
 *   ROW   the unique index on `external_url_normalised` means a concurrent
 *         import cannot create a second copy. The service reads before it
 *         writes, and treats a unique violation as "someone just created it" —
 *         that read-then-write is a race, and the index is what makes losing it
 *         harmless rather than a duplicate row.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { problemTags, problems, userProblems } from '@/server/db/schema';
import type { ValidImportRow } from './csv';

/** Deterministic job idempotency key. */
export function hashImportContent(source: string | Buffer): string {
  return createHash('sha256').update(source).digest('hex');
}

export type RowOutcome = 'created' | 'linked' | 'duplicate';

export type ImportRowResult = {
  rowNumber: number;
  outcome: RowOutcome;
  problemId: string;
};

/**
 * A slug for an imported problem: readable stem from the URL, random suffix.
 *
 * The suffix is RANDOM rather than a hash of the URL, and that is a correction.
 * A URL-derived slug looks tidier and is wrong, because the partial unique
 * index deliberately lets an archived problem and a live one share a URL — so
 * that a user who archived something can add it again. Two rows, one URL, and
 * therefore one slug: the second insert collided on `problems_slug_key` and,
 * because the conflict clause was untargeted, that collision was swallowed
 * exactly like a dedup race. The row was neither created nor findable and the
 * import failed on a URL it had every right to accept.
 *
 * Nothing needed the slug to be deterministic. Identity is
 * `external_url_normalised`; the slug is a readable handle, and making it a
 * function of the URL quietly asserted "one URL, forever one row", which the
 * schema explicitly does not promise.
 */
export function slugForImportedUrl(normalisedUrl: string): string {
  const readable = normalisedUrl
    .replace(/^[^/]+\//, '') // drop the host
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);

  return `${readable || 'problem'}-${randomBytes(4).toString('hex')}`;
}

/**
 * Import one chunk of validated rows for a user.
 *
 * Returns a verdict per row. Safe to call twice with the same input: the second
 * call reports every row as `duplicate` and writes nothing.
 *
 * Chunked rather than row-at-a-time because the catalog lookup is one query for
 * the whole chunk instead of one per row — at 500 rows that is the difference
 * between 1 round trip and 500.
 */
export async function importRows(
  db: Database,
  userId: string,
  rows: readonly ValidImportRow[],
): Promise<ImportRowResult[]> {
  if (rows.length === 0) return [];

  const results: ImportRowResult[] = [];

  /*
   * One lookup for the whole chunk.
   *
   * `status <> 'archived'` mirrors the partial unique index exactly. If this
   * predicate and the index ever disagreed, the lookup would miss a row the
   * index still protects and every insert in the chunk would fail on conflict.
   */
  const urls = [...new Set(rows.map((row) => row.normalisedUrl))];
  const existing = await db
    .select({ id: problems.id, normalisedUrl: problems.externalUrlNormalised })
    .from(problems)
    .where(
      and(inArray(problems.externalUrlNormalised, urls), sql`${problems.status} <> 'archived'`),
    );

  const catalog = new Map<string, string>();
  for (const row of existing) {
    if (row.normalisedUrl) catalog.set(row.normalisedUrl, row.id);
  }

  for (const row of rows) {
    let problemId = catalog.get(row.normalisedUrl);
    let outcome: RowOutcome = problemId ? 'linked' : 'created';

    if (!problemId) {
      problemId = await createImportedProblem(db, row);

      /*
       * `createImportedProblem` returns an existing id when it loses the race
       * to the unique index. That is a LINK, not a CREATE, and the counts have
       * to say so — otherwise two users importing the same list would both be
       * told they created it.
       */
      if (catalog.get(row.normalisedUrl) !== undefined) outcome = 'linked';
      catalog.set(row.normalisedUrl, problemId);
    }

    const linked = await linkUserProblem(db, userId, problemId);
    results.push({
      rowNumber: row.rowNumber,
      outcome: linked ? outcome : 'duplicate',
      problemId,
    });
  }

  return results;
}

/**
 * Create a `draft` problem for an imported row, or return the id of the one
 * that already exists.
 *
 * The insert carries `onConflictDoNothing` on the dedup index, so a concurrent
 * import racing this one produces no row and no error — the follow-up select
 * then finds whichever of the two won. Without the index this would be a
 * time-of-check-to-time-of-use bug that only appears under concurrency.
 */
async function createImportedProblem(db: Database, row: ValidImportRow): Promise<string> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(problems)
      .values({
        slug: slugForImportedUrl(row.normalisedUrl),
        title: row.title,
        sourceType: 'external_link',
        platform: row.platform,
        externalUrl: row.url,
        externalUrlNormalised: row.normalisedUrl,
        difficulty: row.difficulty,
        /*
         * Draft, so it stays out of the public catalog. Statement columns are
         * left NULL and are not settable from here at all — C1 is enforced by
         * `problems_external_link_no_statement` regardless, but the importer
         * never having a statement field to populate is the better guarantee.
         */
        status: 'draft',
      })
      /*
       * TARGETED at the dedup index, not a bare `onConflictDoNothing()`.
       *
       * A bare clause covers every unique constraint on the table, which
       * conflates "another import created this URL a millisecond ago" —
       * recoverable, find it and link — with "the slug collided", which is a
       * different bug entirely. Swallowing both meant a slug collision
       * presented as an unfindable row. Targeted, only the dedup race is
       * absorbed and anything else surfaces as the unique violation it is.
       *
       * The `where` clause is the INDEX PREDICATE, required because the index
       * is partial — it emits `ON CONFLICT (col) WHERE … DO NOTHING`, and
       * without it Postgres cannot match the inference to the index and
       * rejects the statement outright. (On `onConflictDoUpdate` the same
       * thing is spelled `targetWhere`; here it is `where`.)
       */
      .onConflictDoNothing({
        target: problems.externalUrlNormalised,
        where: sql`${problems.externalUrlNormalised} is not null and ${problems.status} <> 'archived'`,
      })
      .returning({ id: problems.id });

    if (inserted) {
      if (row.topics.length > 0) {
        await tx
          .insert(problemTags)
          .values(
            row.topics.map((topic) => ({
              problemId: inserted.id,
              tagType: 'topic' as const,
              tagValue: topic,
            })),
          )
          .onConflictDoNothing();
      }
      return inserted.id;
    }

    // Lost the race, or the slug collided. Find the row that exists.
    const [found] = await tx
      .select({ id: problems.id })
      .from(problems)
      .where(
        and(
          eq(problems.externalUrlNormalised, row.normalisedUrl),
          sql`${problems.status} <> 'archived'`,
        ),
      )
      .limit(1);

    if (!found) {
      /*
       * Should now be unreachable: the conflict clause above only absorbs the
       * dedup index, so reaching here means the row conflicted on that index
       * and then could not be found by the same predicate. Kept as a loud
       * failure rather than a skipped row, because under-reporting an import
       * is the outcome the user cannot detect.
       */
      throw new Error(
        `importRows: could not create or find a problem for ${row.normalisedUrl}`,
      );
    }
    return found.id;
  });
}

/**
 * Link a problem to a user.
 *
 * @returns true if a NEW link was made, false if the user already had it —
 *   which is what distinguishes `created`/`linked` from `duplicate`.
 */
async function linkUserProblem(
  db: Database,
  userId: string,
  problemId: string,
): Promise<boolean> {
  /*
   * Targeted, for the reason D16 records. `user_problems` carries TWO unique
   * constraints — the primary key and `(user_id, problem_id)` — and this
   * insert's return value is the only thing distinguishing `duplicate` from
   * `created`/`linked`. Untargeted, a conflict on either one reports the row
   * as a duplicate the user already had.
   *
   * A random-UUID primary key colliding is not a realistic worry. Naming the
   * constraint we actually mean costs nothing and stops the clause silently
   * widening the day a third unique index is added to this table.
   */
  const [row] = await db
    .insert(userProblems)
    .values({ userId, problemId, status: 'not_started' })
    .onConflictDoNothing({ target: [userProblems.userId, userProblems.problemId] })
    .returning({ id: userProblems.id });

  return row !== undefined;
}

/**
 * Everything a user has tracked, for export.
 *
 * No soft-delete filter: `user_problems` has no `deleted_at`. Un-tracking is a
 * hard delete today, so there is nothing to exclude — noted rather than left
 * implicit, because adding soft delete later means this query needs the filter
 * and would otherwise export rows the user thinks they removed.
 *
 * INNER join, so a link whose problem was hard-deleted drops out rather than
 * exporting a row with a null URL that could never re-import.
 */
export async function listTrackedForExport(db: Database, userId: string) {
  return db
    .select({
      title: problems.title,
      platform: problems.platform,
      url: problems.externalUrl,
      difficulty: problems.difficulty,
      problemId: problems.id,
    })
    .from(userProblems)
    .innerJoin(problems, eq(problems.id, userProblems.problemId))
    .where(eq(userProblems.userId, userId))
    .orderBy(problems.title);
}
