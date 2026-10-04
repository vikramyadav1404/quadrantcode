/**
 * Step A2 · baseline for the solve screen's problem panel, as it is today.
 *
 * The step-1 inventory found these with no test at all. Pinned here with the
 * flag off and no UI change, so the v2 screen (FEATURE_SOLVE_V2) can be held
 * to the same behaviour:
 *
 *   · Hints on an original problem: collapsed, then revealed
 *   · "Your record", in all three signed-in states
 *   · the Patterns links into the filtered catalog
 *   · the link out to the platform that holds an external problem's statement
 *   · the Submissions tab on /solve, with a finished attempt in it
 *
 * Each test signs in as its own user, so one test's history can never be
 * another's "no history yet".
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { OUTCOME_LABELS } from '../lib/reflection/attempt-view';
import { STUCK_CATEGORY_LABELS } from '../lib/reflection/taxonomy';
import { formatElapsed } from '../lib/session/timer-bar-state';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const EXTERNAL = 'a2-panel-external';
const ORIGINAL = 'a2-panel-original';
const EXTERNAL_URL = `https://leetcode.com/problems/${EXTERNAL}/`;
const HINTS = ['A2 hint one: read the only element.', 'A2 hint two: return it unchanged.'];

let sql: ReturnType<typeof postgres>;
let externalId: string;
let licenseId: string;

test.beforeAll(async () => {
  sql = db();
  await deleteProblems(sql, 'a2-panel-%');

  const [external] = await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${EXTERNAL}, 'A2 Panel External', 'external_link', 'leetcode', ${EXTERNAL_URL},
            'easy', 'published')
    RETURNING id
  `;
  externalId = String(external!['id']);
  await sql`
    INSERT INTO problem_tags (problem_id, tag_type, tag_value)
    VALUES (${externalId}, 'topic', 'arrays'), (${externalId}, 'pattern', 'two-pointers')
  `;

  // An original problem, the smallest version that renders a statement and hints.
  const [license] = await sql`
    INSERT INTO content_licenses
      (provenance, license_name, author, independently_created, review_notes)
    VALUES ('quadrantcode-original', 'A2 baseline fixture license', 'Quadrantcode tests', true,
            'Independently authored browser-test fixture.')
    RETURNING id
  `;
  licenseId = String(license!['id']);
  const [original] = await sql`
    INSERT INTO problems
      (slug, title, source_type, difficulty, estimated_minutes, status, current_version,
       statement, input_format, output_format, constraints_text)
    VALUES (${ORIGINAL}, 'A2 Panel Original', 'original', 'easy', 15, 'published', 1,
            'Return the single supplied integer unchanged.',
            'One signed integer.', 'The same signed integer.', '-100 <= value <= 100')
    RETURNING id
  `;
  await sql`
    INSERT INTO problem_versions
      (problem_id, version, status, problem_type, story, statement, input_format,
       output_format, function_contract, constraints, hints, time_limit_ms,
       memory_limit_kb, content_license_id, provenance, reference_validated_at,
       reference_validation_provider, reference_validation_summary, published_at)
    VALUES
      (${original!['id']}, 1, 'published', 'function',
       'A relay passes one number along exactly as it arrived.',
       'Return the single supplied integer unchanged.',
       'The values array contains exactly one signed integer.',
       'Return that integer.',
       ${JSON.stringify({ functionName: 'solve', parameters: [{ name: 'values', type: 'integer[]', description: 'One integer.' }], returnType: 'integer' })}::jsonb,
       ${JSON.stringify(['values.length = 1'])}::jsonb,
       ${JSON.stringify(HINTS)}::jsonb,
       1500, 128000, ${licenseId}, 'Independent Quadrantcode E2E fixture.', now(),
       'judge0-e2e-contract', ${JSON.stringify({ languages: ['cpp17'], tests: 1, runtimeVersions: {} })}::jsonb, now())
  `;
});

test.afterAll(async () => {
  await deleteProblems(sql, 'a2-panel-%');
  await sql`DELETE FROM content_licenses WHERE id = ${licenseId}`;
  await cleanup(sql);
  await sql.end();
});

/** The "Your record" block on the external problem's description tab. */
const recordOf = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Your record' }) });

test('HINTS start collapsed and are revealed on request (original problem)', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'a2-hints@e2e.test', baseUrl: baseURL! });
  await page.goto(`/problems/${ORIGINAL}/solve`);

  const hints = page.locator('details').filter({ hasText: 'Hints' });
  await expect(hints).toBeVisible();
  await expect(page.getByText(HINTS[0]!)).toBeHidden();

  await hints.locator('summary').click();
  for (const hint of HINTS) await expect(page.getByText(hint)).toBeVisible();
});

