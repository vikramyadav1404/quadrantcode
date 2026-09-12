/**
 * Proves the payload-capture helper works, so F2.2's blind-retry leak check can
 * use it instead of building capture infrastructure under deadline.
 *
 * The helper's contract: if a string is anywhere in the client payload — the
 * HTML document, RSC flight data, a JS chunk, a fetch response, or a prefetch —
 * `find()` returns the responses carrying it.
 *
 * The POSITIVE CONTROL matters as much as the negative assertions. A capture
 * helper that silently reads nothing would make every "no leak" result pass
 * vacuously, which is the same failure the server-boundary test had.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, signInAs } from './helpers/auth';
import { capturePayload, settle, triggerPrefetches } from './helpers/payload';

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await cleanup(sql);
  await sql.end();
});

test('POSITIVE CONTROL — finds a value that IS in the payload', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'capture@e2e.test', baseUrl: baseURL! });

  const capture = capturePayload(page);
  await page.goto('/dashboard');
  await settle(page);
  await capture.stop();

  expect(capture.responses.length).toBeGreaterThan(0);
  expect(capture.combined().length).toBeGreaterThan(1000);

  // "Dashboard" is rendered on the page, so it must be found. If this fails,
  // the helper is not reading bodies and every negative below is worthless.
  expect(capture.find('Dashboard').length).toBeGreaterThan(0);
});

test('NEGATIVE — the session token never reaches the client payload', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'tokenleak@e2e.test', baseUrl: baseURL! });

  const cookies = await context.cookies();
  const sessionValue = cookies.find((cookie) =>
    cookie.name.includes('quadrantcode.session'),
  )!.value;

  const capture = capturePayload(page);
  await page.goto('/dashboard');
  await triggerPrefetches(page);
  await settle(page);
  await capture.stop();

  expect(capture.find(sessionValue)).toEqual([]);
});

test('NEGATIVE — no server secret reaches the client payload', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'envleak@e2e.test', baseUrl: baseURL! });

  const capture = capturePayload(page);
  await page.goto('/dashboard');
  await triggerPrefetches(page);
  await settle(page);
  await capture.stop();

  const secret = process.env.AUTH_SECRET ?? 'e2e-test-secret-not-for-production';
  expect(capture.find(secret)).toEqual([]);
  // The connection string, including its password, must not be inlined.
  expect(capture.find('postgresql://')).toEqual([]);
});

test('captures client-side navigation traffic, not only the first document', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'flight@e2e.test', baseUrl: baseURL! });
  await page.goto('/dashboard');

  // Capture only what a client-side navigation produces.
  const capture = capturePayload(page);
  await page.goto('/settings/phone');
  await settle(page);
  await capture.stop();

  expect(capture.responses.length).toBeGreaterThan(0);
  expect(capture.find('Verify your phone').length).toBeGreaterThan(0);
});
