/**
 * DIAGNOSTIC BRANCH ONLY — never merged (issue #26 experiments).
 *
 * E1: click "Start solving" right after load, vs. after networkidle.
 * E2: when the timer does not appear, reload and record whether it appears then.
 * E3: the same pair against a build with prefetch disabled on the shell and
 *     problem-page links (NEXT_PUBLIC_DIAG_NO_PREFETCH=1, DIAG_MODE=no-prefetch).
 *
 * Every attempt prints one `DIAG {...}` line; browser console, pageerror and
 * requestfailed are printed as `DIAG-LOG` lines. Retries are off so each
 * repetition is one honest sample.
 */
import { expect, test, type Page, type Request } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

test.describe.configure({ retries: 0 });

const MODE = process.env.DIAG_MODE ?? 'default';
const SLUG = 'diag-race';

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await deleteProblems(sql, `${SLUG}%`);
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await deleteProblems(sql, `${SLUG}%`);
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, 'Diag Race', 'external_link', 'leetcode',
            'https://leetcode.com/problems/diag-race/', 'easy', 'published')
  `;
  await signInAs(context, sql, { email: 'diag-race@e2e.test', baseUrl: baseURL! });
});

function instrument(page: Page) {
  const started = Date.now();
  const stamp = () => `${Date.now() - started}ms`;
  const log: string[] = [];
  const inflight = new Map<Request, string>();

  page.on('console', (message) =>
    log.push(`${stamp()} console.${message.type()}: ${message.text()}`),
  );
  page.on('pageerror', (error) => log.push(`${stamp()} pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    inflight.delete(request);
    log.push(
      `${stamp()} requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    );
  });
  page.on('request', (request) => {
    const prefetch = request.headers()['next-router-prefetch'] ? 'prefetch' : 'other';
    inflight.set(request, prefetch);
  });
  page.on('requestfinished', (request) => inflight.delete(request));

  return {
    log,
    stamp,
    inflight: () => {
      const values = [...inflight.values()];
      return {
        prefetch: values.filter((kind) => kind === 'prefetch').length,
        other: values.filter((kind) => kind === 'other').length,
      };
    },
  };
}

async function attempt(page: Page, waitIdle: boolean) {
  const probe = instrument(page);
  await page.goto(`/problems/${SLUG}`);
  const loadedAt = probe.stamp();
  if (waitIdle) await page.waitForLoadState('networkidle');

  const atClick = probe.inflight();
  const clickedAt = probe.stamp();
  const actionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: /start solving/i }).click();
  const response = await actionResponse;
  const body = await response.text().catch(() => '');

  const timer = page.getByRole('region', { name: /solve session timer/i });
  const beforeWait = Date.now();
  const shown = await timer
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  const shownAfterMs = shown ? Date.now() - beforeWait : null;
  const refreshFired = probe.log.some((line) => line.includes('DIAG refresh-workaround fired'));

  // E2: does the server already hold the session the client failed to show?
  let afterReload = 'n/a';
  if (!shown) {
    await page.reload();
    afterReload = await timer
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => 'timer-shown')
      .catch(() => 'timer-missing');
  }

  const row = {
    mode: MODE,
    waitIdle,
    shown,
    shownAfterMs,
    refreshFired,
    afterReload,
    loadedAt,
    clickedAt,
    inflightPrefetchAtClick: atClick.prefetch,
    inflightOtherAtClick: atClick.other,
    actionStatus: response.status(),
    actionOk: /"ok":true/.test(body),
  };
  console.log(`DIAG ${JSON.stringify(row)}`);
  for (const line of probe.log) console.log(`DIAG-LOG ${line}`);

  expect(shown, JSON.stringify(row)).toBe(true);
}

test(`E1/E3 [${MODE}] click right after load`, async ({ page }) => {
  await attempt(page, false);
});

test(`E1/E3 [${MODE}] click after networkidle`, async ({ page }) => {
  await attempt(page, true);
});
