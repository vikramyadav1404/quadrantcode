/**
 * F0.3b · signing in with a phone number, in a real browser.
 *
 * ## Why the code's secret is swapped rather than read from a log
 *
 * MSG91 is blocked, so the console provider writes the code to the server's
 * stdout, which a browser test has no honest way to read. The database stores
 * only an HMAC of it.
 *
 * So this borrows the trick `helpers/auth.ts` uses for magic links — a value
 * hashed under the known secret — and applies it to the code the app has
 * ALREADY issued. The request really ran: the row was written, the hourly quota
 * consumed, the provider called. Only the six digits are made knowable.
 *
 * Everything after delivery is therefore the real path — lookup, constant-time
 * compare, attempt counting, consumption, session row, cookie, redirect. The
 * one thing not exercised is the SMS, which is the part that is blocked.
 *
 * The alternative — a test-only bypass in the verify route — was rejected for
 * the reason recorded in that helper: it would mean the path under test is not
 * the path that ships.
 */
import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { SESSION_COOKIE, cleanup, db } from './helpers/auth';

const AUTH_SECRET = process.env.AUTH_SECRET ?? 'e2e-test-secret-not-for-production';

const EMAIL = 'phone-signin@e2e.test';
const PHONE = '+919876500011';
/** A number no user has. Used to prove the response does not distinguish. */
const UNKNOWN_PHONE = '+919876500099';
const CODE = '424242';

let sql: ReturnType<typeof postgres>;

/** `server/services/auth/otp.ts` · hashOtpCode. */
function hashOtpCode(code: string): string {
  return createHmac('sha256', AUTH_SECRET).update(code).digest('hex');
}

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await cleanup(sql);
  await sql.end();
});

