/**
 * Codeforces sync — a user's accepted submissions become tracked problems.
 *
 * Source: the official public API, `GET /api/user.status?handle=…`, which
 * Codeforces offers for programs and which needs no key for public data. One
 * call per sync; the API allows one call every two seconds, so each user may
 * sync at most once per `CODEFORCES_SYNC_COOLDOWN_MS`.
 *
 * What a sync does, per distinct accepted problem:
 *   1. the same import path a CSV row takes (`importRows`): link the catalog
 *      problem, or create a private `draft` one — title, link, rating band and
 *      tags only, never a statement (C1);
 *   2. mark it solved, dated by the first accepted submission — but only if the
 *      user had not already moved it on. `solved` and `needs_revision` are never
 *      touched, and nothing is ever downgraded.
 *
 * Re-running is safe: every step is idempotent.
 *
 * Gym problems (contest id ≥ 100000) are skipped — they are not part of the
 * public problemset and their pages are often private.
 */
import { eq, sql } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { codeforcesLinks } from '@/server/db/schema';
import { difficultyForRating, problemUrl, topicsForTags } from './codeforces';
import type { ValidImportRow } from './csv';
import { importRows } from './import';
import { normaliseProblemUrl } from './normalise-url';

export const CODEFORCES_HANDLE_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;
export const CODEFORCES_SYNC_COOLDOWN_MS = 10 * 60_000;
const API = 'https://codeforces.com/api/user.status';
const GYM_CONTEST_ID = 100_000;
const CHUNK = 200;

export class CodeforcesSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeforcesSyncError';
  }
}

type Submission = {
  creationTimeSeconds: number;
  verdict?: string;
  problem: {
    contestId?: number;
    index: string;
    name: string;
    rating?: number;
    tags?: string[];
  };
};

export type AcceptedProblem = {
  row: ValidImportRow;
  firstAcceptedAt: Date;
};

/**
 * Accepted submissions → one import row per problem, dated by its FIRST
 * accepted submission. Pure, so the mapping is testable without the network.
 */
export function acceptedProblems(submissions: readonly Submission[]): AcceptedProblem[] {
  const byUrl = new Map<string, AcceptedProblem>();
  for (const submission of submissions) {
    const { problem } = submission;
    if (submission.verdict !== 'OK') continue;
    if (typeof problem.contestId !== 'number' || problem.contestId >= GYM_CONTEST_ID) continue;
    const title = problem.name.trim().slice(0, 200);
    if (title.length === 0) continue;

    const url = problemUrl(problem.contestId, problem.index);
    const normalisedUrl = normaliseProblemUrl(url);
    if (!normalisedUrl) continue;

    const at = new Date(submission.creationTimeSeconds * 1000);
    const seen = byUrl.get(normalisedUrl);
    if (seen) {
      if (at < seen.firstAcceptedAt) seen.firstAcceptedAt = at;
      continue;
    }
    byUrl.set(normalisedUrl, {
      firstAcceptedAt: at,
      row: {
        rowNumber: byUrl.size + 1,
        raw: {},
        title,
        url,
        normalisedUrl,
        platform: 'codeforces',
        difficulty:
          typeof problem.rating === 'number' ? difficultyForRating(problem.rating) : 'medium',
        topics: topicsForTags(problem.tags ?? []),
      },
    });
  }
  return [...byUrl.values()].sort(
    (a, b) => a.firstAcceptedAt.getTime() - b.firstAcceptedAt.getTime(),
  );
}

