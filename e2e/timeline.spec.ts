/**
 * F3.2b · the timeline and the privacy controls in a browser.
 *
 * Two of F3.2's criteria are only half-proved by a service test:
 *
 *   · "Snapshot capture toggle off produces zero snapshot rows" — the SERVICE
 *     declines when told capture is off. Whether the toggle a user can actually
 *     reach reaches that argument is a different claim, and this is where it
 *     gets settled.
 *   · "Delete my solve history leaves no snapshot or event rows" — same shape.
 *     The service is tested; the button is not, until here.
 *
 * Both assertions read the database directly after driving the UI, because the
 * criteria are about rows and a page saying "deleted" is not evidence that
 * anything was.
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'timeline@e2e.test';
const SLUG = 'tl-two-sum-style';

test.beforeAll(async () => {
  sql = db();
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, 'Timeline fixture', 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'easy', 'published')
    ON CONFLICT (slug) DO NOTHING
  `;
});

test.afterAll(async () => {
  // Fixture problems are shared with every other spec — F1.6's finding.
  await deleteProblems(sql, SLUG);
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });
});

async function userId(): Promise<string> {
  const [user] = await sql`SELECT id FROM users WHERE email = ${EMAIL}`;
  return String(user!.id);
}

async function snapshotCount(): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM code_snapshots WHERE user_id = ${await userId()}
  `;
  return Number(row!['n']);
}

async function eventCount(): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM session_events e
    JOIN solve_sessions s ON s.id = e.session_id
    WHERE s.user_id = ${await userId()}
  `;
  return Number(row!['n']);
}

/** Start a session on the fixture problem and run the editor once. */
async function solveAndRun(page: Page, source: string) {
  await page.goto(`/problems/${SLUG}`);
  await page.getByRole('button', { name: /start solving/i }).click();
  await expect(page.getByRole('button', { name: /pause/i })).toBeVisible();

  await page.goto(`/problems/${SLUG}/solve`);

  // Monaco is a canvas-backed editor; typing into it from Playwright is
  // brittle. The stdin field is a plain textarea and the run is what matters —
  // the source that gets submitted is the language starter plus this.
  await page.getByLabel('Input (stdin)').fill(source);
  await page.getByRole('button', { name: /^run$/i }).click();
  await expect(page.getByTestId('run-output-output')).toBeVisible({ timeout: 20_000 });
}

