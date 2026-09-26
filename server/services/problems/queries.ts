/**
 * Catalog reads: list, search, detail.
 *
 * Every filter is applied in SQL. Nothing is fetched and filtered in JS — that
 * would both scale badly and leak rows the caller should not see into memory.
 */
import { type SQL, and, asc, desc, eq, exists, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { problemTags, problems, userProblems } from '@/server/db/schema';
import { type Cursor, decodeCursor, encodeCursor } from './cursor';
import { ProblemNotFoundError } from './errors';
import { isFeatureEnabled } from '@/lib/flags';
import { type ParsedListFilters, listFiltersSchema } from '@/lib/problems/schemas';

/**
 * F4.1 · whether ORIGINAL problems are visible to ordinary users.
 *
 * `FEATURE_ORIGINAL_PROBLEMS` was declared with the flags but never read — the
 * comment in `lib/flags.ts` said "NOT wired", and a flag that gates nothing is
 * worse than no flag, because it implies a control that does not exist.
 *
 * It is wired here rather than at the page, because there are three entry
 * points to the catalog — list, search and detail — and a gate applied at one
 * of them is a gate the other two route around. A problem hidden from the list
 * but reachable by slug is not hidden.
 *
 * Note this gates VISIBILITY, not status: `status = 'published'` still governs
 * whether a problem is finished. This is the separate question of whether the
 * original-content catalog is switched on at all, which is what lets a bad
 * import be hidden without archiving a hundred rows one at a time.
 */
export function originalsVisible(): boolean {
  return isFeatureEnabled('FEATURE_ORIGINAL_PROBLEMS');
}

/** Restricts a query to external links while the flag is off. */
const EXTERNAL_ONLY: SQL = eq(problems.sourceType, 'external_link');

export type ProblemListItem = {
  id: string;
  slug: string;
  title: string;
  sourceType: 'external_link' | 'original';
  platform: string | null;
  externalUrl: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedMinutes: number;
  isPremium: boolean;
  status: string;
  createdAt: Date;
  tags: Array<{ tagType: string; tagValue: string }>;
  userStatus: string | null;
};

export type ProblemPage = {
  rows: ProblemListItem[];
  nextCursor: string | null;
};

/**
 * Keyset predicate for `(created_at DESC, id DESC)`.
 *
 * Strictly "less than" the anchor in that composite order, which is what makes
 * the page boundary exact: a row equal to the anchor was already returned, and
 * a row inserted after the anchor sorts above it and is never seen again by
 * this scan.
 */
function keysetPredicate(cursor: Cursor): SQL {
  return or(
    lt(problems.createdAt, cursor.createdAt),
    and(eq(problems.createdAt, cursor.createdAt), lt(problems.id, cursor.id)),
  )!;
}

/** Restricts to a tag without a JOIN, so the row count cannot be multiplied. */
function hasTag(tagType: 'topic' | 'pattern' | 'company_style', tagValue: string): SQL {
  return exists(
    sql`(SELECT 1 FROM ${problemTags}
         WHERE ${problemTags.problemId} = ${problems.id}
           AND ${problemTags.tagType} = ${tagType}
           AND ${problemTags.tagValue} = ${tagValue})`,
  );
}

export type ListOptions = {
  db: Database;
  filters: ParsedListFilters;
  /** Signed-in user, if any. Required for the `userStatus` filter to apply. */
  userId?: string | null;
  /**
   * Show original problems regardless of `FEATURE_ORIGINAL_PROBLEMS`.
   *
   * Only `/admin/problems` passes this: review is how an original becomes
   * publishable, so gating the admin catalog on the flag would make the
   * feature impossible to turn on. Explicit rather than inferred from
   * `includeHidden`, which is about status and is a different question.
   */
  includeOriginals?: boolean;
};

export async function listProblems({
  db,
  filters,
  userId,
  includeOriginals,
}: ListOptions): Promise<ProblemPage> {
  const conditions: SQL[] = [];

  if (!(includeOriginals ?? originalsVisible())) conditions.push(EXTERNAL_ONLY);

  /*
   * Visibility. Archived problems are excluded from the catalog by default —
   * archiving is a catalog-visibility change, never a deletion, and
   * `getProblemBySlug` still resolves them for a user with history.
   */
  if (!filters.includeHidden) {
    conditions.push(eq(problems.status, 'published'));
  }

  if (filters.difficulty) conditions.push(eq(problems.difficulty, filters.difficulty));
  if (filters.platform) conditions.push(eq(problems.platform, filters.platform));
  if (filters.topic) conditions.push(hasTag('topic', filters.topic));
  if (filters.pattern) conditions.push(hasTag('pattern', filters.pattern));

  if (filters.search) {
    // `websearch_to_tsquery` accepts human input ("binary search" -"tree")
    // without throwing on syntax the user did not know was syntax.
    conditions.push(
      sql`${problems.searchVector} @@ websearch_to_tsquery('english', ${filters.search})`,
    );
  }

  // The user's own solve status. Only meaningful when signed in; a filter on
  // it while anonymous returns nothing rather than silently ignoring the
  // filter, which would show a misleading list.
  if (filters.userStatus) {
    if (!userId) return { rows: [], nextCursor: null };
    conditions.push(
      exists(
        sql`(SELECT 1 FROM ${userProblems}
             WHERE ${userProblems.problemId} = ${problems.id}
               AND ${userProblems.userId} = ${userId}
               AND ${userProblems.status} = ${filters.userStatus})`,
      ),
    );
  }

  if (filters.cursor) conditions.push(keysetPredicate(decodeCursor(filters.cursor)));

  // One extra row tells us whether another page exists without a COUNT.
  const limit = filters.limit;
  const rows = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      sourceType: problems.sourceType,
      platform: problems.platform,
      externalUrl: problems.externalUrl,
      difficulty: problems.difficulty,
      estimatedMinutes: problems.estimatedMinutes,
      isPremium: problems.isPremium,
      status: problems.status,
      createdAt: problems.createdAt,
    })
    .from(problems)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    /*
     * `NULLS LAST` is REQUIRED, not cosmetic.
     *
     * Drizzle emits index columns as `DESC NULLS LAST`, but Postgres defaults a
     * bare `ORDER BY x DESC` to `NULLS FIRST`. The two sort orders do not
     * match, so the planner refuses the index and falls back to a sequential
     * scan plus a top-N sort. Both columns are NOT NULL, so this changes no
     * result — only whether the index is usable.
     *
     * Measured at 20k rows: 27.98ms (seq scan) vs 0.27ms (index scan).
     */
    .orderBy(sql`${problems.createdAt} DESC NULLS LAST`, sql`${problems.id} DESC NULLS LAST`)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const decorated = await attachTagsAndStatus(db, page, userId ?? null);

  const last = page.at(-1);
  return {
    rows: decorated,
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

/**
 * Second query for tags and per-user status.
 *
 * Deliberately not a JOIN in the main query: joining a one-to-many tag table
 * multiplies rows, which breaks LIMIT — you would ask for 25 problems and get
 * 25 tag rows covering eight problems.
 */
async function attachTagsAndStatus(
  db: Database,
  page: Array<Omit<ProblemListItem, 'tags' | 'userStatus'>>,
  userId: string | null,
): Promise<ProblemListItem[]> {
  if (page.length === 0) return [];

  const ids = page.map((row) => row.id);

  const tags = await db
    .select({
      problemId: problemTags.problemId,
      tagType: problemTags.tagType,
      tagValue: problemTags.tagValue,
    })
    .from(problemTags)
    .where(sql`${problemTags.problemId} IN ${ids}`);

  const tagsByProblem = new Map<string, Array<{ tagType: string; tagValue: string }>>();
  for (const tag of tags) {
    const list = tagsByProblem.get(tag.problemId) ?? [];
    list.push({ tagType: tag.tagType, tagValue: tag.tagValue });
    tagsByProblem.set(tag.problemId, list);
  }

  const statusByProblem = new Map<string, string>();
  if (userId) {
    const owned = await db
      .select({ problemId: userProblems.problemId, status: userProblems.status })
      .from(userProblems)
      .where(and(eq(userProblems.userId, userId), sql`${userProblems.problemId} IN ${ids}`));

    for (const row of owned) statusByProblem.set(row.problemId, row.status);
  }

  return page.map((row) => ({
    ...row,
    tags: tagsByProblem.get(row.id) ?? [],
    userStatus: statusByProblem.get(row.id) ?? null,
  }));
}

/** Ranked title search. Separate from `listProblems` because the ORDER BY differs. */
export async function searchProblems(
  db: Database,
  term: string,
  limit = 20,
): Promise<Array<{ id: string; slug: string; title: string; rank: number }>> {
  const rows = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      rank: sql<number>`ts_rank(${problems.searchVector}, websearch_to_tsquery('english', ${term}))`,
    })
    .from(problems)
    .where(
      and(
        eq(problems.status, 'published'),
        // Search is a third route into the catalog; gating only the list would
        // leave originals findable by typing their title.
        ...(originalsVisible() ? [] : [EXTERNAL_ONLY]),
        sql`${problems.searchVector} @@ websearch_to_tsquery('english', ${term})`,
      ),
    )
    .orderBy(
      desc(sql`ts_rank(${problems.searchVector}, websearch_to_tsquery('english', ${term}))`),
      asc(problems.title),
    )
    .limit(limit);

  return rows;
}

