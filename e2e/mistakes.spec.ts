/**
 * F3.5 · the mistakes pages in a browser.
 *
 * Criterion 4 — "every weekly-plan recommendation displays its reason" — is a
 * claim about a rendered page, so it is settled here rather than only at the
 * data layer.
 *
 * Criterion 6's "PDF matches the HTML" is asserted the only way that claim can
 * be asserted about this design: the print stylesheet exists, and the report is
 * the document it prints. There is no second renderer to compare against, which
 * is the point.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'mistakes@e2e.test';
const SLUG = 'mis-binary-search-style';

test.beforeAll(async () => {
  sql = db();
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, 'Mistakes fixture', 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'medium', 'published')
    ON CONFLICT (slug) DO NOTHING
  `;
  const [problem] = await sql`SELECT id FROM problems WHERE slug = ${SLUG}`;
  await sql`
    INSERT INTO problem_tags (problem_id, tag_type, tag_value)
    VALUES (${String(problem!['id'])}, 'topic', 'binary-search')
    ON CONFLICT DO NOTHING
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

/** Three sessions, each with a reflection recording the same mistake. */
async function seedMistakes(): Promise<void> {
  const [user] = await sql`SELECT id FROM users WHERE email = ${EMAIL}`;
  const [problem] = await sql`SELECT id FROM problems WHERE slug = ${SLUG}`;

  for (let n = 0; n < 4; n += 1) {
    const [session] = await sql`
      INSERT INTO solve_sessions
        (user_id, problem_id, status, started_at, ended_at, started_local_date, ended_local_date)
      VALUES (${String(user!['id'])}, ${String(problem!['id'])}, 'solved',
              now() - (${n * 3} || ' days')::interval,
              now() - (${n * 3} || ' days')::interval + interval '10 minutes',
              (now() - (${n * 3} || ' days')::interval)::date,
              (now() - (${n * 3} || ' days')::interval)::date)
      RETURNING id
    `;

    const [reflection] = await sql`
      INSERT INTO reflections (session_id, approach, created_at)
      VALUES (${String(session!['id'])}, 'x', now() - (${n * 3} || ' days')::interval)
      RETURNING id
    `;

    await sql`
      INSERT INTO reflection_mistakes (reflection_id, category)
      VALUES (${String(reflection!['id'])}, 'off_by_one')
    `;
  }
}

test('the recurring panel counts what the user recorded', async ({ page }) => {
  await seedMistakes();
  await page.goto('/mistakes');

  const panel = page.getByRole('list', { name: 'Your recurring mistakes' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Off by one/)).toBeVisible();
  await expect(panel.getByText(/4 times/)).toBeVisible();
});

test('EVERY RECOMMENDATION DISPLAYS ITS REASON', async ({ page }) => {
  await seedMistakes();
  await page.goto('/mistakes');

  const plan = page.getByRole('list', { name: "This week's focus" });
  await expect(plan).toBeVisible();

  const items = plan.getByRole('listitem');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);

  // The criterion: not "a reason exists somewhere", but one per row.
  for (let index = 0; index < count; index += 1) {
    await expect(items.nth(index).getByText(/has come up \d+ times/)).toBeVisible();
  }
});

test('says so out loud when there is nothing to recommend', async ({ page }) => {
  // No seeding. An empty panel would read like a bug.
  await page.goto('/mistakes');
  await expect(page.getByText(/nothing has come up often enough/i)).toBeVisible();
});

test('THE REPORT AND THE PANEL SHOW THE SAME NUMBERS', async ({ page }) => {
  await seedMistakes();

  /*
   * Scoped to the panel on both pages. The plan's reason also says "4 times" —
   * deliberately, since the reason must name the count — so an unscoped locator
   * matches twice and strict mode refuses.
   */
  const panel = (target: typeof page) =>
    target.getByRole('list', { name: 'Your recurring mistakes' });

  await page.goto('/mistakes');
  await expect(panel(page).getByText(/4 times/)).toBeVisible();

  await page.goto('/mistakes/report');
  // Same component, same aggregate — which is what "matches" means here.
  await expect(panel(page).getByText(/4 times/)).toBeVisible();
  await expect(page.getByRole('button', { name: /save as pdf/i })).toBeVisible();
});

test('the report hides the shell when printed', async ({ page }) => {
  await seedMistakes();
  await page.goto('/mistakes/report');

  // `emulateMedia` is the closest a test gets to a printer, and it is enough to
  // prove the print rules apply rather than merely being present in the CSS.
  await page.emulateMedia({ media: 'print' });

  await expect(page.getByRole('button', { name: /save as pdf/i })).toBeHidden();
  // And the content survives — a print stylesheet that hid everything would
  // also pass the assertion above.
  await expect(page.getByText(/Off by one/)).toBeVisible();
});
