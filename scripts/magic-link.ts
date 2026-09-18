/**
 * Mint a magic link without sending email, for signing in to a deployment.
 *
 *   npx tsx scripts/magic-link.ts <base-url> [email]
 *
 * Auth.js stores `sha256(token + AUTH_SECRET)` in `auth_verification_tokens`
 * and emails the raw token. So a link can be created by inserting the hash and
 * handing over the raw value — which exercises the real sign-in path end to
 * end: token lookup, single-use consumption, session row, cookie, redirect.
 * The only thing skipped is Resend's delivery, which is what is blocked.
 *
 * This is how `e2e/helpers/auth.ts` drives sign-in, and the browser suite is
 * the standing proof that the hash formula and callback shape are right.
 *
 * ## It reads nothing from .env, deliberately
 *
 * `AUTH_SECRET` and `DATABASE_URL` must both be exported in the shell. There
 * is no `dotenv/config` import here, because `.env` holds a *local* secret and
 * a local database URL: falling back to either would mint a link that looks
 * correct and fails at the callback with an opaque error, or write a token row
 * to the wrong database. Both failures have already happened once in this
 * project in other scripts.
 *
 * ## What it writes
 *
 * One row in `auth_verification_tokens`, single-use and expiring in fifteen
 * minutes (`MAGIC_LINK_TTL_SECONDS`, D13). Consuming it marks `consumed_at`
 * rather than deleting it, so the row stays as a record.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/** Fifteen minutes, matching MAGIC_LINK_TTL_SECONDS. */
const TTL_MS = 15 * 60 * 1000;
const DEFAULT_EMAIL = 'demo@quadrantcode.local';

const baseUrlArg = process.argv[2];
const email = (process.argv[3] ?? DEFAULT_EMAIL).toLowerCase();
const allowLocalSecret = process.argv.includes('--local-secret');

if (!baseUrlArg || baseUrlArg.startsWith('--')) {
  process.stdout.write(
    'usage: npx tsx scripts/magic-link.ts <base-url> [email]\n\n' +
      '  base-url  the deployment to sign in to, e.g. https://example.vercel.app\n' +
      `  email     defaults to ${DEFAULT_EMAIL}\n\n` +
      'Export first, in the same shell:\n' +
      '  $env:DATABASE_URL = "<connection string for THAT deployment>"\n' +
      '  $env:AUTH_SECRET  = "<AUTH_SECRET of THAT deployment>"\n',
  );
  process.exit(1);
}

const baseUrl = baseUrlArg.replace(/\/+$/, '');
const databaseUrl = process.env['DATABASE_URL'];
const secret = process.env['AUTH_SECRET'];

if (!databaseUrl || !secret) {
  process.stdout.write(
    'DATABASE_URL and AUTH_SECRET must both be set in this shell.\n' +
      'This script does not read .env — see the note at the top of the file.\n',
  );
  process.exit(1);
}

/*
 * Refuse the local development secret.
 *
 * The token is only valid if this secret is the one the deployment verifies
 * with. Using the repository's local value produces a link that is correct in
 * every visible respect and fails at the callback, which is a slow thing to
 * diagnose. Compared against `.env` directly rather than via dotenv, so the
 * comparison cannot be defeated by load order.
 */
let localSecret: string | undefined;
try {
  localSecret = /^AUTH_SECRET=(.*)$/m
    .exec(readFileSync('.env', 'utf8'))?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
} catch {
  localSecret = undefined;
}

const fingerprint = createHash('sha256').update(secret).digest('hex').slice(0, 8);

if (localSecret && secret === localSecret && !allowLocalSecret) {
  process.stdout.write(
    `REFUSING: AUTH_SECRET matches the one in .env (fingerprint ${fingerprint}).\n\n` +
      'That is the local development secret. A deployment verifies with its own,\n' +
      "so this link would fail at the callback. Copy the deployment's AUTH_SECRET\n" +
      '(Vercel → Project → Settings → Environment Variables → AUTH_SECRET, or\n' +
      '`vercel env pull`) and export that instead.\n\n' +
      'Pass --local-secret if you really are targeting the local server.\n',
  );
  process.exit(1);
}

const target = new URL(databaseUrl);
process.stdout.write(`database    ${target.host}${target.pathname}\n`);
process.stdout.write(`deployment  ${baseUrl}\n`);
process.stdout.write(`secret      fingerprint ${fingerprint}\n`);
process.stdout.write(`email       ${email}\n\n`);

/*
 * Pre-flight: is the resend provider even registered there?
 *
 * `server/services/auth/config.ts` registers it only when RESEND_API_KEY and
 * EMAIL_FROM are both set. Without them `/api/auth/callback/resend` does not
 * exist, and minting a token first would leave an orphan row in production and
 * a confusing error in the browser. Auth.js publishes the registered providers
 * at a public endpoint, so this is answerable before writing anything.
 */
const providersUrl = `${baseUrl}/api/auth/providers`;
let providers: Record<string, { id?: string }>;
try {
  const response = await fetch(providersUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  providers = (await response.json()) as Record<string, { id?: string }>;
} catch (error) {
  process.stdout.write(
    `Could not read ${providersUrl}\n  ${error instanceof Error ? error.message : String(error)}\n\n` +
      'Check the base URL. Nothing has been written.\n',
  );
  process.exit(1);
}

const registered = Object.keys(providers);
process.stdout.write(
  `providers   ${registered.length > 0 ? registered.join(', ') : '(none)'}\n\n`,
);

if (!registered.includes('resend')) {
  process.stdout.write(
    'REFUSING: the `resend` provider is not registered on that deployment.\n\n' +
      'config.ts registers it only when RESEND_API_KEY and EMAIL_FROM are both\n' +
      'set, so /api/auth/callback/resend does not exist and this link could not\n' +
      'be consumed. Set both in the deployment environment and redeploy.\n\n' +
      'Nothing has been written.\n',
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (!user) {
    // Auth.js would create one on callback. Say so rather than let a typo
    // quietly mint a second account.
    process.stdout.write(
      `No user with that address. Signing in would CREATE one.\n` +
        'Check the address before continuing; nothing has been written.\n',
    );
    process.exit(1);
  }

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TTL_MS);

  await sql`
    INSERT INTO auth_verification_tokens (identifier, token, expires)
    VALUES (${email}, ${createHash('sha256').update(`${token}${secret}`).digest('hex')}, ${expires})
  `;

  /*
   * RELATIVE callbackUrl. An absolute one must match the resolved origin
   * exactly or Auth.js treats it as an untrusted cross-origin redirect and
   * silently sends you to the site root — which reads as "sign-in failed" when
   * sign-in actually succeeded. Learned in e2e/helpers/auth.ts.
   */
  const params = new URLSearchParams({ token, email, callbackUrl: '/dashboard' });

  process.stdout.write(
    `Valid until ${expires.toISOString()} — fifteen minutes, single use.\n\n`,
  );
  process.stdout.write(`${baseUrl}/api/auth/callback/resend?${params.toString()}\n`);
} finally {
  await sql.end();
}
