/**
 * Issue #26 · a server action's revalidated layout must actually reach the
 * screen. See D39 in docs/decisions.md.
 *
 * ## What this guards against
 *
 * Next.js 15.4.2-canary.20 through 16.1.x ships a React build in which a
 * transition re-rendering a subtree under a `<Suspense>` boundary can finish
 * rendering and never commit (vercel/next.js#87529). For us that meant: click
 * "Start solving", the server creates the session and returns the new layout,
 * and the timer bar never appears until a reload. Measured on CI, about 45% of
 * attempts on the problem page, with `app/(app)/problems/loading.tsx` above it.
 *
 * ## Why each case loops
 *
 * One attempt catches the bug roughly half the time, which is a coin toss, not
 * a test. Ten attempts in one test miss it with probability ~0.1%. Every
 * attempt is counted rather than stopping at the first failure, so the message
 * says how often it happened, and the run cannot pass by luck on attempt one.
 *
 * Retries are off: a retry that passes would hide exactly what this measures.
 *
 * ## Three places, because the layout is shared
 *
 * The timer bar lives in the `(app)` layout, so its actions revalidate the
 * layout from whatever page is open. Each case exercises a page that had (or
 * has) a `loading.tsx` boundary above it, or the page where sessions start.
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

test.describe.configure({ retries: 0 });

const SLUG = 'commit-alpha';
const ATTEMPTS = 10;
/** Generous for a commit that normally lands in ~20 ms; the bug never lands at all. */
const PROBE_MS = 5_000;

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await deleteProblems(sql, 'commit-%');
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await deleteProblems(sql, 'commit-%');
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, 'Commit Alpha', 'external_link', 'leetcode',
            'https://leetcode.com/problems/commit-alpha/', 'easy', 'published')
  `;
  await signInAs(context, sql, { email: 'session-commit@e2e.test', baseUrl: baseURL! });
});

const timerOf = (page: Page) => page.getByRole('region', { name: /solve session timer/i });

/** True when the locator becomes visible within the probe window. */
async function appears(locator: ReturnType<Page['getByRole']>): Promise<boolean> {
  return locator
    .waitFor({ state: 'visible', timeout: PROBE_MS })
    .then(() => true)
    .catch(() => false);
}

/**
 * Ends the live session from a page with no Suspense boundary above it, so the
 * cleanup step cannot itself be caught by the bug under test.
 */
async function abandonFromSessionsPage(page: Page) {
  await page.goto('/sessions');
  const timer = timerOf(page);
  await timer.getByRole('button', { name: /^abandon$/i }).click();
  await page.getByRole('button', { name: /abandon it/i }).click();
  await expect(timerOf(page)).toBeHidden();
}

/** A live session, established through the UI and confirmed by a full load. */
async function liveSession(page: Page) {
  await page.goto(`/problems/${SLUG}`);
  /*
   * Wait for the action's response before navigating. Leaving the page while
   * the POST is in flight cancels it, so no session is created at all — the
   * first version of this helper did exactly that and failed on CI for a
   * reason that had nothing to do with the bug under test.
   */
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: /start solving/i }).click();
  expect((await started).ok()).toBe(true);
  // Whatever the client does, a full load renders the server's truth.
  await page.goto('/sessions');
  await expect(timerOf(page)).toBeVisible();
}

test('STARTING A SESSION SHOWS THE TIMER, EVERY TIME (problem page)', async ({ page }) => {
  test.setTimeout(240_000);
  const failures: number[] = [];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await page.goto(`/problems/${SLUG}`);
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && !!response.request().headers()['next-action'],
    );
    await page.getByRole('button', { name: /start solving/i }).click();
    // The server must have accepted the start; only then is a missing timer the bug.
    expect((await started).ok(), `start action on attempt ${attempt}`).toBe(true);

    if (!(await appears(timerOf(page)))) failures.push(attempt);
    await abandonFromSessionsPage(page);
  }

  expect(failures, `timer missing after Start on attempts ${failures.join(', ')}`).toEqual([]);
});

for (const [label, path] of [
  ['dashboard', '/dashboard'],
  ['catalog', '/problems'],
] as const) {
  test(`PAUSE AND RESUME COMMIT, EVERY TIME (${label})`, async ({ page }) => {
    test.setTimeout(240_000);
    await liveSession(page);
    await page.goto(path);

    const failures: string[] = [];
    const timer = timerOf(page);

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      await timer.getByRole('button', { name: /^pause$/i }).click();
      if (!(await appears(timer.getByRole('button', { name: /^resume$/i })))) {
        failures.push(`pause#${attempt}`);
        // Resynchronise from the server so the next attempt starts clean.
        await page.reload();
      }

      await timer.getByRole('button', { name: /^resume$/i }).click();
      if (!(await appears(timer.getByRole('button', { name: /^pause$/i })))) {
        failures.push(`resume#${attempt}`);
        await page.reload();
      }
    }

    await abandonFromSessionsPage(page);
    expect(failures, `stale timer bar on ${path}: ${failures.join(', ')}`).toEqual([]);
  });
}
