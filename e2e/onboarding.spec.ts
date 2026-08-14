/**
 * F0.3 · the onboarding gate, tested by DIRECT NAVIGATION.
 *
 * Every case here types a URL rather than clicking through, because the UI
 * flow can be perfectly correct while the routes are wide open. A user who
 * bookmarks /dashboard, or who guesses /onboarding after finishing it, never
 * touches the happy path.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await cleanup(sql);
  await sql.end();
});

test('an INCOMPLETE user typing /dashboard lands on /onboarding', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, {
    email: 'incomplete@e2e.test',
    baseUrl: baseURL!,
    onboarded: false,
  });

  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: /welcome to traceloop/i })).toBeVisible();
});

test('an incomplete user cannot reach any app route by typing it', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, {
    email: 'incomplete2@e2e.test',
    baseUrl: baseURL!,
    onboarded: false,
  });

  /*
   * Only routes that EXIST. /analytics and /sessions have nav entries but no
   * page yet (F1.6, F1.4), and Next renders the root not-found for those
   * OUTSIDE the (app) layout — so the gate correctly does not apply, and
   * asserting otherwise tests the router rather than the gate.
   */
  for (const route of ['/dashboard', '/problems', '/settings/profile']) {
    await page.goto(route);
    await expect(page, `typing ${route} should redirect`).toHaveURL(/\/onboarding/);
  }
});

test('a COMPLETED user typing /onboarding is redirected away', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'complete@e2e.test', baseUrl: baseURL! });

  await page.goto('/onboarding');

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('a WHITESPACE-ONLY display name counts as incomplete', async ({
  context,
  page,
  baseURL,
}) => {
  /*
   * The database accepts '   ' — it is three characters, so the
   * `user_profiles_display_name_length` CHECK (2–40) is satisfied. Only
   * `isProfileComplete` trims. If the route gate used a different rule from
   * the predicate, this is the exact input where they would disagree, and the
   * user would bounce between /onboarding and /dashboard forever.
   */
  const userId = await signInAs(context, sql, {
    email: 'whitespace@e2e.test',
    baseUrl: baseURL!,
    onboarded: false,
  });
  await sql`UPDATE user_profiles SET display_name = '   ' WHERE user_id = ${userId}`;

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding/);

  // And it is not a loop: /onboarding renders rather than bouncing back.
  await expect(page.getByRole('heading', { name: /welcome to traceloop/i })).toBeVisible();
});

test('completing onboarding writes the profile and stops the redirect', async ({
  context,
  page,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, {
    email: 'completing@e2e.test',
    baseUrl: baseURL!,
    onboarded: false,
  });

  await page.goto('/onboarding');
  await page.getByLabel(/what should we call you/i).fill('Vikram Yadav');
  await page.getByLabel('Timezone').fill('Asia/Kolkata');
  await page.getByLabel('Preparing for').selectOption('sde_1');
  await page.getByRole('button', { name: /start tracking/i }).click();

  await expect(page).toHaveURL(/\/dashboard/);

  const [row] = await sql`
    SELECT display_name, target_role FROM user_profiles WHERE user_id = ${userId}
  `;
  expect(row!.display_name).toBe('Vikram Yadav');
  expect(row!.target_role).toBe('sde_1');

  // Typing the route again now redirects away.
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/dashboard/);
});

test('an anonymous visitor typing /onboarding is sent to /login', async ({ page }) => {
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/login/);
});

test('returnTo survives onboarding, and /admin is gated on role', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, {
    email: 'returnto@e2e.test',
    baseUrl: baseURL!,
    onboarded: false,
  });

  await page.goto('/onboarding?returnTo=%2Fanalytics');
  await page.getByLabel(/what should we call you/i).fill('Return Tester');
  await page.getByLabel('Timezone').fill('Asia/Kolkata');
  await page.getByRole('button', { name: /start tracking/i }).click();

  await expect(page).toHaveURL(/\/analytics/);
});

test('a non-admin finishing onboarding with returnTo=/admin lands on the dashboard', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, {
    email: 'nonadmin-return@e2e.test',
    baseUrl: baseURL!,
    role: 'user',
    onboarded: false,
  });

  await page.goto('/onboarding?returnTo=%2Fadmin');
  await page.getByLabel(/what should we call you/i).fill('Non Admin');
  await page.getByLabel('Timezone').fill('Asia/Kolkata');
  await page.getByRole('button', { name: /start tracking/i }).click();

  // Role-gated at redirect time: no 403 landing.
  await expect(page).toHaveURL(/\/dashboard/);
});

test('an admin finishing onboarding with returnTo=/admin lands on /admin', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, {
    email: 'admin-return@e2e.test',
    baseUrl: baseURL!,
    role: 'admin',
    onboarded: false,
  });

  await page.goto('/onboarding?returnTo=%2Fadmin');
  await page.getByLabel(/what should we call you/i).fill('Admin User');
  await page.getByLabel('Timezone').fill('Asia/Kolkata');
  await page.getByRole('button', { name: /start tracking/i }).click();

  await expect(page).toHaveURL(/\/admin/);
});

test('an open-redirect returnTo is discarded', async ({ context, page, baseURL }) => {
  await signInAs(context, sql, {
    email: 'evil-return@e2e.test',
    baseUrl: baseURL!,
    onboarded: false,
  });

  await page.goto('/onboarding?returnTo=https%3A%2F%2Fevil.com');
  await page.getByLabel(/what should we call you/i).fill('Safe User');
  await page.getByLabel('Timezone').fill('Asia/Kolkata');
  await page.getByRole('button', { name: /start tracking/i }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  expect(page.url()).not.toContain('evil.com');
});
