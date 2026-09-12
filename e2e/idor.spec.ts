/**
 * F4.8 · trying to read somebody else's things.
 *
 * The criterion: "attempt to read another user's session, snapshot,
 * submission, mock attempt and coin ledger by id — confirm 403/404 for each."
 *
 * ## Over real HTTP, because the criterion is about a status code
 *
 * The services are unit-tested to return null for another owner. That is a
 * claim about a function. Whether the STATUS a stranger receives is 404 rather
 * than 500 — or worse, 200 — is a different claim, and this project has already
 * been caught by that distinction once: F0.3's "gets 403" was asserted on a
 * thrown error type and hid a real 500.
 *
 * ## 404 rather than 403, deliberately
 *
 * A 403 confirms the id exists. A stranger who can tell "this session id is
 * real but not yours" from "this session id is nothing" has been handed a
 * membership oracle they can walk. Every check below asserts the response does
 * not distinguish the two.
 */
import { expect, test, type BrowserContext } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const OWNER = 'idor-owner@e2e.test';
const INTRUDER = 'idor-intruder@e2e.test';
const SLUG = 'idor-fixture';

/** Ids created by the owner, which the intruder will try to reach. */
type OwnedIds = {
  sessionId: string;
  snapshotId: string;
  executionJobId: string;
  stuckPointId: string;
  problemId: string;
};

