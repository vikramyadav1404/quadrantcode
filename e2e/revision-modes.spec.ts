/**
 * F2.2 · revision modes in a browser — above all, the blind-retry leak check.
 *
 * The ticket: "In blind retry, previous code must not reach the client at all —
 * not in the RSC payload, not in a props blob, not in a prefetched route. Verify
 * by inspecting the network response, not by trusting that the component does
 * not render it." `capturePayload` reads every response body, including flight
 * data and prefetches; `triggerPrefetches` makes the links on the page fetch.
 *
 * Each negative has a POSITIVE CONTROL: the same markers ARE found on the pages
 * that legitimately show them. Without that, "not found" could mean the capture
 * read nothing.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';
import { capturePayload, settle, triggerPrefetches } from './helpers/payload';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'revision-modes@e2e.test';
const tag = randomUUID().slice(0, 8);
const PREVIOUS_CODE = `PREVCODE_${tag}_left_lt_right`;
const PREVIOUS_NOTE = `PREVNOTE_${tag}_two_pointers`;
const STUCK_NOTE = `STUCKNOTE_${tag}_edge`;
const PREVIOUS_DRAFT = `PREVDRAFT_${tag}`;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await deleteProblems(sql, 'modes-%');
  await cleanup(sql);
  await sql.end();
});

/**
 * A problem this user solved once — with code, an approach note and a stuck
 * note on that attempt — and which is due for revision today.
 */
async function seedSolvedAndDue(slug: string) {
  const [user] = await sql`SELECT id, timezone FROM users WHERE email = ${EMAIL}`;
  const userId = String(user!.id);

  const [problem] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${slug}, ${`Modes ${slug}`}, 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${slug}/`}, 'medium', 'published')
    RETURNING id
  `;
  const problemId = String(problem!.id);

  const [session] = await sql`
    INSERT INTO solve_sessions (user_id, problem_id, status, started_at, ended_at,
                                last_heartbeat_at, started_local_date, ended_local_date)
    VALUES (${userId}, ${problemId}, 'solved', now() - interval '3 days',
            now() - interval '3 days' + interval '20 minutes', now() - interval '3 days',
            (now() - interval '3 days')::date, (now() - interval '3 days')::date)
    RETURNING id
  `;
  const sessionId = String(session!.id);

  await sql`
    INSERT INTO code_snapshots (session_id, user_id, sequence, language, is_full, content,
                                source_bytes, trigger, occurred_at)
    VALUES (${sessionId}, ${userId}, 0, 'cpp17', true, ${`int main() { /* ${PREVIOUS_CODE} */ }`},
            64, 'run_attempt', now() - interval '3 days' + interval '10 minutes')
  `;
  // The timeline attaches snapshots to `code_snapshot` events by order, so the
  // row above only renders on /sessions/[id] with its event beside it.
  await sql`
    INSERT INTO session_events (session_id, type, occurred_at)
    VALUES (${sessionId}, 'code_snapshot', now() - interval '3 days' + interval '10 minutes')
  `;
  await sql`
    INSERT INTO stuck_points (session_id, category, elapsed_seconds, note, source)
    VALUES (${sessionId}, 'edge_cases', 300, ${STUCK_NOTE}, 'user')
  `;
  const [reflection] = await sql`
    INSERT INTO reflections (session_id, approach) VALUES (${sessionId}, ${PREVIOUS_NOTE})
    RETURNING id
  `;
  await sql`
    INSERT INTO reflection_mistakes (reflection_id, category)
    VALUES (${String(reflection!.id)}, 'off_by_one')
  `;
  await sql`
    INSERT INTO revision_schedule (user_id, problem_id, interval_days, due_local_date)
    SELECT ${userId}, ${problemId}, 3, timezone(u.timezone, now())::date
    FROM users u WHERE u.id = ${userId}
  `;

  return { problemId, sessionId };
}

test.beforeEach(async ({ context, baseURL }) => {
  await deleteProblems(sql, 'modes-%');
  await cleanup(sql);
  await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });
});

test('the due item shows its last attempt, outcome and mistakes, and offers four modes', async ({
  page,
}) => {
  await seedSolvedAndDue(`modes-ctx-${tag}`);
  await page.goto('/revision');

  await expect(
    page.getByText(/last attempted .* · solved · mistakes: off by one/i),
  ).toBeVisible();
  const modes = page.getByRole('group', { name: /revise .* in a mode/i });
  for (const label of ['Blind retry', 'Mistake-first', 'Pattern set', 'Speed']) {
    await expect(modes.getByRole('button', { name: label })).toBeVisible();
  }
  await expect(page.getByText(/not enough data yet — 0 of 10/i)).toBeVisible();
});

