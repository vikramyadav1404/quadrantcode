/**
 * F3.3 · the stuck-regions panel in a browser.
 *
 * Criterion 1 — "every inferred stuck point renders with its evidence strings
 * visible" — is a claim about a rendered page, so it is settled here.
 *
 * The fixture writes the inference straight into the table rather than driving
 * a real session through the editor. The signals are proved against synthetic
 * streams in `tests/inference/`, and reproducing four minutes of dwell through
 * Monaco would test Playwright's typing rather than the panel.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'inference@e2e.test';
const SLUG = 'inf-binary-search-style';

test.beforeAll(async () => {
  sql = db();
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, 'Inference fixture', 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'medium', 'published')
    ON CONFLICT (slug) DO NOTHING
  `;
});

test.afterAll(async () => {
  await deleteProblems(sql, SLUG);
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });
});

/**
 * A finished session whose TELEMETRY produces a stuck point.
 *
 * The first version of this seeded the conclusion — a `stuck_points` row — and
 * every test failed with an empty panel. That was the design working: the page
 * re-runs inference on load and rewrites unanswered rows, so a hand-written
 * inference with no telemetry behind it is correctly deleted.
 *
 * So this seeds what a struggling user would leave behind: three snapshots that
 * keep returning to the same few lines over five minutes, with a failed run and
 * no passing one. The inference then finds the region itself, which is a much
 * better test than checking that a row we wrote is displayed.
 */
async function seedSession(): Promise<string> {
  const [user] = await sql`SELECT id FROM users WHERE email = ${EMAIL}`;
  const [problem] = await sql`SELECT id FROM problems WHERE slug = ${SLUG}`;
  const userId = String(user!['id']);

  const [session] = await sql`
    INSERT INTO solve_sessions
      (user_id, problem_id, status, started_at, ended_at, started_local_date, ended_local_date)
    VALUES (${userId}, ${String(problem!['id'])}, 'solved',
            now() - interval '1 hour', now(), current_date, current_date)
    RETURNING id, started_at
  `;
  const sessionId = String(session!['id']);
  const startedAt = session!['started_at'] as Date;

  const NEWLINE = String.fromCharCode(10);
  const base = Array.from({ length: 24 }, (_, n) => `  line ${n + 1}`);
  const versions = [
    base.join(NEWLINE),
    // Line 18 rewritten...
    base.map((line, n) => (n === 17 ? '  while lo < hi:' : line)).join(NEWLINE),
    // ...then 19...
    base
      .map((line, n) => (n === 17 ? '  while lo < hi:' : n === 18 ? '  mid = lo + hi' : line))
      .join(NEWLINE),
    // ...then 18 again. The revisit is what makes this dwelling rather than
    // progress down the file.
    base
      .map((line, n) => (n === 17 ? '  while lo <= hi:' : n === 18 ? '  mid = lo + hi' : line))
      .join(NEWLINE),
  ];

  for (const [index, source] of versions.entries()) {
    const at = new Date(startedAt.getTime() + index * 120_000);

    await sql`
      INSERT INTO code_snapshots
        (session_id, user_id, sequence, language, is_full, content, source_bytes, trigger, occurred_at)
      VALUES (${sessionId}, ${userId}, ${index}, 'python3', true, ${source},
              ${Buffer.byteLength(source, 'utf8')}, 'run_attempt', ${at})
    `;

    await sql`
      INSERT INTO session_events (session_id, type, occurred_at)
      VALUES (${sessionId}, 'code_snapshot', ${at})
    `;
  }

  // A failure and no pass — a green run inside the window would (correctly)
  // suppress the signal. Two statements rather than a data-modifying CTE: an
  // `INSERT ... RETURNING` is not a subquery, which the first attempt assumed.
  const [job] = await sql`
    INSERT INTO execution_jobs
      (user_id, problem_id, session_id, language, status, source, finished_at)
    VALUES (${userId}, ${String(problem!['id'])}, ${sessionId}, 'python3', 'completed', 'x', now())
    RETURNING id
  `;

  await sql`
    INSERT INTO run_attempts
      (job_id, user_id, problem_id, session_id, language, verdict, created_at)
    VALUES (${String(job!['id'])}, ${userId}, ${String(problem!['id'])}, ${sessionId},
            'python3', 'wrong_answer', ${new Date(startedAt.getTime() + 200_000)})
  `;

  return sessionId;
}

test('EVERY INFERRED POINT RENDERS ITS EVIDENCE', async ({ page }) => {
  const sessionId = await seedSession();
  await page.goto(`/sessions/${sessionId}`);

  const panel = page.getByRole('list', { name: 'Possible stuck points' });
  await expect(panel).toBeVisible();

  // The criterion: the sentences behind the label are on screen, not the label
  // alone — a confidence with no evidence is a number nobody can argue with.
  await expect(panel.getByText(/edits stayed around lines/)).toBeVisible();
  await expect(panel.getByText(/no run passed during that stretch/)).toBeVisible();
});

test('THE WORDING HEDGES, AND NAMES A RANGE RATHER THAN A LINE', async ({ page }) => {
  const sessionId = await seedSession();
  await page.goto(`/sessions/${sessionId}`);

  // C4, on the rendered page rather than in a source grep.
  await expect(page.getByText(/a stuck point around lines \d+–\d+/i)).toBeVisible();
  await expect(page.getByText(/you got stuck at/i)).toHaveCount(0);
  await expect(page.getByText(/\bdetected\b/i)).toHaveCount(0);
});

test('confirming persists across a reload', async ({ page }) => {
  const sessionId = await seedSession();
  await page.goto(`/sessions/${sessionId}`);

  await page.getByRole('button', { name: /yes, i was stuck here/i }).click();
  await expect(page.getByText(/you confirmed this/i)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/you confirmed this/i)).toBeVisible();
});

test('DISMISSING PERSISTS, AND SAYS IT COUNTS FOR NOTHING', async ({ page }) => {
  const sessionId = await seedSession();
  await page.goto(`/sessions/${sessionId}`);

  /*
   * Scoped to the panel. The section's own intro also says "counts for
   * nothing" — deliberately, since the user should know that before they press
   * anything — so an unscoped locator matches two elements and strict mode
   * refuses. Same shape as F2.1's duplicated "9 days overdue".
   */
  const panel = page.getByRole('list', { name: 'Possible stuck points' });

  await page.getByRole('button', { name: /no, i wasn/i }).click();
  await expect(panel.getByText(/counts for nothing/i)).toBeVisible();

  await page.reload();
  await expect(panel.getByText(/counts for nothing/i)).toBeVisible();

  // And the re-run on page load did not re-propose it.
  const [row] = await sql`
    SELECT status FROM stuck_points WHERE session_id = ${sessionId}
  `;
  expect(String(row!['status'])).toBe('dismissed');
});

test('adjusting the range persists the new lines', async ({ page }) => {
  const sessionId = await seedSession();
  await page.goto(`/sessions/${sessionId}`);

  await page.getByRole('button', { name: /adjust the lines/i }).click();
  await page.getByLabel('From line').fill('30');
  await page.getByLabel('To line').fill('34');
  await page.getByRole('button', { name: /save the range/i }).click();

  await expect(page.getByText(/you confirmed this/i)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/around lines 30–34/)).toBeVisible();
});
