/**
 * The server boundary, as a REGRESSION TEST rather than a manual check.
 *
 * Two independent mechanisms stop `server/**` reaching a client bundle, and
 * both are asserted here:
 *
 *   1. ESLint `no-restricted-imports` — verified by linting Client Component
 *      source through the REAL project config and requiring the rule to fire.
 *   2. `import 'server-only'` in the app-facing entrypoints — verified by
 *      asserting the import is present. The build-time half is exercised by the
 *      `Build` step in CI; asserting it here catches silent removal in
 *      milliseconds instead of minutes.
 *
 * `lintText` with an explicit `filePath` is used rather than committed fixture
 * files: the source is linted exactly as if it lived at that path, so the test
 * exercises the real config for real directories, and no intentionally-broken
 * file has to sit in the tree being ignored.
 *
 * This test previously passed vacuously. The rule was scoped to components/,
 * lib/ and app/ only, so a fixture under tests/ produced zero messages and the
 * assertion had nothing to assert. That is exactly the failure mode a
 * regression test is supposed to expose, and the rule is now deny-by-default.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const RULE = 'no-restricted-imports';

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

async function violationsFor(source: string, filePath: string) {
  const results = await eslint.lintText(source, { filePath, warnIgnored: false });
  const [result] = results;
  if (!result) throw new Error(`ESLint returned no result for ${filePath}`);
  return result.messages.filter((message) => message.ruleId === RULE);
}

const CLIENT_IMPORTING_BARREL = `'use client';
import { getDb } from '@/server/db';
export function Offender() {
  return String(typeof getDb);
}
`;

const CLIENT_IMPORTING_ENV = `'use client';
import { getServerEnv } from '@/server/env';
export function Offender() {
  return String(typeof getServerEnv);
}
`;

/**
 * The bypass path. `server/db/client.ts` carries no `server-only` guard because
 * the worker imports it, which makes ESLint the ONLY thing protecting it.
 */
const CLIENT_IMPORTING_DB_CLIENT = `'use client';
import { getDb } from '@/server/db/client';
export function Bypasser() {
  return String(typeof getDb);
}
`;

const CLIENT_IMPORTING_SERVICE = `'use client';
import { requestPhoneOtp } from '@/server/services/auth/otp';
export function Bypasser() {
  return String(typeof requestPhoneOtp);
}
`;

describe('server boundary · ESLint blocks client → server imports', () => {
  it.each([
    ['the @/server/db barrel', CLIENT_IMPORTING_BARREL],
    ['@/server/env (secrets)', CLIENT_IMPORTING_ENV],
    ['@/server/db/client — the unguarded deep path', CLIENT_IMPORTING_DB_CLIENT],
    ['a business-logic service', CLIENT_IMPORTING_SERVICE],
  ])('rejects a component under components/ importing %s', async (_label, source) => {
    const violations = await violationsFor(source, 'components/probe.tsx');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.severity).toBe(2); // error, not warning
    expect(violations[0]?.message).toMatch(/must not import from server\//i);
  });

  it('rejects the same import from a NEW directory outside components/', async () => {
    // Deny-by-default: a client component in a directory nobody thought to
    // list must still be blocked.
    const violations = await violationsFor(CLIENT_IMPORTING_BARREL, 'features/probe.tsx');
    expect(violations).toHaveLength(1);
  });

  it('rejects it from a hooks directory', async () => {
    const violations = await violationsFor(CLIENT_IMPORTING_DB_CLIENT, 'hooks/useThing.ts');
    expect(violations).toHaveLength(1);
  });

  it.each([
    ['a Server Component page', 'app/dashboard/page.tsx'],
    ['a layout', 'app/admin/layout.tsx'],
    ['a route handler', 'app/api/thing/route.ts'],
    ['a service module', 'server/services/auth/otp.ts'],
    ['the worker', 'worker/index.ts'],
    ['a job processor', 'jobs/import.processor.ts'],
  ])('allows %s to import from server/', async (_label, filePath) => {
    const violations = await violationsFor(CLIENT_IMPORTING_BARREL, filePath);
    // If these were blocked, every server page would fail lint and somebody
    // would disable the rule globally — which is how boundaries die.
    expect(violations).toEqual([]);
  });
});

describe('server boundary · build-time guard is present', () => {
  it.each([
    ['server/db/index.ts', 'server/db/index.ts'],
    ['server/services/auth/session.ts', 'server/services/auth/session.ts'],
  ])("%s still imports 'server-only'", (_label, file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/^import 'server-only';$/m);
  });

  it('the worker does NOT import the server-only-guarded barrel', () => {
    // Importing '@/server/db' here would crash the worker at boot, which is
    // what previously motivated the --conditions=react-server flag.
    const source = readFileSync('worker/index.ts', 'utf8');
    expect(source).not.toMatch(/from '@\/server\/db'/);
    expect(source).toMatch(/from '@\/server\/db\/client'/);
  });

  it('no npm script fakes an RSC environment', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    for (const [name, script] of Object.entries(pkg.scripts)) {
      expect(script, `script "${name}" must not set --conditions=react-server`).not.toContain(
        'react-server',
      );
    }
  });

  it('lib/env.ts carries no secrets', () => {
    // The shared half must stay importable from a client bundle, which means
    // no secret may be declared in it.
    const source = readFileSync('lib/env.ts', 'utf8');
    for (const secret of [
      'DATABASE_URL',
      'AUTH_SECRET',
      'RESEND_API_KEY',
      'MSG91_AUTH_KEY',
      'RAZORPAY_KEY_SECRET',
      'UPSTASH_REDIS_REST_TOKEN',
      'ANTHROPIC_API_KEY',
    ]) {
      expect(source, `${secret} must live in server/env.ts`).not.toContain(secret);
    }
  });
});
