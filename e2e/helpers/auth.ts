/**
 * Auth helpers for browser tests.
 *
 * The magic-link flow is driven WITHOUT sending email. Auth.js stores
 * `sha256(token + secret)` in `auth_verification_tokens` and emails the raw
 * token, so a test can insert its own hashed token and then visit the callback
 * URL with the raw one. That exercises everything except Resend's delivery:
 * token lookup, single-use consumption, user creation, session row, cookie, and
 * the post-sign-in redirect.
 *
 * The alternative — a test-only provider branch in production config — was
 * rejected: it would mean the path under test is not the path that ships.
 */
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { BrowserContext, Page } from '@playwright/test';
import { assertNotProductionDatabase } from '../../lib/db/production-guard';

const AUTH_SECRET = process.env.AUTH_SECRET ?? 'e2e-test-secret-not-for-production';

/** Production uses the __Secure- prefix; `next start` sets NODE_ENV=production. */
export const SESSION_COOKIE = '__Secure-quadrantcode.session';

export function db() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set for e2e tests.');
  // Fixtures insert and delete rows; never against production (#27).
  assertNotProductionDatabase(url, 'TEST_DATABASE_URL (e2e/helpers/auth.ts)');
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Auth.js v5 email-provider token hashing: sha256(token + secret). */
export function hashToken(token: string): string {
  return createHash('sha256').update(`${token}${AUTH_SECRET}`).digest('hex');
}

/**
 * Prepares a magic link for `email` and returns the URL to visit.
 * The raw token is never stored, exactly as in production.
 */
export async function createMagicLink(
  sql: ReturnType<typeof postgres>,
  email: string,
  baseUrl: string,
  callbackUrl = '/dashboard',
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 15 * 60 * 1000);

  await sql`
    INSERT INTO auth_verification_tokens (identifier, token, expires)
    VALUES (${email.toLowerCase()}, ${hashToken(token)}, ${expires})
  `;

  /*
   * RELATIVE callbackUrl. An absolute one must match Auth.js's resolved origin
   * exactly; `http://127.0.0.1:3210` against a server that resolves itself as
   * `http://localhost:3210` is treated as an untrusted cross-origin redirect
   * and silently downgraded to the site root — which looked like "sign-in
   * failed" when sign-in had actually succeeded.
   */
  const params = new URLSearchParams({
    token,
    email: email.toLowerCase(),
    callbackUrl,
  });

  return `${baseUrl}/api/auth/callback/resend?${params.toString()}`;
}

/**
 * Creates a user and a session row, then sets the cookie on the context.
 * Used by specs whose subject is not sign-in itself.
 */
export async function signInAs(
  context: BrowserContext,
  sql: ReturnType<typeof postgres>,
  options: {
    email: string;
    role?: 'user' | 'admin';
    baseUrl: string;
    /**
     * Whether the user has finished onboarding. Defaults to true, because the
     * (app) layout now redirects an incomplete profile to /onboarding — so a
     * spec about anything ELSE would otherwise be testing the onboarding gate
     * by accident. Pass false when the gate IS the subject.
     */
    onboarded?: boolean;
  },
): Promise<string> {
  const { email, role = 'user', baseUrl, onboarded = true } = options;

  /*
   * Recreating the user cascades into their sessions and then into the
   * append-only `session_events` (F3.2a), so this delete needs the same
   * declared-erasure transaction that `cleanup` does. Without it, any spec whose
   * earlier tests recorded events fails on its NEXT `beforeEach` rather than on
   * the assertion, which is a confusing way to learn about a cascade.
   */
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('quadrantcode.purging', 'on', true)`;
    await tx`DELETE FROM users WHERE email = ${email.toLowerCase()}`;
  });

  const [user] = await sql`
    INSERT INTO users (email, role, email_verified_at)
    VALUES (${email.toLowerCase()}, ${role}, now())
    RETURNING id
  `;
  await sql`
    INSERT INTO user_profiles (user_id, display_name)
    VALUES (${user!.id}, ${onboarded ? 'E2E Tester' : null})
    ON CONFLICT DO NOTHING
  `;

  const sessionToken = randomBytes(32).toString('hex');
  await sql`
    INSERT INTO auth_sessions (session_token, user_id, expires)
    VALUES (${sessionToken}, ${user!.id}, now() + interval '1 day')
  `;

  const { hostname } = new URL(baseUrl);
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: sessionToken,
      domain: hostname,
      path: '/',
      httpOnly: true,
      /*
       * MUST be true: the `__Secure-` prefix is rejected by the browser unless
       * the cookie carries the Secure attribute. That is fine over plain http
       * here because Chromium treats 127.0.0.1 as a trustworthy origin, so a
       * Secure cookie is still stored and sent.
       */
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  return String(user!.id);
}

/**
 * Removes rows created by a spec, matched on the e2e email domain.
 *
 * ## Why this needs a transaction and a flag
 *
 * F3.2 made `session_events` append-only with a trigger that refuses DELETE
 * unless `quadrantcode.purging` is set. Deleting a user cascades into their
 * sessions and then into that table, so a plain `DELETE FROM users` is refused
 * — which is the trigger working, not a bug in it.
 *
 * That cost is real and it is not only a test cost: **account deletion in
 * production has to do the same thing.** F4.8 owns that path, and it will set
 * the same flag through `server/services/timeline/retention.ts`.
 *
 * `set_config(_, true)` is transaction-scoped, so `sql.begin` is not optional
 * here: outside a transaction the flag would apply to one statement and the
 * cascade would still be refused.
 */
export async function cleanup(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('quadrantcode.purging', 'on', true)`;
    await tx`DELETE FROM users WHERE email LIKE '%@e2e.test'`;
    await tx`DELETE FROM auth_verification_tokens WHERE identifier LIKE '%@e2e.test'`;
  });
}

/**
 * Deletes fixture problems, which cascade into sessions and their events.
 *
 * Specs used to run a bare `DELETE FROM problems WHERE slug LIKE …`. Same story
 * as `cleanup`: the cascade reaches the append-only log.
 */
export async function deleteProblems(
  sql: ReturnType<typeof postgres>,
  slugPattern: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('quadrantcode.purging', 'on', true)`;
    await tx`DELETE FROM problems WHERE slug LIKE ${slugPattern}`;
  });
}

/** Reads the theme actually applied to <html>. */
export async function appliedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}