test('POSITIVE CONTROL — the markers ARE in the payload where they belong', async ({
  page,
}) => {
  const { sessionId } = await seedSolvedAndDue(`modes-ctl-${tag}`);

  // The timeline renders the previous attempt's code.
  const timeline = capturePayload(page);
  await page.goto(`/sessions/${sessionId}`);
  await settle(page);
  await timeline.stop();
  expect(timeline.find(PREVIOUS_CODE).length).toBeGreaterThan(0);

  // The problem page renders the approach note and the stuck note.
  const detail = capturePayload(page);
  await page.goto(`/problems/modes-ctl-${tag}`);
  await settle(page);
  await detail.stop();
  expect(detail.find(PREVIOUS_NOTE).length).toBeGreaterThan(0);
  expect(detail.find(STUCK_NOTE).length).toBeGreaterThan(0);
});

test('BLIND RETRY: THE PREVIOUS ATTEMPT IS ABSENT FROM EVERY CLIENT PAYLOAD', async ({
  page,
}) => {
  const slug = `modes-blind-${tag}`;
  const { problemId } = await seedSolvedAndDue(slug);

  // A previous draft in this browser — the other place old code lives.
  await page.goto('/revision');
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [`quadrantcode:draft:${problemId}:cpp17`, PREVIOUS_DRAFT],
  );

  const capture = capturePayload(page);
  await page.getByRole('button', { name: 'Blind retry' }).click();
  await page.waitForURL(`**/problems/${slug}/solve`);
  await expect(page.getByRole('region', { name: /blind retry revision/i })).toBeVisible();
  await triggerPrefetches(page);
  await settle(page);

  // And the problem page, which the timer bar links to from every screen.
  await page.goto(`/problems/${slug}`);
  await expect(page.getByText(/hidden during your blind retry/i)).toBeVisible();
  await triggerPrefetches(page);
  await settle(page);
  await capture.stop();

  expect(capture.responses.length).toBeGreaterThan(0);
  expect(capture.find(PREVIOUS_CODE)).toEqual([]);
  expect(capture.find(PREVIOUS_NOTE)).toEqual([]);
  expect(capture.find(STUCK_NOTE)).toEqual([]);

  // The unscoped draft is untouched, and the sitting's own draft never held it.
  const drafts = await page.evaluate((id) => {
    const out: Record<string, string> = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)!;
      if (key.includes(id)) out[key] = window.localStorage.getItem(key) ?? '';
    }
    return out;
  }, problemId);
  expect(drafts[`quadrantcode:draft:${problemId}:cpp17`]).toBe(PREVIOUS_DRAFT);
  for (const [key, value] of Object.entries(drafts)) {
    if (key.includes(':blind-')) expect(value).not.toContain(PREVIOUS_DRAFT);
  }
});

test('mistake-first briefs the previous mistakes before solving', async ({ page }) => {
  const slug = `modes-mf-${tag}`;
  await seedSolvedAndDue(slug);

  await page.goto('/revision');
  await page.getByRole('button', { name: 'Mistake-first' }).click();
  await page.waitForURL(`**/problems/${slug}/solve`);

  const panel = page.getByRole('region', { name: /mistake-first revision/i });
  await expect(panel.getByText('Off by one')).toBeVisible();
  await expect(panel.getByText(new RegExp(STUCK_NOTE))).toBeVisible();
});

test('speed mode shows the target it recorded', async ({ page }) => {
  const slug = `modes-speed-${tag}`;
  await seedSolvedAndDue(slug);

  await page.goto('/revision');
  await page.getByRole('button', { name: 'Speed' }).click();
  await page.waitForURL(`**/problems/${slug}/solve`);

  // No best time was recorded in the fixture, so the target is the 30-minute estimate.
  const panel = page.getByRole('region', { name: /speed revision/i });
  await expect(panel.getByText(/target\s*30:00/i)).toBeVisible();

  const [row] = await sql`
    SELECT s.revision_mode, s.speed_target_seconds
    FROM solve_sessions s JOIN users u ON u.id = s.user_id
    WHERE u.email = ${EMAIL} AND s.status IN ('active', 'paused')
  `;
  expect(row!.revision_mode).toBe('speed');
  expect(Number(row!.speed_target_seconds)).toBe(1_800);
});
