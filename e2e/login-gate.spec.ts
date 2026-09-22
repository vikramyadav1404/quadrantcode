/**
 * F0.3 · /login is gated on a valid session, and `?error=` is readable.
 *
 * The unit suite (`tests/auth/login-gate.test.ts`) proves the decision. This
 * file proves the two things a pure function cannot: that the redirect is a real
 * HTTP redirect, and that the error copy actually reaches the DOM. "Gets
 * redirected" is a claim about navigation, so it is asserted against a real
 * browser rather than against a returned object.
 *
 * ## Why this spec carries its own cleanup AND its own safety catch
 *
 * `helpers/auth.ts` scopes `cleanup()` to `%@e2e.test`, and the demo account is
 * not one of those — it is a FIXED, well-known address that also exists in
 * production. Seeding and deleting a fixed address is exactly the combination
 * worth being paranoid about: the same two statements pointed at Neon would
 * erase the real demo account and cascade into its sessions and `session_events`.
 *
 * So every statement here runs behind `assertLocalUrl`, which THROWS rather than
 * skipping. A skip is how you find out months later that the spec never ran; a
 * throw fails the job on the spot. The guard has its own tests below, because a
 * safety catch nobody has ever seen fire is indistinguishable from one that is
 * wired backwards.
 */
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import type postgres from 'postgres';
import { DEMO_EMAIL } from '../lib/auth/demo';
import { cleanup, db, signInAs } from './helpers/auth';

const NORMAL_EMAIL = 'login-gate@e2e.test';

/**
 * Hostnames a destructive statement is allowed to reach. CI's Postgres service
 * is published on `localhost:5432`; `npm run test:db:start` uses
 * `localhost:55432`. Anything else — Neon, Supabase, a private address on
 * somebody's network — is a refusal, not a warning.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/** Both are checked: the spec connects with one, the app under test uses the other. */
const GUARDED_VARS = ['TEST_DATABASE_URL', 'DATABASE_URL'] as const;

/**
 * The pure half of the guard, separated so the refusal itself is testable.
 * Throws unless `url` is a parsable connection string pointing at this machine.
 */
export function assertLocalUrl(name: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a parsable URL. Refusing to touch the database.`);
  }

  // `new URL` keeps IPv6 literals bracketed; compare the bare address.
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to seed or delete ${DEMO_EMAIL}: ${name} points at "${host}", which is not ` +
        `a local test database. Expected one of: ${[...LOCAL_HOSTS].join(', ')}. This spec ` +
        `deletes a fixed address that also exists in production.`,
    );
  }
}

/**
 * Refuses unless every configured database URL is local. Called before the
 * connection is opened and again inside every mutation, so adding a statement
 * to this file cannot quietly skip the check.
 */
function assertLocalDatabase(): void {
  const present = GUARDED_VARS.filter((name) => process.env[name]);
  if (present.length === 0) throw new Error('TEST_DATABASE_URL must be set for e2e tests.');

  for (const name of present) assertLocalUrl(name, process.env[name]!);
}

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  assertLocalDatabase();
  sql = db();
});

test.afterAll(async () => {
  await purgeDemoUser();
  await cleanup(sql);
  await sql.end();
});

/**
 * Deleting a user cascades into `auth_sessions` and then into the append-only
 * `session_events`, whose trigger refuses DELETE unless `quadrantcode.purging`
 * is set inside the transaction — the same reason `cleanup()` is shaped this
 * way (F3.2a, D25).
 */