/** A user with a VERIFIED phone — the only kind that can sign in this way. */
async function seedUserWithVerifiedPhone(): Promise<string> {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('quadrantcode.purging', 'on', true)`;
    await tx`DELETE FROM users WHERE email = ${EMAIL}`;
  });

  const [user] = await sql`
    INSERT INTO users (email, phone_number, phone_verified_at, email_verified_at, verification_level)
    VALUES (${EMAIL}, ${PHONE}, now(), now(), 1)
    RETURNING id
  `;
  await sql`
    INSERT INTO user_profiles (user_id, display_name)
    VALUES (${user!.id}, 'Phone Tester')
    ON CONFLICT DO NOTHING
  `;
  return String(user!.id);
}

/** An outstanding code for that user, exactly as `requestPhoneOtp` writes one. */
async function plantCode(userId: string, code = CODE): Promise<void> {
  await sql`
    INSERT INTO verification_methods (user_id, method, identifier, code_hash, expires_at)
    VALUES (${userId}, 'phone', ${PHONE}, ${hashOtpCode(code)}, now() + interval '10 minutes')
  `;
}

/**
 * Swap the secret of the code the app JUST issued, leaving everything else.
 *
 * Better than planting a row ahead of time, which is what this test did first
 * and why it failed: clicking "Send code" runs the real `requestPhoneOtp`,
 * which writes a NEW row, and verification takes the newest outstanding code —
 * so the planted one was already superseded by the time it was typed.
 *
 * Overwriting after the fact means the real request path ran in full (row
 * written, hourly quota consumed, provider called) and only the one thing a
 * browser cannot know — the six digits that went to stdout — is made knowable.
 */
async function useKnownCodeForLatest(userId: string, code = CODE): Promise<void> {
  const updated = await sql`
    UPDATE verification_methods
       SET code_hash = ${hashOtpCode(code)}
     WHERE id = (
       SELECT id FROM verification_methods
        WHERE user_id = ${userId} AND method = 'phone' AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
     )
    RETURNING id
  `;

  // A silent no-op here would make the sign-in test fail for the wrong reason.
  expect(updated, 'the app should have issued a code to overwrite').toHaveLength(1);
}

test('the login page offers email and phone, and the tabs switch', async ({ page }) => {
  await page.goto('/login');

  const tabs = page.getByRole('tablist', { name: 'Sign-in method' });
  await expect(tabs.getByRole('tab', { name: 'Email' })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Phone' })).toBeVisible();

  // Email is the default, and it is the form that was there before this ticket.
  await expect(page.getByLabel('Email address')).toBeVisible();

  await tabs.getByRole('tab', { name: 'Phone' }).click();
  await expect(page.getByLabel('Phone number')).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveCount(0);
});

test('the tablist is one tab stop, and arrow keys move within it', async ({ page }) => {
  await page.goto('/login');

  await page.getByRole('tab', { name: 'Email' }).focus();
  await page.keyboard.press('ArrowRight');

  await expect(page.getByRole('tab', { name: 'Phone' })).toBeFocused();
  await expect(page.getByLabel('Phone number')).toBeVisible();

  // And back, so the set is not a one-way trip.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Email' })).toBeFocused();
});

test('GitHub stays visible but disabled when it is not configured', async ({ page }) => {
  await page.goto('/login');

  /*
   * There is no GITHUB_ID in the test environment. The option remains visible,
   * but it cannot redirect to a broken OAuth screen.
   *
   * POSITIVE CONTROL below: the page rendered its other controls too, so this
   * is the real login panel rather than an isolated disabled button.
   */
  const githubButton = page.getByRole('button', { name: /continue with github/i });
  await expect(githubButton).toBeVisible();
  await expect(githubButton).toBeDisabled();
  await expect(githubButton).toHaveAccessibleDescription(
    'GitHub sign-in will activate after OAuth is configured.',
  );
  await expect(
    page.getByText(/github sign-in will activate after oauth is configured/i),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Phone' })).toBeVisible();
});

test('a correct code signs the user in and lands them in the app', async ({
  page,
  context,
}) => {
  const userId = await seedUserWithVerifiedPhone();

  await page.goto('/login');
  await page.getByRole('tab', { name: 'Phone' }).click();
  await page.getByLabel('Phone number').fill(PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();

  // The app has now really issued a code. Make its six digits knowable.
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  await useKnownCodeForLatest(userId);

  await page.getByLabel('Six-digit code').fill(CODE);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
    timeout: 15_000,
  });

  /*
   * And it is a REAL session: the cookie the rest of the app reads, backed by a
   * row that can be revoked. A token with no row would still get the user in
   * and could never be taken away.
   */
  const cookie = (await context.cookies()).find((entry) => entry.name === SESSION_COOKIE);
  expect(cookie, 'the session cookie Auth.js reads').toBeTruthy();

  const rows = await sql`
    SELECT user_id FROM auth_sessions WHERE session_token = ${cookie!.value}
  `;
  expect(rows[0]?.user_id).toBe(userId);
});

test('the request step answers a registered and an unregistered number alike', async ({
  page,
}) => {
  await seedUserWithVerifiedPhone();
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Phone' }).click();

  async function messageFor(phoneNumber: string): Promise<string> {
    return page.evaluate(async (number) => {
      const response = await fetch('/api/auth/phone/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: number }),
      });
      return `${response.status} ${await response.text()}`;
    }, phoneNumber);
  }

  /*
   * Status AND body, compared as strings. Over real HTTP, because that is the
   * layer the claim is about — the service-level version of this lives in
   * `tests/auth/phone-signin.test.ts`, and neither replaces the other.
   */
  expect(await messageFor(PHONE)).toBe(await messageFor(UNKNOWN_PHONE));
});

test('a wrong code does not sign anybody in', async ({ page, context }) => {
  const userId = await seedUserWithVerifiedPhone();
  await plantCode(userId);

  await page.goto('/login');
  await page.getByRole('tab', { name: 'Phone' }).click();
  await page.getByLabel('Phone number').fill(PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();

  await page.getByLabel('Six-digit code').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText(/that code is not valid/i)).toBeVisible();

  // Still on /login, and holding nothing.
  expect(new URL(page.url()).pathname).toBe('/login');
  expect((await context.cookies()).some((entry) => entry.name === SESSION_COOKIE)).toBe(false);
});

test('an unverified number cannot sign in, even with a valid code', async ({ page }) => {
  /*
   * Someone can type a number they do not own into their settings and never
   * confirm it. If that were enough, this flow would be a way to take an
   * account over by claiming a number.
   */
  const userId = await seedUserWithVerifiedPhone();
  await plantCode(userId);
  await sql`UPDATE users SET phone_verified_at = NULL WHERE id = ${userId}`;

  await page.goto('/login');
  await page.getByRole('tab', { name: 'Phone' }).click();
  await page.getByLabel('Phone number').fill(PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Six-digit code').fill(CODE);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText(/that code is not valid/i)).toBeVisible();
});