export type ProblemDetail = ProblemListItem & {
  statement: string | null;
  currentVersion: number;
  history: Array<{
    status: string;
    totalAttempts: number;
    bestTimeSeconds: number | null;
    firstSolvedAt: Date | null;
    lastAttemptedAt: Date | null;
    confidence: string | null;
  }>;
};

/**
 * Detail by slug.
 *
 * An ARCHIVED problem still resolves here when the caller has history with it
 * — the agreed semantics: archiving hides a problem from the catalog, it does
 * not orphan a user's past work or break their links.
 */
export async function getProblemBySlug(
  db: Database,
  slug: string,
  userId: string | null,
): Promise<ProblemDetail> {
  const [row] = await db.select().from(problems).where(eq(problems.slug, slug)).limit(1);
  if (!row) throw new ProblemNotFoundError(slug);

  const history = userId
    ? await db
        .select({
          status: userProblems.status,
          totalAttempts: userProblems.totalAttempts,
          bestTimeSeconds: userProblems.bestTimeSeconds,
          firstSolvedAt: userProblems.firstSolvedAt,
          lastAttemptedAt: userProblems.lastAttemptedAt,
          confidence: userProblems.confidence,
        })
        .from(userProblems)
        .where(and(eq(userProblems.userId, userId), eq(userProblems.problemId, row.id)))
    : [];

  // Hidden and no history with it — behave as if it does not exist rather than
  // confirming a draft problem's slug.
  if (row.status !== 'published' && history.length === 0) {
    throw new ProblemNotFoundError(slug);
  }

  /*
   * Same rule for an original while the flag is off: a 404, not a 403.
   *
   * History is honoured for the same reason archiving honours it — someone who
   * has already solved a problem keeps their link to it even after the catalog
   * stops offering it. Turning the flag off is a catalog change, not a
   * retroactive deletion of anyone's work.
   */
  if (row.sourceType === 'original' && !originalsVisible() && history.length === 0) {
    throw new ProblemNotFoundError(slug);
  }

  const tags = await db
    .select({ tagType: problemTags.tagType, tagValue: problemTags.tagValue })
    .from(problemTags)
    .where(eq(problemTags.problemId, row.id));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    sourceType: row.sourceType,
    platform: row.platform,
    externalUrl: row.externalUrl,
    difficulty: row.difficulty,
    estimatedMinutes: row.estimatedMinutes,
    isPremium: row.isPremium,
    status: row.status,
    createdAt: row.createdAt,
    statement: row.statement,
    currentVersion: row.currentVersion,
    tags,
    userStatus: history[0]?.status ?? null,
    history,
  };
}

/** Parses raw input (search params, JSON body) into validated filters. */
export function parseFilters(input: unknown): ParsedListFilters {
  return listFiltersSchema.parse(input ?? {});
}

export { isNull };
