/**
 * F2.1 · the revision queue in a browser.
 *
 * The ladder and the score are proved pure elsewhere, and the wiring is proved
 * against a database. What only a browser shows is whether the page a user
 * actually opens tells them the truth: the reasons beside each item, the honest
 * count when the cap holds work back, and what happens after they answer.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'revision@e2e.test';

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  // Fixture problems are shared with every other spec — see F1.6's finding.
  await sql`DELETE FROM problems WHERE slug LIKE 'rev-%'`;
  await cleanup(sql);
  await sql.end();
});

/** A problem scheduled as due, `overdueDays` ago. */
async function seedDue(userId: string, slug: string, overdueDays: number) {
  const [problem] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${slug}, ${`Revision ${slug}`}, 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${slug}/`}, 'medium', 'published')
    RETURNING id
  `;

  await sql`
    INSERT INTO revision_schedule (user_id, problem_id, interval_days, due_local_date)
    VALUES (${userId}, ${String(problem!.id)}, 3,
            (now() - (${overdueDays} || ' days')::interval)::date)
  `;

  return String(problem!.id);
}

async function currentUserId(): Promise<string> {
  const [user] = await sql`SELECT id FROM users WHERE email = ${EMAIL}`;
  return String(user!.id);
}

test.beforeEach(async ({ context, baseURL }) => {
  await sql`DELETE FROM problems WHERE slug LIKE 'rev-%'`;
  await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });
});

test('says so plainly when nothing is due', async ({ page }) => {
  await page.goto('/revision');

  await expect(page.getByRole('heading', { name: 'Revision' })).toBeVisible();
  await expect(page.getByText(/nothing due today/i)).toBeVisible();
});

test('EVERY ITEM SHOWS WHY IT IS THERE', async ({ page }) => {
  /*
   * The ordering is a claim, and a claim the user cannot inspect is one they
   * either trust blindly or ignore. The factors are the inspection.
   */
  await seedDue(await currentUserId(), 'rev-alpha', 9);

  await page.goto('/revision');

  await expect(page.getByRole('link', { name: /revision rev-alpha/i })).toBeVisible();
  await expect(page.getByText(/9 days overdue/i)).toBeVisible();
});

test('RECORDING AN OUTCOME SAYS WHEN IT COMES BACK', async ({ page }) => {
  await seedDue(await currentUserId(), 'rev-beta', 2);

  await page.goto('/revision');
  await page.getByRole('button', { name: 'Got it' }).click();

  // The interval is the ladder's answer, computed server-side — the page never
  // sends one.
  await expect(page.getByText(/recorded — back/i)).toBeVisible();

  const [row] = await sql`
    SELECT rs.ladder_index, rs.revision_count
    FROM revision_schedule rs
    JOIN users u ON u.id = rs.user_id
    WHERE u.email = ${EMAIL}
  `;
  expect(Number(row!.ladder_index)).toBe(1);
  expect(Number(row!.revision_count)).toBe(1);
});

test('A LOST REVISION GOES BACK TO TOMORROW', async ({ page }) => {
  await seedDue(await currentUserId(), 'rev-gamma', 1);

  await page.goto('/revision');
  await page.getByRole('button', { name: 'Lost it' }).click();
  await expect(page.getByText(/recorded — back tomorrow/i)).toBeVisible();

  const [row] = await sql`
    SELECT rs.ladder_index, rs.interval_days
    FROM revision_schedule rs
    JOIN users u ON u.id = rs.user_id
    WHERE u.email = ${EMAIL}
  `;
  expect(Number(row!.ladder_index)).toBe(0);
  expect(Number(row!.interval_days)).toBe(1);
});

test('THE CAP HOLDS WORK BACK WITHOUT HIDING IT', async ({ page }) => {
  /*
   * Telling a user they have five when they have eight is the version of this
   * that loses their trust the first time they notice.
   */
  const userId = await currentUserId();
  for (let index = 0; index < 8; index += 1) {
    await seedDue(userId, `rev-many-${index}`, index);
  }

  await page.goto('/revision');

  await expect(page.getByText(/showing 5 of 8 due/i)).toBeVisible();

  // Scoped to the due list by its accessible name: an unscoped `listitem`
  // query counts the sidebar's navigation items too, which is how this first
  // asked for 5 and was handed 12.
  const list = page.getByRole('list', { name: /revisions due today/i });
  await expect(list.getByRole('listitem')).toHaveCount(5);
});
