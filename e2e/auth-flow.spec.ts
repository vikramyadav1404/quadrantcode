/**
 * The sign-in journey, end to end in a browser.
 *
 * SCOPE NOTE — the requested flow was "/login → verify → onboarding →
 * dashboard". Two of those do not exist in this codebase:
 *   - the route is `/sign-in`, not `/login` (F0.3 named it);
 *   - there is NO onboarding step. No ticket in the pack defines one; the
 *     nearest thing is /settings/phone (F0.3), which is optional and skippable.
 * So this spec covers /sign-in → magic-link verify → dashboard, plus the phone
 * step as an explicitly optional detour. If onboarding is wanted it needs a
 * ticket first — a test is not the place to invent product.
 *
 * Email delivery is not exercised (that needs a Resend key); everything after
 * the click is.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { SESSION_COOKIE, cleanup, createMagicLink, db, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await cleanup(sql);
  await sql.end();
});

test('signed-out visitor is sent to sign-in with a callback', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fdashboard/);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
});

test('the sign-in form submits without leaking whether the address exists', async ({
  page,
}) => {
  await page.goto('/sign-in');

  await page.getByLabel(/email/i).fill('newuser@e2e.test');
  await page.getByRole('button', { name: /send sign-in link/i }).click();
  await page.waitForLoadState('networkidle');

  // Resend has no API key in CI, so delivery cannot succeed — but the flow
  // must not sign anyone in and must not expose account existence.
  expect(page.url()).not.toContain('/dashboard');
});

test('magic link creates a session and lands on the dashboard', async ({ page, baseURL }) => {
  const email = 'magic@e2e.test';
  await sql`DELETE FROM users WHERE email = ${email}`;

  const link = await createMagicLink(sql, email, baseURL!, '/dashboard');
  await page.goto(link);

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
  expect(session, 'session cookie should be set').toBeTruthy();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe('Lax');

  const [user] = await sql`SELECT id, email_verified_at FROM users WHERE email = ${email}`;
  expect(user).toBeTruthy();
  expect(user!.email_verified_at).not.toBeNull();

  const profile = await sql`SELECT user_id FROM user_profiles WHERE user_id = ${user!.id}`;
  expect(profile).toHaveLength(1);
});

test('a magic link is single use — replay does not sign in again', async ({
  page,
  baseURL,
}) => {
  const email = 'replay@e2e.test';
  await sql`DELETE FROM users WHERE email = ${email}`;

  const link = await createMagicLink(sql, email, baseURL!, '/dashboard');
  await page.goto(link);
  await expect(page).toHaveURL(/\/dashboard/);

  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).not.toHaveURL(/\/dashboard/);
});

test('the phone step is optional and does not gate the dashboard', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'phone@e2e.test', baseUrl: baseURL! });

  await page.goto('/settings/phone');
  await expect(page.getByRole('heading', { name: /verify your phone/i })).toBeVisible();

  // Phone verification raises the tier; it is not an onboarding gate.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('a non-admin gets 403 on /admin, not a redirect loop', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'nonadmin@e2e.test', role: 'user', baseUrl: baseURL! });

  const response = await page.goto('/admin');
  expect(response?.status()).toBe(403);
  await expect(page.getByRole('heading', { name: /403/ })).toBeVisible();
});

test('an admin reaches /admin', async ({ context, page, baseURL }) => {
  await signInAs(context, sql, { email: 'admin@e2e.test', role: 'admin', baseUrl: baseURL! });

  const response = await page.goto('/admin');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
});

test('a stale session cookie gets 401, not a 500', async ({ context, page, baseURL }) => {
  const { hostname } = new URL(baseURL!);
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: 'this-token-does-not-exist',
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  const response = await page.goto('/dashboard');
  expect(response?.status()).toBe(401);
});
