/**
 * The catalog's topic view and problem numbers, in a browser.
 *
 * `tests/problems/topics.test.ts` proves the grouping and order the service
 * returns. This proves the page shows them: the topic view is what /problems
 * opens on, a topic's "See all" lands on that topic's list easiest first, and
 * each row carries its number.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const TOPIC = 'e2e-topic-ordering';

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  // Shared catalog: keyboard.spec.ts counts tab stops on /problems.
  await deleteProblems(sql, 'topv-%');
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await deleteProblems(sql, 'topv-%');
  await signInAs(context, sql, { email: 'topics@e2e.test', baseUrl: baseURL! });

  // Seven problems, inserted hard first, so the number order and the
  // difficulty order disagree and only a real sort puts the easy ones first.
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    SELECT 'topv-' || i, 'Topic View ' || i, 'external_link', 'leetcode',
           'https://leetcode.com/problems/topv-' || i || '/',
           (ARRAY['hard','medium','easy']::difficulty[])[1 + (i % 3)], 'published'
    FROM generate_series(1, 7) AS i
  `;
  await sql`
    INSERT INTO problem_tags (problem_id, tag_type, tag_value)
    SELECT id, 'topic'::problem_tag_type, ${TOPIC} FROM problems WHERE slug LIKE 'topv-%'
  `;
});

test('/problems opens on the topic view, with counts and numbered rows', async ({ page }) => {
  await page.goto('/problems');

  const section = page.locator(`#topic-${TOPIC}`);
  await expect(section.getByRole('heading', { name: 'E2e Topic Ordering' })).toBeVisible();
  await expect(section.getByText(/7 problems/)).toBeVisible();

  // Five shown, easiest first.
  const rows = section.getByRole('listitem');
  await expect(rows).toHaveCount(5);
  await expect(rows.first().getByText('Easy')).toBeVisible();
  await expect(rows.first()).toContainText(/#\d+/);

  await expect(page.getByRole('link', { name: 'By topic' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('"See all" lists the whole topic, easiest first', async ({ page }) => {
  await page.goto('/problems');
  await page
    .locator(`#topic-${TOPIC}`)
    .getByRole('link', { name: /see all 7/i })
    .click();

  await expect(page).toHaveURL(new RegExp(`topic=${TOPIC}`));
  await expect(page.getByLabel('Filter by topic')).toHaveValue(TOPIC);

  const table = page.getByRole('table');
  await expect(table.getByRole('link', { name: /Topic View/ })).toHaveCount(7);
  const difficulties = await table
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelectorAll('td')[3]?.textContent?.trim()),
    );
  const rank: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };
  const ranks = difficulties.map((label) => rank[label ?? ''] ?? 99);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
});

test('All problems shows the table, and Apply keeps the reader on it', async ({ page }) => {
  await page.goto('/problems');
  await page.getByRole('link', { name: 'All problems' }).click();

  await expect(page).toHaveURL(/view=all/);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '#' })).toBeVisible();

  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('table')).toBeVisible();
});
