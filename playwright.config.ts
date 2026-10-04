import { defineConfig, devices } from '@playwright/test';
import { config as loadEnvFile } from 'dotenv';
import { applyLocalTestDefaults } from './lib/db/local-test-db';
import { assertEnvNotProduction } from './lib/db/production-guard';

/*
 * Issue #27. An optional, git-ignored `.env.test` may override settings (it
 * never overrides a variable already set, so CI's values win); outside CI an
 * unset TEST_DATABASE_URL defaults to the local embedded Postgres. Then refuse
 * to start if any database variable this process can see is production —
 * fixtures insert and delete rows, and `next start` below runs as
 * NODE_ENV=production, which is exactly the mode `server/env.ts` exempts from
 * its own remote-database check.
 */
loadEnvFile({ path: '.env.test', quiet: true });
applyLocalTestDefaults();
assertEnvNotProduction(
  ['TEST_DATABASE_URL', 'DATABASE_URL', 'DIRECT_DATABASE_URL', 'DATABASE_URL_UNPOOLED'],
  'playwright.config.ts',
);
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';

/**
 * Browser tests, kept deliberately small.
 *
 * Four specs only — viewports, theme flash, the auth flow, and the payload
 * capture helper. Everything else is faster and more reliable as a unit or
 * integration test; a large browser suite becomes flake that people learn to
 * ignore, which is worse than not having it.
 *
 * Runs as a SEPARATE CI job so browser flake never blocks the unit suite.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const JUDGE0_PORT = Number(process.env.JUDGE0_E2E_PORT ?? 3211);
const REAL_SANDBOX_E2E = process.env.RUN_VERCEL_SANDBOX_E2E === '1';
// `localhost`, not 127.0.0.1: Auth.js resolves its own origin from the Host
// header, and a mismatch makes it reject callback URLs as cross-origin.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './.playwright/results',

  // These specs share one database; running files in parallel would let one
  // spec's truncation delete another's fixtures.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: '.playwright/report', open: 'never' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * `next start`, not `next dev`. The theme-flash spec measures what a real
   * user gets: dev mode serves unminified bundles with HMR injected, which
   * changes first-paint timing and would make the result meaningless.
   */
  webServer: [
    {
      command: 'node e2e/helpers/judge0-server.mjs',
      url: `http://127.0.0.1:${JUDGE0_PORT}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { JUDGE0_E2E_PORT: String(JUDGE0_PORT) },
    },
    {
      command: `npx next start -p ${PORT}`,
      url: BASE_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'production',
        /*
         * All three database variables, not just DATABASE_URL. `next start`
         * fills any variable left unset here from `.env.local`, which on the
         * owner's machine holds production — so an unset DIRECT_DATABASE_URL
         * was a way for the test server to reach production (#27).
         */
        DATABASE_URL: TEST_DATABASE_URL,
        DIRECT_DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_URL_UNPOOLED: TEST_DATABASE_URL,
        AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-test-secret-not-for-production',
        NEXT_PUBLIC_APP_URL: BASE_URL,
        RESEND_API_KEY: 'test-only-api-key',
        EMAIL_FROM: 'Quadrantcode <test@example.com>',
        E2E_EMAIL_CAPTURE: '1',
        JUDGE0_URL: `http://127.0.0.1:${JUDGE0_PORT}`,
        EXECUTION_BACKEND: REAL_SANDBOX_E2E ? 'vercel_sandbox' : 'judge0',
        EXECUTION_SANDBOX_IMAGE: REAL_SANDBOX_E2E
          ? (process.env.EXECUTION_SANDBOX_IMAGE ?? '')
          : '',
        FEATURE_EXECUTION: 'true',
        /*
         * F4.1 · `native-platform.spec.ts` exists to exercise ORIGINAL problems
         * end to end — opening one, running code against it, submitting.
         *
         * That is precisely what `FEATURE_ORIGINAL_PROBLEMS` gates, so with the
         * flag off those problems 404 by design and the whole spec fails. This
         * turns the feature under test ON rather than weakening the gate.
         *
         * The OFF state is covered at the service layer in
         * `tests/problems/original-gate.test.ts`, across all three catalog
         * entry points, which is cheaper than a second browser server just to
         * hold a different env.
         */
        FEATURE_ORIGINAL_PROBLEMS: 'true',
        /*
         * F2.2 · `revision-modes.spec.ts` drives the modes and the blind-retry
         * payload check, all of which this flag gates, so it is on for the same
         * reason as the flag above. `revision.spec.ts` (F2.1) runs under it too
         * and still passes: the modes add controls beside the outcome buttons
         * and remove none. See D34.
         */
        FEATURE_REVISION_MODES: 'true',
        /*
         * `next start` sets NODE_ENV=production, where the rate limiter refuses
         * the in-memory fallback — correctly, since it would not limit anything
         * across serverless instances. This single-process test server is the one
         * case where that fallback is sound.
         */
        ALLOW_IN_MEMORY_RATE_LIMIT: '1',
        /*
         * F3.1b: the cron reconciler's credential. Set HERE and nowhere else,
         * for the same reason as the two flags below — `machine-routes.spec.ts`
         * asserts that the wrong bearer and the literal `Bearer undefined` are
         * refused, and a server with no secret at all refuses every caller
         * identically, so the suite would go green having proved nothing.
         *
         * VERCEL is deliberately NOT set: `/api/queues/executions` must stay
         * 404 off-platform, and that spec asserts it.
         */
        CRON_SECRET: 'e2e-cron-secret-not-for-production',
        /*
         * F0.3b: phone sign-in is behind this flag, and a spec that cannot reach
         * the endpoint proves nothing about it. With the flag off, every request
         * to /api/auth/phone/* throws FeatureDisabledError and the /login tabs do
         * not render at all — so the suite would go green having tested that the
         * feature is absent.
         *
         * Turned on HERE rather than in .env, so it is on for the browser tests
         * and still off by default everywhere else.
         */
        FEATURE_PHONE_OTP: 'true',
        /*
         * And the provider that flag needs. `next start` is NODE_ENV=production,
         * where the console provider refuses — correctly, since a real deployment
         * silently dropping codes looks like a delivery outage rather than a
         * misconfiguration. Same shape as ALLOW_IN_MEMORY_RATE_LIMIT above, for
         * the same reason, and off everywhere else.
         */
        ALLOW_CONSOLE_OTP: '1',
      },
    },
  ],
});
