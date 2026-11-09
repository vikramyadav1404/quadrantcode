/**
 * A hidden tab stops beating, and coming back after the idle threshold shows
 * the sitting paused where the user left it (`lib/session/heartbeat-policy.ts`).
 *
 * Visibility is simulated by overriding `document.visibilityState` and firing
 * `visibilitychange`: Playwright has no API that backgrounds a page, and this
 * is exactly what the hook reads.
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const SLUG = 'hidden-tab-alpha';
const TITLE = 'Hidden Tab Alpha';
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

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => next === 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

function countHeartbeats(page: Page) {
  const counter = { beats: 0 };
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/session/heartbeat'
    ) {
      counter.beats += 1;
    }
  });
  return counter;
}

test('A HIDDEN TAB SENDS NO HEARTBEAT, and beats at once when it comes back', async ({
  page,
  baseURL,
}) => {
  await page.clock.install();
  await sittingOnSolve(page, 'hidden-tab-quiet@e2e.test', baseURL!);
  const counter = countHeartbeats(page);

  await setVisibility(page, 'hidden');
  await page.clock.fastForward(30_000);
  await page.clock.fastForward(30_000);
  await page.clock.fastForward(30_000);
  // Give any stray request time to show up before asserting silence.
  await page.waitForTimeout(500);
  expect(counter.beats).toBe(0);

  await setVisibility(page, 'visible');
  await expect.poll(() => counter.beats).toBe(1);

  // POSITIVE CONTROL: visible again, the interval beats as before.
  await page.clock.fastForward(30_000);
  await expect.poll(() => counter.beats).toBe(2);
});

test('BACK AFTER THE IDLE THRESHOLD, the bar shows the sitting paused', async ({
  page,
  baseURL,
}) => {
  const email = 'hidden-tab-idle@e2e.test';
  await sittingOnSolve(page, email, baseURL!);
  const timer = timerOf(page);
  await expect(timer).toContainText('Solving');

  await setVisibility(page, 'hidden');

  /*
   * Two minutes of work, then ten minutes away: what the server would have
   * seen had the clock moved. The start moves back too (as in session.spec.ts),
   * so the autopause is stamped after it.
   */
  await sql`
    UPDATE solve_sessions s
    SET started_at = now() - interval '12 minutes',
        last_heartbeat_at = now() - interval '10 minutes'
    FROM users u
    WHERE s.user_id = u.id AND u.email = ${email} AND s.status = 'active'
  `;

  const reply = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/session/heartbeat',
  );
  await setVisibility(page, 'visible');
  const body = (await (await reply).json()) as { status: string };
  expect(body.status).toBe('paused');

  await expect(timer).toContainText('Paused');
  await expect(timer.getByRole('button', { name: /^resume$/i })).toBeVisible();

  const [event] = await sql`
    SELECT e.type FROM session_events e
    JOIN solve_sessions s ON s.id = e.session_id
    JOIN users u ON u.id = s.user_id
    WHERE u.email = ${email} AND e.type = 'idle_autopause'
  `;
  expect(event?.type).toBe('idle_autopause');
});
