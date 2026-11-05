/**
 * Step A1 · baseline for the solve screen's editor half, as it is today.
 *
 * The v2 solve screen (FEATURE_SOLVE_V2) must keep every capability of this
 * one. These four had no test at all (the step-1 inventory), so a regression in
 * any of them would have been invisible. This file pins their CURRENT
 * behaviour with the flag off and no UI change; later steps run the same file
 * against v2.
 *
 *   · a draft is restored per problem AND per language
 *   · Reset code puts the starter back, and the starter becomes the draft
 *   · the execution limits are printed, from the same constant the runner sends
 *   · a refused run says why, and leaves no job behind
 *
 * Drafts are seeded through localStorage rather than typed: Monaco renders to a
 * structure Playwright cannot type into reliably, and the restore path is the
 * thing under test anyway.
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { LANGUAGE_STARTERS } from '../lib/execution/languages';
import { draftKey } from '../lib/execution/view';
import { EXECUTION_LIMITS } from '../server/services/execution/provider';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const EMAIL = 'a1-editor@e2e.test';
const SLUG = 'a1-editor-alpha';
/** One token, no spaces: Monaco renders spaces as non-breaking ones. */
const DRAFT_TOKEN = 'a1_draft_restore_me';
const DRAFT = `// ${DRAFT_TOKEN}\nint main() { return 0; }\n`;

let sql: ReturnType<typeof postgres>;
let problemId: string;
let userId: string;

test.beforeAll(async () => {
  sql = db();
  await deleteProblems(sql, SLUG);
  const [row] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, 'A1 Editor Alpha', 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'easy', 'published')
    RETURNING id
  `;
  problemId = String(row!['id']);
});

test.afterAll(async () => {
  await deleteProblems(sql, SLUG);
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  userId = await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });
});

const editorText = (page: Page) => page.locator('.monaco-editor .view-lines').first();

/** Seeds a draft before any page script runs, exactly where RunPanel reads it. */
async function seedDraft(page: Page, language: 'cpp17' | 'python3', source: string) {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    draftKey(problemId, language),
    source,
  ] as const);
}

test('A DRAFT IS RESTORED, per problem and per language', async ({ page }) => {
  await seedDraft(page, 'cpp17', DRAFT);
  await page.goto(`/problems/${SLUG}/solve`);

  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
  await expect(editorText(page)).toContainText(DRAFT_TOKEN);

  // Another language has its own draft — here none, so its starter.
  await page.getByLabel('Language').selectOption('python3');
  await expect(editorText(page)).toContainText('__main__');
  await expect(editorText(page)).not.toContainText(DRAFT_TOKEN);

  // And switching back does not lose the first one.
  await page.getByLabel('Language').selectOption('cpp17');
  await expect(editorText(page)).toContainText(DRAFT_TOKEN);
});

test('RESET CODE PUTS THE STARTER BACK, and the starter becomes the draft', async ({
  page,
}) => {
  // The draft is written 500 ms after the last change; the clock makes that
  // moment explicit instead of waiting it out.
  await page.clock.install();
  await seedDraft(page, 'cpp17', DRAFT);
  await page.goto(`/problems/${SLUG}/solve`);

  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
  await expect(editorText(page)).toContainText(DRAFT_TOKEN);

  await page.getByRole('button', { name: 'Reset code' }).click();

  await expect(editorText(page)).not.toContainText(DRAFT_TOKEN);
  await expect(editorText(page)).toContainText('bits/stdc++.h');

  await page.clock.fastForward(600);
  await expect
    .poll(() =>
      page.evaluate((key) => window.localStorage.getItem(key), draftKey(problemId, 'cpp17')),
    )
    .toBe(LANGUAGE_STARTERS.cpp17);
});

test('THE EXECUTION LIMITS ARE PRINTED, from the constant the runner sends', async ({
  page,
}) => {
  await page.goto(`/problems/${SLUG}/solve`);

  // Built from EXECUTION_LIMITS, not typed out: if the limits change, this must
  // still describe what is sent, and a hard-coded string would just go stale.
  const expected =
    `${EXECUTION_LIMITS.cpuSeconds}s CPU · ${EXECUTION_LIMITS.wallSeconds}s wall · ` +
    `${EXECUTION_LIMITS.memoryKb / 1024} MB · no network · ` +
    `${EXECUTION_LIMITS.maxOutputBytes / 1024} KB output`;

  await expect(page.getByText(expected, { exact: true })).toBeVisible();
});

test('A REFUSED RUN SAYS WHY, and leaves no job behind', async ({ page }) => {
  // Five live runs is the per-user concurrency cap (CONCURRENT_LIMIT).
  const seeded = await sql`
    INSERT INTO execution_jobs (user_id, problem_id, language, status, source)
    SELECT ${userId}, ${problemId}, 'cpp17', 'queued', 'int main() {}'
    FROM generate_series(1, 5)
    RETURNING id
  `;
  const before =
    await sql`SELECT count(*)::int AS n FROM execution_jobs WHERE user_id = ${userId}`;

  try {
    await page.goto(`/problems/${SLUG}/solve`);
    await page.getByRole('button', { name: /^run code$/i }).click();

    const refusal = page.getByTestId('run-refusal');
    await expect(refusal).toBeVisible();
    await expect(refusal).toHaveText(/already have 5 runs in flight/i);
    // The button is not left claiming a run is queued.
    await expect(page.getByRole('button', { name: /^run code$/i })).toBeEnabled();

    const [after] = await sql`
      SELECT count(*)::int AS n FROM execution_jobs WHERE user_id = ${userId}
    `;
    expect(after!['n'], 'a refused submission must not write a row').toBe(before[0]!['n']);
  } finally {
    await sql`DELETE FROM execution_jobs WHERE id IN ${sql(seeded.map((row) => row['id']))}`;
  }
});
