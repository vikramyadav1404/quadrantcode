/**
 * F1.6 · the analytics page in a browser.
 *
 * Three things are only checkable here. That the page renders at all from a
 * cold rollup — nothing precomputed, the request path building it — that the
 * staleness line is actually on screen rather than merely available, and that
 * the wording rule holds in the RENDERED output.
 *
 * The last one matters because `tests/analytics/wording.test.ts` greps source.
 * Source is not what a user reads; this is.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'analytics@e2e.test';

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  /*
   * The catalog is shared by every spec in this suite, so a fixture problem
   * left behind is a row on /problems for everyone else. `e2e/keyboard.spec.ts`
   * tabs through that page with a budget and stopped reaching its own rows once
   * three specs had each left one — a failure that looked like a keyboard
   * regression and was leftover data.
   */
  await sql`DELETE FROM problems WHERE slug LIKE 'stats-%'`;
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await sql`DELETE FROM problems WHERE slug LIKE 'stats-%'`;
  await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });

  const [user] = await sql`SELECT id FROM users WHERE email = ${EMAIL}`;
  const userId = String(user!.id);

  /*
   * Four finished sessions across four days on one tagged problem, seeded
   * directly. The page has to build its own rollup from these on first load —
   * that is the request-path top-up doing its job with nothing precomputed.
   */
  const [problem] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status, estimated_minutes)
    VALUES ('stats-alpha', 'Stats Alpha', 'external_link', 'leetcode',
            'https://leetcode.com/problems/stats-alpha/', 'medium', 'published', 30)
    RETURNING id
  `;
  const problemId = String(problem!.id);

  await sql`
    INSERT INTO problem_tags (problem_id, tag_type, tag_value)
    VALUES (${problemId}, 'topic', 'graphs')
  `;

  for (const [offset, status] of [
    [1, 'solved'],
    [2, 'solved'],
    [3, 'stuck'],
    [5, 'solved'],
  ] as const) {
    await sql`
      INSERT INTO solve_sessions
        (user_id, problem_id, status, started_at, last_heartbeat_at, ended_at,
         started_local_date, ended_local_date, confidence)
      VALUES (
        ${userId}, ${problemId}, ${status},
        now() - (${offset} || ' days')::interval,
        now() - (${offset} || ' days')::interval + interval '25 minutes',
        now() - (${offset} || ' days')::interval + interval '25 minutes',
        (now() - (${offset} || ' days')::interval)::date,
        (now() - (${offset} || ' days')::interval)::date,
        'medium'
      )
    `;
  }
});

test('builds its own rollup on first load and shows real numbers', async ({ page }) => {
  await page.goto('/analytics');

  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

  // Three solves out of four sittings, from data that had never been rolled up.
  await expect(page.getByText('Solved this week')).toBeVisible();
  await expect(page.getByRole('table')).toContainText('graphs');
  await expect(page.getByRole('table')).toContainText('1 of 4');
});

test('STATES WHEN THE FIGURES WERE COMPUTED', async ({ page }) => {
  /*
   * The ticket's performance rule: precomputed numbers must not be shown as
   * though they were live. The line is on the page, not merely available.
   */
  await page.goto('/analytics');

  await expect(page.getByText(/figures as of/i)).toBeVisible();
});

test('EVERY WEAK-TOPIC ROW CARRIES ITS REASON', async ({ page }) => {
  // The acceptance criterion, read off the rendered page rather than the
  // service return value.
  await page.goto('/analytics');

  const panel = page.locator('section').filter({ hasText: 'Worth attention next' });
  await expect(panel).toBeVisible();

  // Three finished sessions is the minimum to be ranked, and this topic has four.
  await expect(panel).toContainText('graphs');
  await expect(panel).toContainText(/attempts ended stuck|not practised|estimated time/);
});

test('THE RENDERED PAGE NEVER CALLS THIS AI OR A PREDICTION', async ({ page }) => {
  /*
   * The source guard cannot see this: a component could import a phrase, build
   * it from fragments, or take it from the database. What the user reads is the
   * thing the rule is about.
   */
  await page.goto('/analytics');

  const text = await page.locator('main').innerText();

  expect(text).not.toMatch(/\bAI\b/);
  expect(text).not.toMatch(/artificial intelligence/i);
  expect(text).not.toMatch(/\bpredict(s|ed|ing|ion|ive)?\b/i);
  expect(text).not.toMatch(/\bforecast/i);

  // The positive control: proving those words are absent means nothing unless
  // the page had words at all.
  expect(text.length).toBeGreaterThan(200);
  expect(text).toContain('graphs');
});

test('the dashboard shows the same figures, and no invented ones', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByText('Solved in total')).toBeVisible();
  await expect(page.getByText(/figures as of/i)).toBeVisible();

  /*
   * "Due for revision" belongs to F2.1 and does not exist yet. A card showing 0
   * would be a claim that nothing is due, which is a different statement from
   * "this has not been built".
   */
  await expect(page.getByText(/due for revision/i)).toBeHidden();
});