test('a run is recorded, and the timeline shows it', async ({ page }) => {
  await solveAndRun(page, 'hello');

  const [session] = await sql`
    SELECT id FROM solve_sessions WHERE user_id = ${await userId()} ORDER BY started_at DESC LIMIT 1
  `;

  await page.goto(`/sessions/${String(session!['id'])}`);

  const timeline = page.getByRole('list', { name: 'Session timeline' });
  await expect(timeline).toBeVisible();
  await expect(timeline.getByText('Started')).toBeVisible();
  await expect(timeline.getByText('Ran the code')).toBeVisible();

  // Elapsed reads as mm:ss, derived rather than stored (D25).
  await expect(timeline.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible();
});

test('the saved code is shown, and it is text rather than markup', async ({ page }) => {
  await solveAndRun(page, 'hello');

  const [session] = await sql`
    SELECT id FROM solve_sessions WHERE user_id = ${await userId()} ORDER BY started_at DESC LIMIT 1
  `;
  await page.goto(`/sessions/${String(session!['id'])}`);

  await page
    .getByRole('button', { name: /show code/i })
    .first()
    .click();

  const source = page.getByTestId('timeline-source').first();
  await expect(source).toBeVisible();

  // The user's own source is untrusted bytes here exactly as program output is.
  expect(await source.locator('script').count()).toBe(0);
});

test('TURNING CAPTURE OFF PRODUCES ZERO SNAPSHOT ROWS', async ({ page }) => {
  await page.goto('/settings/privacy');

  const toggle = page.getByLabel(/save snapshots of my code/i);
  await expect(toggle).toBeChecked(); // default ON, as decided

  await toggle.uncheck();
  await expect(page.getByText(/code capture is off/i)).toBeVisible();

  await solveAndRun(page, 'hello');

  // The criterion, read from the table rather than from the page.
  expect(await snapshotCount()).toBe(0);

  // And the run still happened — capture off is not the session going dark.
  expect(await eventCount()).toBeGreaterThan(0);
});

test('POSITIVE CONTROL · with capture on, the same run DOES write a snapshot', async ({
  page,
}) => {
  /*
   * Without this, the assertion above would pass if runs never wrote snapshots
   * at all — which is precisely the bug that shipped for one commit while the
   * `code_snapshot` event was missing.
   */
  await page.goto('/settings/privacy');
  await expect(page.getByLabel(/save snapshots of my code/i)).toBeChecked();

  await solveAndRun(page, 'hello');

  expect(await snapshotCount()).toBeGreaterThan(0);
});

test('DELETING SOLVE HISTORY LEAVES NO SNAPSHOT OR EVENT ROWS', async ({ page }) => {
  await solveAndRun(page, 'hello');

  expect(await snapshotCount()).toBeGreaterThan(0);
  expect(await eventCount()).toBeGreaterThan(0);

  await page.goto('/settings/privacy');
  await page.getByRole('button', { name: /^delete my solve history$/i }).click();
  await page.getByRole('button', { name: /delete permanently/i }).click();

  await expect(page.getByTestId('delete-result')).toBeVisible();

  expect(await snapshotCount()).toBe(0);
  expect(await eventCount()).toBe(0);
});

test('deleting the history keeps the session itself', async ({ page }) => {
  await solveAndRun(page, 'hello');

  await page.goto('/settings/privacy');
  await page.getByRole('button', { name: /^delete my solve history$/i }).click();
  await page.getByRole('button', { name: /delete permanently/i }).click();
  await expect(page.getByTestId('delete-result')).toBeVisible();

  // Removing sessions would silently rewrite the streak, the analytics and the
  // revision schedule — far more than "delete my solve history" asked for.
  const [row] = await sql`
    SELECT count(*)::int AS n FROM solve_sessions WHERE user_id = ${await userId()}
  `;
  expect(Number(row!['n'])).toBeGreaterThan(0);
});

test("another user's session is a 404, not a 403", async ({ page }) => {
  await solveAndRun(page, 'hello');

  const [session] = await sql`
    SELECT id FROM solve_sessions WHERE user_id = ${await userId()} ORDER BY started_at DESC LIMIT 1
  `;
  const id = String(session!['id']);

  await page.context().clearCookies();
  await signInAs(page.context(), sql, {
    email: 'timeline-intruder@e2e.test',
    baseUrl: 'http://localhost:3000',
  });

  const response = await page.goto(`/sessions/${id}`);

  // 404, because a 403 would confirm the id exists.
  expect(response?.status()).toBe(404);
});

test('the settings index links to every settings page', async ({ page }) => {
  // It was a 404 in the sidebar from F0.4 until this ticket.
  await page.goto('/settings');

  const list = page.getByRole('list', { name: 'Settings sections' });
  await expect(list.getByRole('link', { name: 'Privacy' })).toBeVisible();
  await expect(list.getByRole('link', { name: 'Profile' })).toBeVisible();
});

test('the navigation no longer offers a page that will never exist', async ({ page }) => {
  await page.goto('/dashboard');

  // F2.5 is cut, so /contests was a permanent 404 in the primary nav.
  await expect(page.getByRole('link', { name: 'Contests' })).toHaveCount(0);

  // POSITIVE CONTROL — the nav is rendered at all, so the absence above means
  // something. Without this the assertion passes on a page with no nav.
  await expect(page.getByRole('link', { name: 'Revision' }).first()).toBeVisible();
});