test('YOUR RECORD · no history yet: an invitation with its own Start control', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'a2-record-empty@e2e.test', baseUrl: baseURL! });
  await page.goto(`/problems/${EXTERNAL}/solve`);

  const record = recordOf(page);
  await expect(record).toContainText("You haven't started a sitting on this one yet");
  await expect(record.getByRole('button', { name: /start solving/i })).toBeVisible();
});

test('YOUR RECORD · a live sitting on this problem says so instead', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'a2-record-live@e2e.test', baseUrl: baseURL! });
  await page.goto(`/problems/${EXTERNAL}/solve`);

  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await recordOf(page)
    .getByRole('button', { name: /start solving/i })
    .click();
  expect((await started).ok()).toBe(true);

  await expect(recordOf(page)).toContainText('A sitting is running now');
  await expect(recordOf(page).getByRole('button', { name: /start solving/i })).toHaveCount(0);
});

test('YOUR RECORD · with history: status, attempts, best time, dates, confidence', async ({
  page,
  context,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, {
    email: 'a2-record-history@e2e.test',
    baseUrl: baseURL!,
  });
  await sql`
    INSERT INTO user_problems
      (user_id, problem_id, status, total_attempts, best_time_seconds, confidence,
       first_solved_at, last_attempted_at)
    VALUES (${userId}, ${externalId}, 'solved', 3, 754, 'medium',
            now() - interval '3 days', now() - interval '1 day')
  `;
  await page.goto(`/problems/${EXTERNAL}/solve`);

  const record = recordOf(page);
  const value = (label: string) =>
    record
      .locator('dt', { hasText: new RegExp(`^${label}$`) })
      .locator('xpath=following-sibling::dd[1]');

  await expect(value('Status')).toContainText('Solved');
  await expect(value('Attempts')).toHaveText('3');
  await expect(value('Best time')).toHaveText(formatElapsed(754));
  await expect(value('First solved')).not.toBeEmpty();
  await expect(value('Last attempted')).not.toBeEmpty();
  await expect(value('Confidence')).toHaveText('medium');
});

test('PATTERNS link into the filtered catalog, and the first topic is offered too', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'a2-patterns@e2e.test', baseUrl: baseURL! });
  await page.goto(`/problems/${EXTERNAL}/solve`);

  const patterns = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Patterns' }) });
  await expect(patterns.getByRole('link', { name: 'two-pointers' })).toHaveAttribute(
    'href',
    '/problems?pattern=two-pointers',
  );
  await expect(patterns.getByRole('link', { name: 'arrays' })).toHaveAttribute(
    'href',
    '/problems?topic=arrays',
  );
});

test('THE EXTERNAL LINK leads to the platform, in a new tab, without an opener', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'a2-external@e2e.test', baseUrl: baseURL! });
  await page.goto(`/problems/${EXTERNAL}/solve`);

  await expect(page.getByText('This problem is hosted on leetcode')).toBeVisible();
  const out = page.getByRole('link', { name: /read it on leetcode/i });
  await expect(out).toHaveAttribute('href', EXTERNAL_URL);
  await expect(out).toHaveAttribute('target', '_blank');
  await expect(out).toHaveAttribute('rel', /noopener/);
  await expect(out).toHaveAttribute('rel', /noreferrer/);
});

test('THE SUBMISSIONS TAB on /solve lists a finished attempt with its stuck marker', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'a2-submissions@e2e.test', baseUrl: baseURL! });

  // A real sitting, through the UI: start, mark stuck, give up.
  await page.goto(`/problems/${EXTERNAL}`);
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: /start solving/i }).click();
  expect((await started).ok()).toBe(true);

  const timer = page.getByRole('region', { name: /solve session timer/i });
  await expect(timer).toBeVisible();
  await timer.getByRole('button', { name: /i'm stuck/i }).click();
  const dialog = page.getByRole('dialog', { name: /mark where you are stuck/i });
  await dialog.getByLabel('Category').selectOption('edge_cases');
  await dialog.getByRole('button', { name: /mark it/i }).click();
  await expect(timer.getByText('Marked.')).toBeVisible();

  await timer.getByRole('button', { name: /^give up$/i }).click();
  await page.waitForURL('**/reflect');

  await page.goto(`/problems/${EXTERNAL}/solve`);
  await page.getByRole('button', { name: 'Submissions' }).click();

  const attempt = page.getByRole('listitem').filter({ hasText: 'Attempt 1' });
  await expect(attempt).toBeVisible();
  await expect(attempt).toContainText(OUTCOME_LABELS.stuck);
  await expect(attempt).toContainText(`stuck on ${STUCK_CATEGORY_LABELS.edge_cases}`);
});
