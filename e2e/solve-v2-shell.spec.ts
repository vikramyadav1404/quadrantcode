/**
 * C1 · /solve renders the solve shell around the ProblemPanel, the limits strip
 * and the run panel, with their names and test ids intact.
 *
 * Built for the v2 screen behind FEATURE_SOLVE_V2. Since #40 (2026-11-05) that
 * is the only solve screen and the flag is gone, so this runs in the one
 * `chromium` project with every other /solve spec. This file pins the
 * structure; the behaviour is pinned by the rest of the suite.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { EXECUTION_LIMITS } from '../server/services/execution/provider';
import { SOLVE_V2_MARKER, SOLVE_V2_RUN_PANEL_MARKER } from '../lib/solve-v2/marker';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';
import { capturePayload, settle } from './helpers/payload';

const SLUG = 'c1-v2-shell-alpha';
const TITLE = 'C1 V2 Shell Alpha';
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
  await signInAs(context, sql, { email: 'c1-v2-shell@e2e.test', baseUrl: baseURL! });
});

test('FLAG ON · /solve renders the v2 shell, and it reaches the browser', async ({ page }) => {
  const capture = capturePayload(page);
  await page.goto(`/problems/${SLUG}/solve`);
  await expect(page.getByTestId(SOLVE_V2_MARKER)).toBeVisible();
  await settle(page);
  await capture.stop();

  // The counterpart of solve-v2-off.spec.ts: the marker IS in the output here,
  // so that spec's "absent" is a real result and not a detector that sees nothing.
  expect(capture.find(SOLVE_V2_MARKER).length).toBeGreaterThan(0);
});

test('FLAG ON · /problems/[slug]/solve serves v2, and the URL never changes', async ({
  page,
}) => {
  // A full load of the public URL: middleware rewrites, the browser URL stays.
  const response = await page.goto(`/problems/${SLUG}/solve`);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId(SOLVE_V2_MARKER)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/problems/${SLUG}/solve`);

  // A client navigation to the same URL is rewritten too.
  await page.goto(`/problems/${SLUG}`);
  await page.getByRole('link', { name: /open the editor/i }).click();
  await page.waitForURL(`**/problems/${SLUG}/solve`);
  await expect(page.getByTestId(SOLVE_V2_MARKER)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/problems/${SLUG}/solve`);
});

test('THE SHELL HOLDS THE EXISTING HALVES, with their names and test ids', async ({ page }) => {
  await page.goto(`/problems/${SLUG}/solve`);
  const shell = page.getByTestId(SOLVE_V2_MARKER);
  await expect(shell).toBeVisible();

  // ProblemPanel, unchanged: title, tabs, and the external-problem pane.
  await expect(shell.getByRole('heading', { name: TITLE })).toBeVisible();
  for (const tab of ['Description', 'Editorial', 'Submissions']) {
    await expect(shell.getByRole('button', { name: tab, exact: true })).toBeVisible();
  }
  await expect(shell.getByRole('link', { name: /read it on leetcode/i })).toBeVisible();

  // RunPanel, unchanged: language, Run, Reset, and the editor itself.
  await expect(shell.getByLabel('Language')).toBeVisible();
  await expect(shell.getByRole('button', { name: /^run code$/i })).toBeVisible();
  await expect(shell.getByRole('button', { name: 'Reset code' })).toBeVisible();
  await expect(shell.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });

  // C5: those controls are v2's own copy, in the right pane, and there is one
  // of them. A shell that rendered two run panels, or none, fails here.
  await expect(
    shell.locator(`[data-pane="right"] [data-${SOLVE_V2_RUN_PANEL_MARKER}]`),
  ).toHaveCount(1);
  await expect(shell.getByRole('button', { name: /^run code$/i })).toHaveCount(1);
  await expect(shell.getByLabel('Language')).toHaveCount(1);

  // The limits strip, from the same constant the runner sends.
  await expect(
    shell.getByText(
      `${EXECUTION_LIMITS.cpuSeconds}s CPU · ${EXECUTION_LIMITS.wallSeconds}s wall · ` +
        `${EXECUTION_LIMITS.memoryKb / 1024} MB · no network · ` +
        `${EXECUTION_LIMITS.maxOutputBytes / 1024} KB output`,
      { exact: true },
    ),
  ).toBeVisible();

  // Both panes of the split are inside the shell, not beside it.
  await expect(shell.locator('[data-pane="left"]')).toHaveCount(1);
  await expect(shell.locator('[data-pane="right"]')).toHaveCount(1);
});