/** One call to the official API. Throws `CodeforcesSyncError` with a message fit to show. */
export async function fetchSubmissions(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Submission[]> {
  let response: Response;
  try {
    response = await fetchImpl(`${API}?handle=${encodeURIComponent(handle)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CodeforcesSyncError('Codeforces could not be reached. Try again in a minute.');
  }

  let body: { status?: string; comment?: string; result?: Submission[] };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new CodeforcesSyncError(`Codeforces answered with HTTP ${response.status}.`);
  }

  if (body.status !== 'OK' || !Array.isArray(body.result)) {
    const comment = body.comment ?? `HTTP ${response.status}`;
    if (/not found/i.test(comment)) {
      throw new CodeforcesSyncError(`No Codeforces user is called ${handle}.`);
    }
    if (/limit exceeded/i.test(comment)) {
      throw new CodeforcesSyncError(
        'Codeforces is rate-limiting requests. Try again in a minute.',
      );
    }
    throw new CodeforcesSyncError(`Codeforces refused the request: ${comment.slice(0, 160)}`);
  }
  return body.result;
}

export type CodeforcesSyncResult = {
  accepted: number;
  created: number;
  linked: number;
  alreadyTracked: number;
  markedSolved: number;
};

/** Connect (or change) a handle. A changed handle may sync straight away. */
export async function saveCodeforcesHandle(
  db: Database,
  userId: string,
  handle: string,
): Promise<void> {
  const trimmed = handle.trim();
  if (!CODEFORCES_HANDLE_PATTERN.test(trimmed)) {
    throw new CodeforcesSyncError(
      'A Codeforces handle is 3–24 letters, digits, dots, hyphens or underscores.',
    );
  }
  await db
    .insert(codeforcesLinks)
    .values({ userId, handle: trimmed })
    .onConflictDoUpdate({
      target: codeforcesLinks.userId,
      set: {
        handle: trimmed,
        lastSyncedAt: sql`case when ${codeforcesLinks.handle} = ${trimmed} then ${codeforcesLinks.lastSyncedAt} else null end`,
        updatedAt: new Date(),
      },
    });
}

export async function disconnectCodeforces(db: Database, userId: string): Promise<void> {
  await db.delete(codeforcesLinks).where(eq(codeforcesLinks.userId, userId));
}

export async function getCodeforcesLink(db: Database, userId: string) {
  const [link] = await db
    .select()
    .from(codeforcesLinks)
    .where(eq(codeforcesLinks.userId, userId))
    .limit(1);
  return link ?? null;
}

/**
 * Sync the connected handle. Records the outcome — counts or the error — on
 * the link row so the settings page can show it, then rethrows a failure.
 */
export async function syncCodeforces(
  db: Database,
  input: { userId: string; now: Date; fetchImpl?: typeof fetch },
): Promise<CodeforcesSyncResult> {
  const link = await getCodeforcesLink(db, input.userId);
  if (!link) throw new CodeforcesSyncError('Connect a Codeforces handle first.');

  if (
    link.lastSyncedAt &&
    input.now.getTime() - link.lastSyncedAt.getTime() < CODEFORCES_SYNC_COOLDOWN_MS
  ) {
    const minutes = Math.ceil(
      (CODEFORCES_SYNC_COOLDOWN_MS - (input.now.getTime() - link.lastSyncedAt.getTime())) /
        60_000,
    );
    throw new CodeforcesSyncError(`Synced recently. Try again in ${minutes} min.`);
  }

  // Claim the slot before the network call, so a double click cannot sync twice.
  await db
    .update(codeforcesLinks)
    .set({ lastSyncedAt: input.now, updatedAt: input.now })
    .where(eq(codeforcesLinks.userId, input.userId));

  try {
    const problems = acceptedProblems(await fetchSubmissions(link.handle, input.fetchImpl));
    const result: CodeforcesSyncResult = {
      accepted: problems.length,
      created: 0,
      linked: 0,
      alreadyTracked: 0,
      markedSolved: 0,
    };

    for (let start = 0; start < problems.length; start += CHUNK) {
      const chunk = problems.slice(start, start + CHUNK);
      const imported = await importRows(
        db,
        input.userId,
        chunk.map((problem) => problem.row),
      );
      for (const row of imported) {
        if (row.outcome === 'created') result.created += 1;
        else if (row.outcome === 'linked') result.linked += 1;
        else result.alreadyTracked += 1;
      }

      // One statement per chunk; the pairs travel as a JSON parameter.
      const pairs = JSON.stringify(
        imported.map((row) => ({
          problem_id: row.problemId,
          at: chunk
            .find((problem) => problem.row.rowNumber === row.rowNumber)!
            .firstAcceptedAt.toISOString(),
        })),
      );
      const updated = await db.execute(sql`
        update user_problems as up
        set status = 'solved',
            first_solved_at = coalesce(up.first_solved_at, solved.at),
            last_attempted_at = greatest(coalesce(up.last_attempted_at, solved.at), solved.at),
            updated_at = ${input.now.toISOString()}::timestamptz
        from jsonb_to_recordset(${pairs}::jsonb) as solved(problem_id uuid, at timestamptz)
        where up.user_id = ${input.userId}
          and up.problem_id = solved.problem_id
          and up.status in ('not_started', 'in_progress', 'stuck')
        returning up.id
      `);
      result.markedSolved += Array.isArray(updated) ? updated.length : 0;
    }

    await db
      .update(codeforcesLinks)
      .set({ lastResult: { ...result, handle: link.handle }, updatedAt: new Date() })
      .where(eq(codeforcesLinks.userId, input.userId));
    return result;
  } catch (error) {
    const message =
      error instanceof CodeforcesSyncError
        ? error.message
        : 'The sync failed. Try again later.';
    await db
      .update(codeforcesLinks)
      // A failed sync gives the slot back, so fixing the problem does not mean waiting.
      .set({
        lastSyncedAt: link.lastSyncedAt,
        lastResult: { error: message, handle: link.handle },
        updatedAt: new Date(),
      })
      .where(eq(codeforcesLinks.userId, input.userId));
    throw error instanceof CodeforcesSyncError ? error : new CodeforcesSyncError(message);
  }
}
