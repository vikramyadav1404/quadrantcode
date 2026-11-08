/**
 * The admin catalog import, end to end: choose a CSV, preview, import in
 * chunks, and the problems are in the PUBLIC catalog. A second upload adds
 * nothing, and a non-admin is refused by both the page and the API.
 *
 * Links are on an invented judge host, so nothing here depends on a real
 * platform's catalogue.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

// Imported slugs are `<path-as-kebab>-<random>`: `problems-e2e-catalog-…`.
const SLUGS = 'problems-e2e-catalog-%';

const FILE = {
  name: 'catalog.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(
    [
      'title,url,difficulty,topic,platform',
      'E2E Catalog Alpha,https://judge.example.com/problems/e2e-catalog-alpha,easy,"Binary Search",',
      'E2E Catalog Beta,https://judge.example.com/problems/e2e-catalog-beta,medium,arrays,',
      'E2E Catalog Broken,https://judge.example.com/problems/e2e-catalog-broken,trivial,,',
    ].join('\n'),
  ),
};

test.beforeAll(async () => {
  sql = db();
  await deleteProblems(sql, SLUGS);
});

test.afterAll(async () => {
  await deleteProblems(sql, SLUGS);
  await cleanup(sql);
  await sql.end();
});

test('AN ADMIN IMPORTS A CSV INTO THE PUBLIC CATALOG, AND A SECOND UPLOAD ADDS NOTHING', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, {
    email: 'catalog-admin@e2e.test',
    role: 'admin',
    baseUrl: baseURL!,
  });

  await page.goto('/admin/problems/import');
  await page.getByLabel('CSV file').setInputFiles(FILE);

  // The preview: two valid rows to add, one skipped with its reason.
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(page.getByText('new problems will be added and published')).toContainText('2');
  await expect(
    page.getByRole('cell', { name: 'Difficulty must be easy, medium or hard' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Import 2 problems' }).click();
  await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
  await expect(page.getByTestId('catalog-import-totals')).toContainText('2 added');

  const rows = await sql`
    SELECT status, platform FROM problems WHERE slug LIKE ${SLUGS} ORDER BY title
  `;
  expect(rows.map((row) => row.status)).toEqual(['published', 'published']);

  // Public catalog, as a signed-in user would search it.
  await page.goto('/problems?search=E2E%20Catalog');
  await expect(page.getByText('E2E Catalog Alpha')).toBeVisible();
  await expect(page.getByText('E2E Catalog Beta')).toBeVisible();

  // The same file again: everything is already there.
  await page.goto('/admin/problems/import');
  await page.getByLabel('CSV file').setInputFiles(FILE);
  await expect(page.getByText('are already in the catalog')).toContainText('2');
  await page.getByRole('button', { name: 'Import 2 problems' }).click();
  await expect(page.getByTestId('catalog-import-totals')).toContainText('0 added');

  const [counted] =
    await sql`SELECT count(*)::int AS count FROM problems WHERE slug LIKE ${SLUGS}`;
  expect(counted!.count).toBe(2);
});

test('A NON-ADMIN IS REFUSED BY THE PAGE AND BY THE API', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'catalog-user@e2e.test', baseUrl: baseURL! });

  const response = await page.goto('/admin/problems/import');
  expect(response?.status()).toBe(403);

  const api = await page.request.post('/api/admin/catalog-import?preview=1', {
    multipart: { file: FILE },
  });
  expect(api.status()).toBe(403);
});
