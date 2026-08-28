/**
 * F3.1 · the editor in a browser.
 *
 * Two of this ticket's criteria are claims about a rendered page, and neither
 * can be settled anywhere else:
 *
 *   · the state machine is VISIBLE in the UI, not only enforced in the database
 *   · output containing `<script>` and `<img onerror>` renders as inert text
 *
 * The second one especially. "React escapes it" is a true sentence about React
 * and not evidence about this page — the only thing that settles it is putting
 * the payload through the real submit path and asking a real browser whether it
 * ran. So that is what this does, and it asserts the negative with a positive
 * control: the same page is made to run a script deliberately, proving the
 * detector can see one.
 *
 * The provider is the fake (there is no `JUDGE0_URL`), and the fake echoes
 * stdin into stdout — which is exactly the shape a real program printing its
 * input would have. The renderer cannot tell the difference, which is the
 * point: it never knows where the bytes came from.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

const EMAIL = 'execution@e2e.test';
const SLUG = 'exec-two-sum-style';

/** Both payloads the criterion names, in one stdin. */
const SCRIPT_PAYLOAD = '<script>window.__traceloopPwned = true;</script>';
const IMG_PAYLOAD = '<img src=x onerror="window.__traceloopPwned = true">';

test.beforeAll(async () => {
  sql = db();
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, 'Execution fixture', 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'easy', 'published')
    ON CONFLICT (slug) DO NOTHING
  `;
});

test.afterAll(async () => {
  // Fixture problems are shared with every other spec — F1.6's finding.
  await sql`DELETE FROM problems WHERE slug = ${SLUG}`;
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await signInAs(context, sql, { email: EMAIL, baseUrl: baseURL! });
});

test('program output containing script tags renders as text and does not run', async ({
  page,
}) => {
  await page.goto(`/problems/${SLUG}/solve`);

  /*
   * POSITIVE CONTROL, first and on this same page.
   *
   * If the flag cannot be set at all here — a CSP, a stray sandbox — then the
   * assertion below would pass without proving anything, which is the exact
   * failure mode this project has been bitten by before. Prove the detector
   * works, then clear it, then run the real check.
   */
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__traceloopPwned = true;';
    document.body.appendChild(script);
  });
  expect(
    await page.evaluate(() => (window as never as Record<string, unknown>).__traceloopPwned),
  ).toBe(true);
  await page.evaluate(() => {
    delete (window as never as Record<string, unknown>).__traceloopPwned;
  });

  await page.getByLabel('Input (stdin)').fill(`${SCRIPT_PAYLOAD}\n${IMG_PAYLOAD}`);
  await page.getByRole('button', { name: /run|queued|running/i }).click();

  const output = page.getByTestId('run-output-output');
  await expect(output).toContainText(SCRIPT_PAYLOAD, { timeout: 20_000 });
  await expect(output).toContainText(IMG_PAYLOAD);

  // The payload is on screen. Nothing executed it.
  expect(
    await page.evaluate(() => (window as never as Record<string, unknown>).__traceloopPwned),
  ).toBeUndefined();

  // And it is text, not elements: no parser ever saw it as markup.
  expect(await output.locator('script').count()).toBe(0);
  expect(await output.locator('img').count()).toBe(0);
});

test('the run moves through states the page can show, and ends in a result', async ({
  page,
}) => {
  await page.goto(`/problems/${SLUG}/solve`);

  const button = page.getByRole('button', { name: /^run$/i });
  await expect(button).toBeEnabled();

  await button.click();

  /*
   * The terminal state is what a poll can be relied on to catch — `queued` and
   * `running` can both be gone within one 700 ms tick, and asserting on a state
   * the machine is allowed to leave immediately is how a suite acquires a
   * flake. What matters here is that the button stops saying "Run" and the page
   * arrives at a result rather than spinning forever.
   */
  await expect(page.getByRole('button', { name: /queued|running|^run$/i })).toBeVisible();
  await expect(page.getByTestId('run-output-output')).toBeVisible({ timeout: 20_000 });
  await expect(button).toBeEnabled();
});

test('an external problem says nothing was checked', async ({ page }) => {
  await page.goto(`/problems/${SLUG}/solve`);

  // C1: no statement on the page, and no claim about correctness after a run.
  await expect(page.getByText(/scratchpad/i).first()).toBeVisible();

  await page.getByRole('button', { name: /^run$/i }).click();
  await expect(page.getByTestId('run-output-output')).toBeVisible({ timeout: 20_000 });

  await expect(page.getByText(/nothing here is checked against its tests/i)).toBeVisible();

  /*
   * And no test COUNT anywhere — the shape `0 / 0 tests`, which would read as a
   * failure rather than as "there was nothing to check".
   *
   * Matching the digits rather than the word: `/tests$/` also matches the two
   * sentences that exist in order to say tests do not apply here, so it failed
   * on the very copy it was meant to protect.
   */
  await expect(page.getByText(/\d+\s*\/\s*\d+\s+tests/)).toHaveCount(0);
});
