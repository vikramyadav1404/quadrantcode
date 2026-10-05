/**
 * C1 · with FEATURE_SOLVE_V2 OFF, /solve is the v1 screen and nothing of v2
 * reaches the browser.
 *
 * Runs in the default `chromium` project, where the e2e server sets the flag
 * off explicitly. Two halves of one claim:
 *
 *   · the v1 suite (every existing /solve spec, in this same project) passes
 *     unchanged, so the screen behaves as before;
 *   · the v2 marker is in NO response /solve returns: not the HTML, not the
 *     RSC payload, not a JS chunk. So v2's code cannot have leaked into v1's
 *     client bundle, which is what the rule in SolveShellV2.tsx protects.
 *
 * Each "absent" assertion has a positive control: the same capture must find
 * the problem's title and must have captured JavaScript, or an empty capture
 * would pass for a clean one.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { SOLVE_V2_MARKER, SOLVE_V2_MARKERS } from '../lib/solve-v2/marker';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';
import { capturePayload, settle } from './helpers/payload';

const SLUG = 'c1-v2-off-alpha';
const TITLE = 'C1 Flag Off Alpha';
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

test('FLAG OFF · the v2 shell is absent from every response /solve returns', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'c1-v2-off@e2e.test', baseUrl: baseURL! });

  const capture = capturePayload(page);
  await page.goto(`/problems/${SLUG}/solve`);
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await capture.stop();

  // Positive controls: this capture really holds the page and its scripts.
  expect(capture.find(TITLE).length, 'the problem title was captured').toBeGreaterThan(0);
  expect(
    capture.responses.some((response) => /javascript/.test(response.contentType)),
    'JavaScript chunks were captured',
  ).toBe(true);

  // The claim, for every v2 marker: the shell (server) and each client component.
  for (const marker of SOLVE_V2_MARKERS) {
    expect(
      capture.find(marker).map((response) => response.url),
      `responses containing the v2 marker "${marker}" with the flag off`,
    ).toEqual([]);
  }
  await expect(page.getByTestId(SOLVE_V2_MARKER)).toHaveCount(0);
});

test('FLAG OFF · the internal v2 route is a 404, and /solve is not rewritten', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'c1-v2-off-route@e2e.test', baseUrl: baseURL! });

  // Requested directly, v2 does not exist while the flag is off.
  const direct = await page.goto(`/problems/${SLUG}/solve/v2`);
  expect(direct?.status()).toBe(404);
  await expect(page.getByTestId(SOLVE_V2_MARKER)).toHaveCount(0);

  // The middleware is a no-op: /solve is served by v1 at its own URL.
  const solve = await page.goto(`/problems/${SLUG}/solve`);
  expect(solve?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(`/problems/${SLUG}/solve`);
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page.getByTestId(SOLVE_V2_MARKER)).toHaveCount(0);
});
