/**
 * Issue #30 · the clicked link says it is working, without a Suspense boundary.
 *
 * D39 removed every `loading.tsx` under `(app)`, so navigating keeps the old
 * screen until the next one is ready. `LinkPending` (useLinkStatus) is the
 * feedback that replaced the skeletons: a small mark inside the link that was
 * clicked, for as long as its navigation is in flight.
 *
 * ## How a "slow navigation" is made deterministic
 *
 * Instead of hoping a request is slow enough to observe, the test holds every
 * RSC request for the target page at the network layer — the prefetch and the
 * navigation alike — until it has seen the mark, then releases them. No
 * timeouts are involved; the gate opens when the assertion has passed.
 *
 * The prefetch is HELD, not refused. The first version aborted it, and the
 * navigation, which waits on that in-flight prefetch, failed with it; Next then
 * fell back to a full page load, which is not a client navigation and has no
 * pending state. Every test here also asserts the page was never reloaded.
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const SLUG = 'lp-alpha';
const TITLE = 'Link Pending Alpha';
let sql: ReturnType<typeof postgres>;

test.beforeAll(async () => {
  sql = db();
  await deleteProblems(sql, SLUG);
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, ${TITLE}, 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'easy', 'published')
  `;
});

test.afterAll(async () => {
  await deleteProblems(sql, SLUG);
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await signInAs(context, sql, { email: 'link-pending@e2e.test', baseUrl: baseURL! });
});

/**
 * Holds every RSC request for `pathname` (prefetch and navigation) until
 * `release()` is called, and records any full-document load of the page that
 * started the navigation — which would mean it was not a client navigation.
 */
async function gateNavigation(page: Page, pathname: string) {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  let documentLoads = 0;

  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const request = route.request();
      if (request.resourceType() === 'document') documentLoads += 1;
      if (request.headers()['rsc'] !== '1') return route.continue();
      held += 1;
      await opened;
      return route.continue();
    },
  );

  return {
    release: () => release(),
    wasHeld: () => held > 0,
    /** Full page loads of the TARGET: a client navigation makes none. */
    documentLoads: () => documentLoads,
  };
}

test('A CATALOG ROW shows it is opening the problem, then the problem opens', async ({
  page,
}) => {
  const gate = await gateNavigation(page, `/problems/${SLUG}`);
  await page.goto(`/problems?search=${encodeURIComponent(TITLE)}`);

  const row = page.getByRole('link', { name: TITLE });
  await expect(row.getByTestId('link-pending')).toHaveCount(0);
  await row.click();

  await expect(row.getByTestId('link-pending')).toBeVisible();
  expect(gate.wasHeld(), 'the navigation request was really held').toBe(true);

  gate.release();
  await page.waitForURL(`**/problems/${SLUG}`);
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  expect(gate.documentLoads(), 'a client navigation, not a page reload').toBe(0);
  await expect(page.getByTestId('link-pending')).toHaveCount(0);
});

test('A DASHBOARD LINK shows it is working while the next page loads', async ({ page }) => {
  const gate = await gateNavigation(page, '/analytics');
  await page.goto('/dashboard');

  const link = page.getByRole('link', { name: 'See the full breakdown' });
  await link.click();
  await expect(link.getByTestId('link-pending')).toBeVisible();
  expect(gate.wasHeld()).toBe(true);

  gate.release();
  await page.waitForURL('**/analytics');
  expect(gate.documentLoads(), 'a client navigation, not a page reload').toBe(0);
  await expect(page.getByTestId('link-pending')).toHaveCount(0);
});

test('THE NAV LINK TO THE DASHBOARD shows it is working (the page that lost its skeleton)', async ({
  page,
}) => {
  const gate = await gateNavigation(page, '/dashboard');
  await page.goto('/problems');

  const link = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /dashboard/i });
  await link.click();
  await expect(link.getByTestId('link-pending')).toBeVisible();
  expect(gate.wasHeld()).toBe(true);

  gate.release();
  await page.waitForURL('**/dashboard');
  expect(gate.documentLoads(), 'a client navigation, not a page reload').toBe(0);
  await expect(page.getByTestId('link-pending')).toHaveCount(0);
});

test('AT REST, no link carries the mark', async ({ page }) => {
  // The mark renders nothing while idle: no layout change, no change to any
  // link's accessible name, on the pages that carry it.
  for (const path of ['/problems', '/dashboard']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByTestId('link-pending')).toHaveCount(0);
  }
});
