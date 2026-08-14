import { defineConfig, devices } from '@playwright/test';

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
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-test-secret-not-for-production',
      NEXT_PUBLIC_APP_URL: BASE_URL,
      /*
       * `next start` sets NODE_ENV=production, where the rate limiter refuses
       * the in-memory fallback — correctly, since it would not limit anything
       * across serverless instances. This single-process test server is the one
       * case where that fallback is sound.
       */
      ALLOW_IN_MEMORY_RATE_LIMIT: '1',
    },
  },
});
