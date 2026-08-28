/**
 * F1.4 · the solve timer in a real browser.
 *
 * Two things can only be checked here.
 *
 * **The adversarial requirement, over HTTP.** `tests/session/adversarial.test.ts`
 * proves the schemas drop a forged duration; this proves it of the running
 * server, by POSTing a hostile body to `/api/session/heartbeat` with a real
 * session cookie and reading back what the server recorded.
 *
 * **Rehydration.** "Close the tab, reopen, the elapsed time is correct" is a
 * claim about a page load, and a page load is what a browser does.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  /*
   * The catalog is shared by every spec in this suite, so a fixture problem
   * left behind is a row on /problems for everyone else. `e2e/keyboard.spec.ts`
   * tabs through that page with a budget and stopped reaching its own rows once
   * three specs had each left one — a failure that looked like a keyboard
   * regression and was leftover data.
   */
  await sql`DELETE FROM problems WHERE slug LIKE 'timer-%'`;
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await sql`DELETE FROM problems WHERE slug LIKE 'timer-%'`;
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES ('timer-alpha', 'Timer Alpha', 'external_link', 'leetcode',
            'https://leetcode.com/problems/timer-alpha/', 'easy', 'published')
  `;

  await signInAs(context, sql, { email: 'timer@e2e.test', baseUrl: baseURL! });
});

test('starting a session puts a persistent timer on every screen', async ({ page }) => {
  await page.goto('/problems/timer-alpha');
  await page.getByRole('button', { name: /start solving/i }).click();

  const timer = page.getByRole('region', { name: /solve session timer/i });
  await expect(timer).toBeVisible();
  await expect(timer).toContainText('Timer Alpha');

  // "Persistent across the app" is the requirement, so it has to survive a
  // navigation to an unrelated page.
  await page.goto('/dashboard');
  await expect(page.getByRole('region', { name: /solve session timer/i })).toBeVisible();
});

test('THE ELAPSED TIME SURVIVES A RELOAD, BECAUSE THE SERVER HOLDS IT', async ({ page }) => {
  await page.goto('/problems/timer-alpha');
  await page.getByRole('button', { name: /start solving/i }).click();
  await expect(page.getByRole('region', { name: /solve session timer/i })).toBeVisible();

  /*
   * Move the session's start into the past directly in the database — the same
   * effect as leaving the tab open for twenty minutes, without waiting twenty
   * minutes. The client is told nothing; it simply reloads.
   */
  await sql`
    UPDATE solve_sessions
    SET started_at = now() - interval '20 minutes',
        last_heartbeat_at = now()
    WHERE status = 'active'
  `;

  await page.reload();

  const timer = page.getByRole('region', { name: /solve session timer/i });
  // 20:0x — the count came from the server's timestamps, not from anything the
  // browser was holding.
  await expect(timer).toContainText(/2[01]:\d{2}/);
});

test('A FORGED HEARTBEAT BODY CHANGES NOTHING THE SERVER COMPUTED', async ({ page }) => {
  await page.goto('/problems/timer-alpha');
  await page.getByRole('button', { name: /start solving/i }).click();
  await expect(page.getByRole('region', { name: /solve session timer/i })).toBeVisible();

  const [session] = await sql`
    SELECT id, last_heartbeat_at FROM solve_sessions WHERE status = 'active'
  `;
  expect(session).toBeDefined();

  // Posted from the page, so it carries the real session cookie: this is a
  // signed-in user lying, not an anonymous request being rejected.
  const response = await page.evaluate(async (sessionId) => {
    const result = await fetch('/api/session/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        activeDurationSeconds: 999_999,
        elapsedMs: 999_999_000,
        startedAt: '1999-01-01T00:00:00.000Z',
        lastHeartbeatAt: '1999-01-01T00:00:00.000Z',
        now: '1999-01-01T00:00:00.000Z',
      }),
    });
    return { status: result.status, body: await result.json() };
  }, String(session!.id));

  // Accepted — the forged fields are not rejected, they are not read at all.
  expect(response.status).toBe(200);
  expect(response.body.activeDurationSeconds).toBeLessThan(120);
  expect(response.body.activeDurationSeconds).not.toBe(999_999);

  const [after] = await sql`
    SELECT last_heartbeat_at, started_at FROM solve_sessions WHERE id = ${String(session!.id)}
  `;
  // 1999, if any of it had landed.
  expect(new Date(String(after!.last_heartbeat_at)).getFullYear()).toBe(
    new Date().getFullYear(),
  );
  expect(new Date(String(after!.started_at)).getFullYear()).toBe(new Date().getFullYear());
});

test('pausing stops the clock, and the bar says so', async ({ page }) => {
  await page.goto('/problems/timer-alpha');
  await page.getByRole('button', { name: /start solving/i }).click();

  const timer = page.getByRole('region', { name: /solve session timer/i });
  await timer.getByRole('button', { name: /^pause$/i }).click();

  await expect(timer).toContainText(/paused/i);
  await expect(timer.getByRole('button', { name: /^resume$/i })).toBeVisible();

  const [row] = await sql`SELECT status FROM solve_sessions WHERE status = 'paused'`;
  expect(row).toBeDefined();
});

test('a second session is refused, and the message points at the running one', async ({
  page,
}) => {
  await page.goto('/problems/timer-alpha');
  await page.getByRole('button', { name: /start solving/i }).click();
  await expect(page.getByRole('region', { name: /solve session timer/i })).toBeVisible();

  // Same page, second attempt: the server refuses rather than reassigning.
  await page.getByRole('button', { name: /start solving/i }).click();

  await expect(page.getByText(/already have a session in progress/i)).toBeVisible();
  await expect(page.getByText(/finish or abandon/i)).toBeVisible();

  const rows = await sql`SELECT id FROM solve_sessions WHERE status in ('active','paused')`;
  expect(rows).toHaveLength(1);
});
