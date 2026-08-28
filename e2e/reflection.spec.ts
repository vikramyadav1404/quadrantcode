/**
 * F1.5 · stuck markers and the reflection, in a browser.
 *
 * Two claims can only be checked here, because both are about what happens
 * between pages: finishing a session **takes** the user to the reflection (the
 * nudge), and skipping it leaves nothing behind (the skip). A service test can
 * assert the rows; only a browser can assert the journey.
 *
 * **Every query below is scoped to this spec's user.** The browser suite shares
 * a database with the unit suite, which truncates at the START of each test and
 * therefore leaves its last test's rows behind. An unscoped
 * `SELECT ... FROM stuck_points` read one of those and reported a category this
 * spec never chose — a failure that looked like a bug in the dialog.
 */
import { type Page, expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'reflect@e2e.test';

/** This user's rows only. */
const ownSessions = () =>
  sql`SELECT s.* FROM solve_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE u.email = ${EMAIL}
      ORDER BY s.started_at DESC`;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await sql`DELETE FROM problems WHERE slug LIKE 'reflect-%'`;
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES ('reflect-alpha', 'Reflect Alpha', 'external_link', 'leetcode',
            'https://leetcode.com/problems/reflect-alpha/', 'easy', 'published')
  `;

  await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });
});

/** Start a session on the fixture problem and wait for the bar. */
async function startSolving(page: Page) {
  await page.goto('/problems/reflect-alpha');
  await page.getByRole('button', { name: /start solving/i }).click();
  await expect(page.getByRole('region', { name: /solve session timer/i })).toBeVisible();
}

test('a stuck marker is captured from the timer bar', async ({ page }) => {
  await startSolving(page);

  await page.getByRole('button', { name: /i'm stuck/i }).click();

  const dialog = page.getByRole('dialog', { name: /mark where you are stuck/i });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/category/i).selectOption('edge_cases');
  await dialog.getByLabel(/note/i).fill('Empty input blows up.');
  await dialog.getByRole('button', { name: /mark it/i }).click();

  await expect(dialog).toBeHidden();

  const [row] = await sql`
    SELECT p.category, p.note, p.elapsed_seconds, p.source
    FROM stuck_points p
    JOIN solve_sessions s ON s.id = p.session_id
    JOIN users u ON u.id = s.user_id
    WHERE u.email = ${EMAIL}
  `;
  expect(String(row!.category)).toBe('edge_cases');
  expect(String(row!.note)).toContain('Empty input');
  expect(String(row!.source)).toBe('user');
  // The server computed it: seconds since the session started, not a number
  // the browser sent.
  expect(Number(row!.elapsed_seconds)).toBeLessThan(120);
});

test('FINISHING TAKES THE USER TO THE REFLECTION', async ({ page }) => {
  // The nudge, as the ticket describes it: shown on completion, not offered
  // somewhere the user has to find.
  await startSolving(page);
  await page.getByRole('button', { name: /^solved$/i }).click();

  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/reflect/);
  await expect(page.getByRole('heading', { name: /how did reflect alpha go/i })).toBeVisible();
});

test('SKIPPING LEAVES NO ROW AND THE SESSION STILL COUNTS', async ({ page }) => {
  await startSolving(page);
  await page.getByRole('button', { name: /^solved$/i }).click();
  await expect(page).toHaveURL(/\/reflect/);

  await page.getByRole('button', { name: /skip for now/i }).click();

  await expect(page).toHaveURL(/\/problems\/reflect-alpha/);

  const reflectionRows = await sql`
    SELECT r.id FROM reflections r
    JOIN solve_sessions s ON s.id = r.session_id
    JOIN users u ON u.id = s.user_id
    WHERE u.email = ${EMAIL}
  `;
  expect(reflectionRows).toHaveLength(0);

  const [session] = await ownSessions();
  expect(String(session!.status)).toBe('solved');

  // Skipping the reflection does not un-count the solve.
  const [day] = await sql`
    SELECT d.solved_count FROM daily_sessions d
    JOIN users u ON u.id = d.user_id
    WHERE u.email = ${EMAIL}
  `;
  expect(Number(day!.solved_count)).toBe(1);
});

test('a saved reflection appears on the problem page', async ({ page }) => {
  await startSolving(page);
  await page.getByRole('button', { name: /^solved$/i }).click();
  await expect(page).toHaveURL(/\/reflect/);

  await page.getByLabel(/how did you approach it/i).fill('Two pointers after sorting.');
  await page.getByRole('checkbox', { name: /off by one/i }).check();
  await page.getByLabel(/time complexity you achieved/i).fill('O(n log n)');
  await page.getByLabel(/how confident are you/i).selectOption('high');

  await page.getByRole('button', { name: /save reflection/i }).click();

  await expect(page).toHaveURL(/\/problems\/reflect-alpha/);

  // The panel a returning user reads first.
  const panel = page.getByRole('region').filter({ hasText: /your last attempt/i });
  await expect(page.getByText(/your last attempt/i)).toBeVisible();
  await expect(page.getByText(/two pointers after sorting/i)).toBeVisible();
  await expect(page.getByText(/off by one/i).first()).toBeVisible();
  await expect(panel.or(page.getByText(/attempt 1/i)).first()).toBeVisible();

  const rows = await sql`
    SELECT m.category FROM reflection_mistakes m
    JOIN reflections r ON r.id = m.reflection_id
    JOIN solve_sessions s ON s.id = r.session_id
    JOIN users u ON u.id = s.user_id
    WHERE u.email = ${EMAIL} AND m.category = 'off_by_one'
  `;
  expect(rows).toHaveLength(1);
});

test("another user's reflection page is a 404, not a 403", async ({
  page,
  context,
  baseURL,
}) => {
  // Confirming the id exists is information the requester has no claim to —
  // the IDOR rule F4.8 makes explicit.
  await startSolving(page);
  await page.getByRole('button', { name: /^solved$/i }).click();
  await expect(page.getByRole('heading', { name: /how did reflect alpha go/i })).toBeVisible();

  /*
   * The id comes from the database, not from `page.url()`.
   *
   * Reading the URL raced: the assertion that we had reached /reflect passed,
   * and by the time `page.url()` was evaluated the app had moved on, so the
   * test navigated to the problem page and reported its 200 as a missing 404.
   * The session id is the thing being tested; taking it from the row removes
   * the browser's timing from the question entirely.
   */
  const [session] = await ownSessions();
  const url = `${baseURL}/sessions/${String(session!.id)}/reflect`;

  await signInAs(context, sql, { email: 'intruder@e2e.test', baseUrl: baseURL! });
  const response = await page.goto(url);

  expect(response?.status()).toBe(404);
  await expect(page.getByText(/how did reflect alpha go/i)).toBeHidden();
});
