/**
 * C3 · the solve screen's history card.
 *
 *   · no history yet: says so, and "Not scheduled yet"
 *   · after a solve: attempts, last outcome, best time, and the next revision
 *     date exactly as the schedule stores it
 *   · after giving up: nothing is scheduled, so "Not scheduled yet"
 *   · in a blind revision sitting: no card at all, and no trace in any payload
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { OUTCOME_LABELS } from '../lib/reflection/attempt-view';
import { CONFIDENCE_LABELS } from '../lib/session/confidence';
import { SOLVE_V2_HISTORY_MARKER } from '../lib/solve-v2/marker';
import { formatDay } from '../lib/time/format-day';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';
import { capturePayload, settle } from './helpers/payload';

const SLUG = 'c3-history-alpha';
const TITLE = 'C3 History Alpha';
let sql: ReturnType<typeof postgres>;
let problemId: string;

test.beforeAll(async () => {
  sql = db();
  await deleteProblems(sql, 'c3-history-%');
  const [row] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, ${TITLE}, 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'easy', 'published')
    RETURNING id
  `;
  problemId = String(row!['id']);
});

test.afterAll(async () => {
  await deleteProblems(sql, 'c3-history-%');
  await cleanup(sql);
  await sql.end();
});

const cardOf = (page: Page) =>
  page.getByRole('region', { name: 'Your history on this problem' });
const value = (page: Page, label: string) =>
  cardOf(page)
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');

/** Starts a sitting on the problem page and finishes it from the timer bar. */
async function finishOnProblemPage(page: Page, how: 'solved' | 'give up') {
  await page.goto(`/problems/${SLUG}`);
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: /start solving/i }).click();
  expect((await started).ok()).toBe(true);

  const timer = page.getByRole('region', { name: /solve session timer/i });
  await expect(timer).toBeVisible();
  if (how === 'solved') {
    await timer.getByRole('button', { name: /^solved$/i }).click();
    await timer
      .getByTestId('confidence-picker')
      .getByRole('button', { name: CONFIDENCE_LABELS.high })
      .click();
  } else {
    await timer.getByRole('button', { name: /^give up$/i }).click();
  }
  await page.waitForURL('**/reflect');
}

test('NO HISTORY YET: the card says so, and nothing is scheduled', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'c3-empty@e2e.test', baseUrl: baseURL! });
  const capture = capturePayload(page);
  await page.goto(`/problems/${SLUG}/solve`);

  await expect(cardOf(page)).toBeVisible();
  await settle(page);
  await capture.stop();
  await expect(cardOf(page)).toContainText('No finished attempts yet.');
  await expect(value(page, 'Attempts')).toHaveText('0');
  await expect(value(page, 'Next revision')).toHaveText('Not scheduled yet');
  // POSITIVE CONTROL for the blind test's absence check: when the card renders,
  // the capture does find its marker.
  expect(capture.find(SOLVE_V2_HISTORY_MARKER).length).toBeGreaterThan(0);
});

test('AFTER A SOLVE: attempts, outcome, best time and the scheduled date', async ({
  page,
  context,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, {
    email: 'c3-solved@e2e.test',
    baseUrl: baseURL!,
  });
  await finishOnProblemPage(page, 'solved');

  const [schedule] = await sql`
    SELECT due_local_date::text AS due FROM revision_schedule
    WHERE user_id = ${userId} AND problem_id = ${problemId}
  `;
  const due = String(schedule!['due']);

  await page.goto(`/problems/${SLUG}/solve`);
  await expect(value(page, 'Attempts')).toHaveText('1');
  await expect(value(page, 'Last outcome')).toHaveText(OUTCOME_LABELS.solved);
  await expect(value(page, 'Best time')).toHaveText(/^\d{2}:\d{2}$/);
  // The stored local date, shown as is: no timezone may move it.
  await expect(value(page, 'Next revision')).toHaveText(
    formatDay(new Date(`${due}T12:00:00Z`), 'UTC')!,
  );
});

test('AFTER GIVING UP: the outcome shows, and nothing is scheduled', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'c3-gave-up@e2e.test', baseUrl: baseURL! });
  await finishOnProblemPage(page, 'give up');

  await page.goto(`/problems/${SLUG}/solve`);
  await expect(value(page, 'Last outcome')).toHaveText(OUTCOME_LABELS.stuck);
  await expect(value(page, 'Next revision')).toHaveText('Not scheduled yet');
});

test('IN A BLIND RETRY: no history card, and no trace of it in any payload', async ({
  page,
  context,
  baseURL,
}) => {
  const email = 'c3-blind@e2e.test';
  await signInAs(context, sql, { email, baseUrl: baseURL! });
  const slug = 'c3-history-blind';

  // A problem this user solved three days ago, due for revision today.
  const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
  const userId = String(user!['id']);
  const [problem] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${slug}, 'C3 History Blind', 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${slug}/`}, 'medium', 'published')
    RETURNING id
  `;
  const blindProblemId = String(problem!['id']);
  await sql`
    INSERT INTO solve_sessions (user_id, problem_id, status, started_at, ended_at,
                                last_heartbeat_at, started_local_date, ended_local_date)
    VALUES (${userId}, ${blindProblemId}, 'solved', now() - interval '3 days',
            now() - interval '3 days' + interval '20 minutes', now() - interval '3 days',
            (now() - interval '3 days')::date, (now() - interval '3 days')::date)
  `;
  await sql`
    INSERT INTO revision_schedule (user_id, problem_id, interval_days, due_local_date)
    SELECT ${userId}, ${blindProblemId}, 3, timezone(u.timezone, now())::date
    FROM users u WHERE u.id = ${userId}
  `;

  await page.goto('/revision');
  const capture = capturePayload(page);
  await page.getByRole('button', { name: 'Blind retry' }).click();
  await page.waitForURL(`**/problems/${slug}/solve`);
  await expect(page.getByRole('region', { name: /blind retry revision/i })).toBeVisible();
  await settle(page);
  await capture.stop();

  await expect(cardOf(page)).toHaveCount(0);
  expect(capture.find(SOLVE_V2_HISTORY_MARKER).map((response) => response.url)).toEqual([]);
  // POSITIVE CONTROL: this really is the v2 screen, with its strip.
  await expect(page.getByRole('region', { name: /solve session timer/i })).toHaveAttribute(
    'data-solve-v2-strip',
    '',
  );
});
