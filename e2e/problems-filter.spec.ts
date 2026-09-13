/**
 * F1.1 · the catalog filter form, submitted the way a person submits it.
 *
 * `tests/problems/filters.test.ts` proves the schema accepts what a GET form
 * sends. This proves the page survives the round trip — which is a different
 * claim, and the one that was false in production.
 *
 * The bug it guards: `<option value="">Any difficulty</option>` means a
 * submission carries `?search=&difficulty=`, the empty strings threw a
 * ZodError, and the page rendered the root error boundary. **It never showed as
 * a 500** — the throw landed after Next began streaming, so the response was
 * committed 200 with a broken panel inside it.
 *
 * That is why `expect(response.status()).toBe(200)` would have passed happily
 * through the whole outage. These tests assert on what is ON SCREEN instead.
 */
import { type Page, expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'filters@e2e.test';

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  // Shared catalog: a fixture left behind is a row on /problems for every other
  // spec, and keyboard.spec.ts counts tab stops.
  await deleteProblems(sql, 'filt-%');
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await deleteProblems(sql, 'filt-%');
  await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });

  // One easy and one hard, so a difficulty filter has something to include and
  // something to exclude. A filter test against one row proves nothing.
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status, estimated_minutes)
    VALUES
      ('filt-easy-one', 'Filter Easy One', 'external_link', 'leetcode',
       'https://leetcode.com/problems/filt-easy-one/', 'easy', 'published', 20),
      ('filt-hard-one', 'Filter Hard One', 'external_link', 'leetcode',
       'https://leetcode.com/problems/filt-hard-one/', 'hard', 'published', 50)
  `;
});

/** The error boundary's copy, so a broken render is caught rather than guessed at. */
async function expectNoErrorBoundary(page: Page) {
  await expect(page.getByRole('heading', { name: 'Problems' })).toBeVisible();
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
}

test('APPLY WITH NOTHING SELECTED — the case that was broken', async ({ page }) => {
  await page.goto('/problems');
  await page.getByRole('button', { name: 'Apply' }).click();

  // `?search=&difficulty=` — both empty. This threw before the fix.
  await expect(page).toHaveURL(/difficulty=/);
  await expectNoErrorBoundary(page);
  await expect(page.getByRole('link', { name: 'Filter Easy One' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Filter Hard One' })).toBeVisible();
});

test('a difficulty alone, search left empty', async ({ page }) => {
  await page.goto('/problems');
  await page.getByLabel('Filter by difficulty').selectOption('easy');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expectNoErrorBoundary(page);
  await expect(page.getByRole('link', { name: 'Filter Easy One' })).toBeVisible();
  // The filter has to actually filter, not merely avoid throwing.
  await expect(page.getByRole('link', { name: 'Filter Hard One' })).toHaveCount(0);
});

test('a search alone, difficulty left on Any', async ({ page }) => {
  await page.goto('/problems');
  await page.getByLabel('Search problems by title').fill('Filter Hard');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expectNoErrorBoundary(page);
  await expect(page.getByRole('link', { name: 'Filter Hard One' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Filter Easy One' })).toHaveCount(0);
});

test('both together', async ({ page }) => {
  await page.goto('/problems');
  await page.getByLabel('Search problems by title').fill('Filter');
  await page.getByLabel('Filter by difficulty').selectOption('hard');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expectNoErrorBoundary(page);
  await expect(page.getByRole('link', { name: 'Filter Hard One' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Filter Easy One' })).toHaveCount(0);
});

test('a whitespace-only search behaves as no search', async ({ page }) => {
  await page.goto('/problems');
  await page.getByLabel('Search problems by title').fill('   ');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expectNoErrorBoundary(page);
  await expect(page.getByRole('link', { name: 'Filter Easy One' })).toBeVisible();
});