async function purgeDemoUser(): Promise<void> {
  assertLocalDatabase();
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('quadrantcode.purging', 'on', true)`;
    await tx`DELETE FROM users WHERE email = ${DEMO_EMAIL}`;
  });
}

/** Every seed goes through here, so the guard cannot be forgotten at a call site. */
async function seedSession(
  context: BrowserContext,
  baseUrl: string,
  email: string,
): Promise<void> {
  assertLocalDatabase();
  await signInAs(context, sql, { email, baseUrl });
}

/**
 * The guard's own tests. Without these, `assertLocalUrl` could be inverted, or
 * its allowlist could quietly grow to include everything, and every other test
 * in this file would still pass.
 */
test.describe('F0.3 · the database safety catch', () => {
  const REMOTE = [
    'postgresql://u:p@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/db?sslmode=require',
    'postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres',
    'postgresql://u:p@10.0.0.5:5432/quadrantcode',
    'postgresql://u:p@quadrantcode.internal:5432/quadrantcode',
    'postgresql://u:p@localhost.evil.com:5432/quadrantcode',
  ];

  test('refuses every non-local database URL', () => {
    for (const url of REMOTE) {
      expect(() => assertLocalUrl('TEST_DATABASE_URL', url), url).toThrow(
        /not\s+a local test database/,
      );
    }
  });

  test('allows the URLs CI and local development actually use', () => {
    for (const url of [
      'postgresql://postgres:postgres@localhost:5432/quadrantcode_test',
      'postgresql://postgres:postgres@localhost:55432/quadrantcode_test',
      'postgresql://postgres:postgres@127.0.0.1:5432/quadrantcode_test',
      'postgres://postgres:postgres@[::1]:5432/quadrantcode_test',
    ]) {
      expect(() => assertLocalUrl('TEST_DATABASE_URL', url), url).not.toThrow();
    }
  });

  test('refuses a URL it cannot parse rather than assuming it is safe', () => {
    expect(() => assertLocalUrl('TEST_DATABASE_URL', 'not-a-url')).toThrow(/parsable/);
    expect(() => assertLocalUrl('TEST_DATABASE_URL', '')).toThrow(/parsable/);
  });

  test('the run that is happening right now is pointed somewhere local', () => {
    expect(() => assertLocalDatabase()).not.toThrow();
  });
});

test.describe('F0.3 · the /login session gate', () => {
  test('a signed-in user never sees the sign-in form', async ({ context, page, baseURL }) => {
    await seedSession(context, baseURL!, NORMAL_EMAIL);

    await page.goto('/login');

    await expect(page).toHaveURL(/\/dashboard(\?|$)/);
    await expect(page.getByRole('button', { name: /continue with github/i })).toHaveCount(0);
  });

  test('the demo account gets a notice instead of being redirected', async ({
    context,
    page,
    baseURL,
  }) => {
    await seedSession(context, baseURL!, DEMO_EMAIL);

    await page.goto('/login');

    // It stays on /login — the redirect branch must NOT have run.
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(
      page.getByRole('heading', { name: /signed in as the demo account/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign out and continue with github/i }),
    ).toBeVisible();

    // The sign-in form is gone, not merely covered.
    await expect(page.getByRole('button', { name: /^continue with github$/i })).toHaveCount(0);
  });
});

/**
 * The App Router injects a visually-hidden `<div role="alert">` route announcer
 * into EVERY page, so a bare `getByRole('alert')` always resolves to at least
 * one element and "no banner is shown" would pass against a page that shows one.
 * The page's own banner is the one inside `<main>`.
 */
const banner = (page: Page) => page.locator('main').getByRole('alert');

test.describe('F0.3 · ?error= is readable on /login', () => {
  test('OAuthAccountNotLinked explains itself and offers the way out', async ({ page }) => {
    await page.goto('/login?error=OAuthAccountNotLinked');

    const alert = banner(page);
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/different quadrantcode user/i);
    await expect(alert).toContainText(/sign out/i);

    // The remedy is offered to an anonymous visitor too: the cookie can outlive
    // its auth_sessions row, and signing out is what clears it.
    await expect(
      page.getByRole('button', { name: /sign out and continue with github/i }),
    ).toBeVisible();
  });

  test('a known code that is not OAuthAccountNotLinked keeps the form', async ({ page }) => {
    await page.goto('/login?error=AccessDenied');

    await expect(banner(page)).toContainText(/declined/i);
    await expect(
      page.getByRole('button', { name: /sign out and continue with github/i }),
    ).toHaveCount(0);
    // Retrying IS the remedy here, so the providers stay.
    await expect(page.getByRole('button', { name: /^continue with github$/i })).toBeVisible();
  });

  test("an unknown code becomes our copy, never the caller's string", async ({ page }) => {
    const hostile = '<img src=x onerror=alert(1)>Account seized. Call 555-0100.';
    await page.goto(`/login?error=${encodeURIComponent(hostile)}`);

    await expect(banner(page)).toContainText(/something went wrong signing you in/i);

    // Neither rendered as markup nor escaped-but-present: absent entirely.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Account seized');
  });

  test('no ?error= means no banner', async ({ page }) => {
    await page.goto('/login');

    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^continue with github$/i })).toBeVisible();
  });
});
