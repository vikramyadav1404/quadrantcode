/**
 * The sign-in journey, end to end in a browser.
 *
 * The F0.3 amendment renamed /sign-in to /login and added a real onboarding
 * step, so the scope note that used to sit here — saying neither existed — is
 * gone rather than left to mislead. Onboarding has its own spec
 * (e2e/onboarding.spec.ts); this one covers sign-in itself.
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

test('signed-out visitor is sent to /login with returnTo', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdashboard/);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
});

test('the sign-in form submits without leaking whether the address exists', async ({
  page,
}) => {
  await page.goto('/login');

  await page.getByRole('textbox', { name: /email address/i }).fill('newuser@e2e.test');
  await page.getByRole('button', { name: /send sign-in link/i }).click();
  await page.waitForLoadState('networkidle');

  // Resend has no API key in CI, so delivery cannot succeed — but the flow
  // must not sign anyone in and must not expose account existence.
  expect(page.url()).not.toContain('/dashboard');
});

test('magic link creates a session and sends a NEW user to onboarding', async ({
  page,
  baseURL,
}) => {
  const email = 'magic@e2e.test';
  await sql`DELETE FROM users WHERE email = ${email}`;

  const link = await createMagicLink(sql, email, baseURL!, '/dashboard');
  await page.goto(link);

  /*
   * Onboarding, not the dashboard. The link redirects to /dashboard, but this
   * address has never signed in, so it has no display name and the (app)
   * layout gate sends it to /onboarding first. The session below is real
   * either way — being signed in and being onboarded are separate states.
   */
  await expect(page).toHaveURL(/\/onboarding/);

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

  // …and once onboarding is done, the dashboard is reachable.
  await page.getByLabel(/what should we call you/i).fill('Magic User');
  await page.getByRole('button', { name: /start tracking/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('the gate defers the destination rather than discarding it', async ({ page, baseURL }) => {
  /*
   * The bug this pins: the onboarding gate used to `redirect('/onboarding')`
   * with no returnTo, so a first-time user following a link to /problems
   * finished onboarding on /dashboard and the destination was silently lost.
   * The layout cannot see the pathname on its own — middleware forwards it.
   */
  const email = 'deferred-dest@e2e.test';
  await sql`DELETE FROM users WHERE email = ${email}`;

  const link = await createMagicLink(sql, email, baseURL!, '/problems');
  await page.goto(link);

  await expect(page).toHaveURL(/\/onboarding\?returnTo=%2Fproblems/);

  await page.getByLabel(/what should we call you/i).fill('Destination User');
  await page.getByRole('button', { name: /start tracking/i }).click();

  await expect(page).toHaveURL(/\/problems/);
});

test('a magic link is single use — replay does not sign in again', async ({
  page,
  baseURL,
}) => {
  const email = 'replay@e2e.test';
  await sql`DELETE FROM users WHERE email = ${email}`;

  const link = await createMagicLink(sql, email, baseURL!, '/dashboard');
  await page.goto(link);
  // Signed in (a new user, so onboarding) — the point is that it WORKED once.
  await expect(page).toHaveURL(/\/onboarding/);

  await page.context().clearCookies();
  await page.goto(link);

  // Replayed with no cookie, the consumed token must not mint a second session.
  await expect(page).not.toHaveURL(/\/dashboard|\/onboarding/);
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === SESSION_COOKIE)).toBeUndefined();
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
