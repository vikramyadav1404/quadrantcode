/**
 * C2 · the v2 session strip, with FEATURE_SOLVE_V2 on (`chromium-v2` only).
 *
 * The strip replaces the layout's timer bar on /solve while a sitting is live.
 * It must keep every control under the same accessible name and behave the same:
 * Pause/Resume, I'm stuck, Solved (+ confidence), Give up, Abandon (+ confirm).
 * Each control is exercised here on /solve; the layout's bar keeps its own
 * specs on every other page.
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { CONFIDENCE_LABELS } from '../lib/session/confidence';
import { SOLVE_V2_STRIP_MARKER } from '../lib/solve-v2/marker';
import { STUCK_CATEGORY_LABELS } from '../lib/reflection/taxonomy';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';
import { capturePayload, settle } from './helpers/payload';

const SLUG = 'c2-strip-alpha';
const TITLE = 'C2 Strip Alpha';
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

const timerOf = (page: Page) => page.getByRole('region', { name: /solve session timer/i });

/** Signs in as `email`, starts a sitting on the problem page, opens /solve. */
async function sittingOnSolve(page: Page, email: string, baseURL: string) {
  await signInAs(page.context(), sql, { email, baseUrl: baseURL });
  await page.goto(`/problems/${SLUG}`);
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: /start solving/i }).click();
  expect((await started).ok()).toBe(true);
  await page.goto(`/problems/${SLUG}/solve`);
  await expect(timerOf(page)).toBeVisible();
}

test('ONE "Solve session timer" on /solve, and it is the strip', async ({ page, baseURL }) => {
  await sittingOnSolve(page, 'c2-one-region@e2e.test', baseURL!);

  await expect(timerOf(page)).toHaveCount(1);
  await expect(timerOf(page)).toHaveAttribute(`data-${SOLVE_V2_STRIP_MARKER}`, '');
  await expect(timerOf(page)).toContainText(TITLE);

  // Not merely hidden: in the DOM itself, hidden elements included, there is
  // ONE timer region and ONE stuck dialog. The layout's bar does not render.
  await expect(page.locator('[role="region"][aria-label="Solve session timer"]')).toHaveCount(
    1,
  );
  await expect(page.locator('dialog[aria-label="Mark where you are stuck"]')).toHaveCount(1);

  // POSITIVE CONTROL: on the problem page the same region is the layout's bar.
  await page.goto(`/problems/${SLUG}`);
  await expect(timerOf(page)).toHaveCount(1);
  await expect(timerOf(page)).not.toHaveAttribute(`data-${SOLVE_V2_STRIP_MARKER}`, '');
});

test('the strip reaches the browser with the flag on (counterpart of the flag-off check)', async ({
  page,
  baseURL,
}) => {
  await signInAs(page.context(), sql, { email: 'c2-payload@e2e.test', baseUrl: baseURL! });
  await page.goto(`/problems/${SLUG}`);
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: /start solving/i }).click();
  expect((await started).ok()).toBe(true);

  const capture = capturePayload(page);
  await page.goto(`/problems/${SLUG}/solve`);
  await expect(timerOf(page)).toBeVisible();
  await settle(page);
  await capture.stop();
  expect(capture.find(SOLVE_V2_STRIP_MARKER).length).toBeGreaterThan(0);
});

test('ONE HEARTBEAT per interval on /solve: the strip sends it, nothing else does', async ({
  page,
  baseURL,
}) => {
  await page.clock.install();
  await sittingOnSolve(page, 'c2-heartbeat@e2e.test', baseURL!);

  // Counted from here: /solve has just loaded, so no other page's timer exists.
  let beats = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/session/heartbeat'
    ) {
      beats += 1;
    }
  });

  await page.clock.fastForward(30_000);
  await expect.poll(() => beats).toBe(1);
  await page.clock.fastForward(30_000);
  await expect.poll(() => beats).toBe(2);
});

test('PAUSE AND RESUME, and the clock stops while paused', async ({ page, baseURL }) => {
  await page.clock.install();
  await sittingOnSolve(page, 'c2-pause@e2e.test', baseURL!);
  const timer = timerOf(page);

  await timer.getByRole('button', { name: /^pause$/i }).click();
  await expect(timer.getByRole('button', { name: /^resume$/i })).toBeVisible();
  await expect(timer).toContainText('Paused');

  const clock = timer.getByLabel(/^Active time /);
  const pausedAt = await clock.getAttribute('aria-label');
  await page.clock.fastForward(10_000);
  await expect(clock).toHaveAttribute('aria-label', pausedAt!);

  await timer.getByRole('button', { name: /^resume$/i }).click();
  await expect(timer.getByRole('button', { name: /^pause$/i })).toBeVisible();
  await expect(timer).toContainText('Solving');
});

test("I'M STUCK records a marker, and the strip lists it", async ({ page, baseURL }) => {
  await sittingOnSolve(page, 'c2-stuck@e2e.test', baseURL!);
  const timer = timerOf(page);

  await timer.getByRole('button', { name: /i'm stuck/i }).click();
  const dialog = page.getByRole('dialog', { name: /mark where you are stuck/i });
  await dialog.getByLabel('Category').selectOption('edge_cases');
  await dialog.getByRole('button', { name: /mark it/i }).click();
  await expect(timer.getByText('Marked.')).toBeVisible();

  await expect(timer.getByRole('list', { name: 'Session events' })).toContainText(
    `Stuck · ${STUCK_CATEGORY_LABELS.edge_cases}`,
  );
});

test('A RUN appears in the strip with its verdict', async ({ page, baseURL }) => {
  await sittingOnSolve(page, 'c2-run@e2e.test', baseURL!);

  await page.getByRole('button', { name: /^run code$/i }).click();
  await expect(timerOf(page).getByRole('list', { name: 'Session events' })).toContainText(
    'Run ·',
    { timeout: 20_000 },
  );
});

test('SOLVED asks for confidence, then goes to the reflection', async ({ page, baseURL }) => {
  await sittingOnSolve(page, 'c2-solved@e2e.test', baseURL!);
  const timer = timerOf(page);

  await timer.getByRole('button', { name: /^solved$/i }).click();
  await timer
    .getByTestId('confidence-picker')
    .getByRole('button', { name: CONFIDENCE_LABELS.high })
    .click();
  await page.waitForURL('**/reflect');
});

test('GIVE UP ends the sitting and goes to the reflection', async ({ page, baseURL }) => {
  await sittingOnSolve(page, 'c2-give-up@e2e.test', baseURL!);

  await timerOf(page)
    .getByRole('button', { name: /^give up$/i })
    .click();
  await page.waitForURL('**/reflect');
});

test('ABANDON asks first, then discards the sitting', async ({ page, baseURL }) => {
  await sittingOnSolve(page, 'c2-abandon@e2e.test', baseURL!);

  await timerOf(page)
    .getByRole('button', { name: /^abandon$/i })
    .click();
  // Not yet: the dialog stands in the way.
  await expect(timerOf(page)).toBeVisible();
  await page.getByRole('button', { name: /abandon it/i }).click();
  await expect(timerOf(page)).toBeHidden();
});