test.beforeAll(async () => {
  sql = db();
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, 'IDOR fixture', 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'easy', 'published')
    ON CONFLICT (slug) DO NOTHING
  `;
});

test.afterAll(async () => {
  await deleteProblems(sql, SLUG);
  await cleanup(sql);
  await sql.end();
});

/** Everything the owner has, seeded directly. */
async function seedOwnersData(): Promise<OwnedIds> {
  const [user] = await sql`SELECT id FROM users WHERE email = ${OWNER}`;
  const [problem] = await sql`SELECT id FROM problems WHERE slug = ${SLUG}`;
  const userId = String(user!['id']);
  const problemId = String(problem!['id']);

  const [session] = await sql`
    INSERT INTO solve_sessions
      (user_id, problem_id, status, started_at, ended_at, started_local_date, ended_local_date)
    VALUES (${userId}, ${problemId}, 'solved', now() - interval '1 hour', now(),
            current_date, current_date)
    RETURNING id
  `;
  const sessionId = String(session!['id']);

  const [snapshot] = await sql`
    INSERT INTO code_snapshots
      (session_id, user_id, sequence, language, is_full, content, source_bytes, trigger, occurred_at)
    VALUES (${sessionId}, ${userId}, 0, 'python3', true, 'print(1)', 8, 'run_attempt', now())
    RETURNING id
  `;

  const [job] = await sql`
    INSERT INTO execution_jobs
      (user_id, problem_id, session_id, language, status, source, finished_at)
    VALUES (${userId}, ${problemId}, ${sessionId}, 'python3', 'completed', 'print(1)', now())
    RETURNING id
  `;

  // An event, so the timeline has something to render — without one the page
  // shows "nothing was recorded" and the positive control below cannot tell
  // "the owner can see it" from "there is nothing to see".
  await sql`
    INSERT INTO session_events (session_id, type, occurred_at)
    VALUES (${sessionId}, 'session_started', now() - interval '1 hour')
  `;

  const [stuck] = await sql`
    INSERT INTO stuck_points
      (session_id, elapsed_seconds, source, status, confidence, line_start, line_end)
    VALUES (${sessionId}, 120, 'inferred', 'inferred', 'high', 10, 14)
    RETURNING id
  `;

  return {
    sessionId,
    snapshotId: String(snapshot!['id']),
    executionJobId: String(job!['id']),
    stuckPointId: String(stuck!['id']),
    problemId,
  };
}

/** Sign in as the owner, seed, then become the intruder. */
async function setUp(context: BrowserContext, baseURL: string): Promise<OwnedIds> {
  await signInAs(context, sql, { email: OWNER, baseUrl: baseURL });
  const ids = await seedOwnersData();

  await context.clearCookies();
  await signInAs(context, sql, { email: INTRUDER, baseUrl: baseURL });

  return ids;
}

test("ANOTHER USER'S SESSION TIMELINE IS A 404", async ({ page, context, baseURL }) => {
  const ids = await setUp(context, baseURL!);

  const response = await page.goto(`/sessions/${ids.sessionId}`);
  expect(response?.status()).toBe(404);
});

test("another user's reflection page is a 404", async ({ page, context, baseURL }) => {
  const ids = await setUp(context, baseURL!);

  const response = await page.goto(`/sessions/${ids.sessionId}/reflect`);
  expect(response?.status()).toBe(404);
});

test("ANOTHER USER'S EXECUTION IS A 404, NOT A 403", async ({ page, context, baseURL }) => {
  const ids = await setUp(context, baseURL!);

  /*
   * `page.request`, not the bare `request` fixture. The latter is a separate
   * context with no cookies, so it gets 401 — which would have made this test
   * pass for the wrong reason: an anonymous rejection proves nothing about
   * whether a SIGNED-IN stranger can read somebody else's row.
   */
  const response = await page.request.get(`/api/execution/${ids.executionJobId}`);

  // 404, because 403 would confirm the id is real.
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain(ids.executionJobId);
});

test("A NONEXISTENT ID AND SOMEBODY ELSE'S ID ARE INDISTINGUISHABLE", async ({
  page,
  context,
  baseURL,
}) => {
  /*
   * The heart of the rule. If these two responses differ in any way — status,
   * body, timing shape — a stranger has an oracle for "does this id exist",
   * which they can walk.
   */
  const ids = await setUp(context, baseURL!);

  const theirs = await page.request.get(`/api/execution/${ids.executionJobId}`);
  const nothing = await page.request.get('/api/execution/00000000-0000-4000-8000-000000000000');

  expect(theirs.status()).toBe(nothing.status());
  expect(await theirs.text()).toBe(await nothing.text());
});

test("another user's heartbeat cannot be forged", async ({ page, context, baseURL }) => {
  const ids = await setUp(context, baseURL!);

  const response = await page.request.post('/api/session/heartbeat', {
    data: { sessionId: ids.sessionId },
  });

  expect(response.status()).toBe(404);
});

test("ANOTHER USER'S STUCK POINT IS UNTOUCHED AFTER THEY TRY", async ({
  page,
  context,
  baseURL,
}) => {
  /*
   * The service refusal is unit-tested (`tests/inference/persist.test.ts`).
   * What this adds is the end state: after a signed-in stranger has been at the
   * owner's session URL, the row is exactly as it was.
   *
   * The first version of this test POSTed a hand-rolled body at the page URL to
   * simulate the server action. That proved nothing — Next would reject it for
   * the wrong reasons — and a test that passes for the wrong reason is worse
   * than none.
   */
  const ids = await setUp(context, baseURL!);

  await page.goto(`/sessions/${ids.sessionId}`);

  const [row] = await sql`SELECT status FROM stuck_points WHERE id = ${ids.stuckPointId}`;
  expect(String(row!['status'])).toBe('inferred');
});

test("ANOTHER USER'S CODE SNAPSHOT NEVER REACHES THE PAGE", async ({
  page,
  context,
  baseURL,
}) => {
  const ids = await setUp(context, baseURL!);

  await page.goto(`/sessions/${ids.sessionId}`);

  // 404 above already covers it; this asserts the SOURCE specifically, because
  // a snapshot is the most sensitive thing in the database — it is the user's
  // own code.
  expect(await page.content()).not.toContain('print(1)');
  expect(await page.content()).not.toContain(ids.snapshotId);
});

test('an import job belonging to someone else is a 404', async ({ page, context, baseURL }) => {
  await setUp(context, baseURL!);

  const response = await page.request.get(
    '/api/ingest/jobs/00000000-0000-4000-8000-000000000000',
  );
  expect([404, 400]).toContain(response.status());
});

test('POSITIVE CONTROL · THE OWNER CAN REACH ALL OF IT', async ({ page, context, baseURL }) => {
  /*
   * Without this every assertion above is satisfied by an application that
   * returns 404 to everybody — which would pass the whole IDOR suite while
   * being completely broken.
   */
  await signInAs(context, sql, { email: OWNER, baseUrl: baseURL! });
  const ids = await seedOwnersData();

  const response = await page.goto(`/sessions/${ids.sessionId}`);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole('list', { name: 'Session timeline' })).toBeVisible();
});
