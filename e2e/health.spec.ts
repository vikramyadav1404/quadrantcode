/**
 * F4.6 · the health endpoint and the request id, over real HTTP.
 *
 * Both criteria here are about what a caller actually receives, which is not
 * something a unit test can settle: "the dashboard shows live numbers" and
 * "a request id is traceable" are claims about responses.
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

test('the health endpoint answers without a session', async ({ request }) => {
  // An uptime probe cannot hold one, and a health check behind auth answers
  // "is auth working" rather than "is the system up".
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.dependencies.postgres).toBe('up');
});

test('IT REPORTS ABSENT DEPENDENCIES AS not_configured, NOT AS UP', async ({ request }) => {
  /*
   * The failure this endpoint exists to avoid: a dashboard that is green
   * because it never looked. The E2E harness configures its local Judge0
   * contract server, while Redis and Sentry are intentionally absent; the
   * absent dependencies must say so.
   */
  const body = await (await request.get('/api/health')).json();

  expect(body.dependencies.redis).toBe('not_configured');
  expect(body.dependencies.sentry).toBe('not_configured');
  expect(body.status).toBe('degraded');
});

test('it leaks no configuration or error text', async ({ request }) => {
  // A public health endpoint is a reconnaissance surface. Names and states only.
  const text = await (await request.get('/api/health')).text();

  expect(text).not.toContain('postgresql://');
  expect(text).not.toMatch(/password/i);
  // The `detail` lines explain WHY something is absent and belong to the
  // authenticated dashboard, not to anyone who can reach the URL.
  expect(text).not.toMatch(/detail/i);
});

test('EVERY RESPONSE CARRIES A REQUEST ID', async ({ request }) => {
  const response = await request.get('/api/health');
  const id = response.headers()['x-request-id'];

  // So a user can quote it in a bug report and it can be found in the logs.
  expect(id).toBeTruthy();
  expect(id!.length).toBeGreaterThanOrEqual(8);
});

test('an upstream request id is honoured, so a trace can start before us', async ({
  request,
}) => {
  const response = await request.get('/api/health', {
    headers: { 'x-request-id': 'upstream-trace-123' },
  });

  expect(response.headers()['x-request-id']).toBe('upstream-trace-123');
});

test('A HOSTILE REQUEST ID IS NOT ECHOED BACK', async ({ request }) => {
  /*
   * The header lands in every log line for the request. Unbounded, it is a way
   * to write megabytes into a log file with one call.
   */
  const response = await request.get('/api/health', {
    headers: { 'x-request-id': 'x'.repeat(500) },
  });

  expect(response.headers()['x-request-id']!.length).toBeLessThanOrEqual(64);
});

test('the health dashboard needs an admin', async ({ page, context, baseURL }) => {
  await signInAs(context, sql, { email: 'health-user@e2e.test', baseUrl: baseURL! });

  const response = await page.goto('/admin/health');

  // Not an admin — the admin layout refuses. Never the page.
  expect(response?.status()).not.toBe(200);
});

test('AN ADMIN SEES LIVE NUMBERS, not placeholders', async ({ page, context, baseURL }) => {
  await signInAs(context, sql, {
    email: 'health-admin@e2e.test',
    baseUrl: baseURL!,
    role: 'admin',
  });

  await page.goto('/admin/health');

  const list = page.getByRole('list', { name: 'Dependency health' });
  await expect(list).toBeVisible();

  // A real latency from a real query, not a hardcoded string.
  await expect(list.getByText(/postgres/)).toBeVisible();
  await expect(list.getByText(/\d+ ms/)).toBeVisible();

  // And the panels that cannot exist are listed as absent, with the reason.
  await expect(page.getByText(/there is no queue/)).toBeVisible();
});
