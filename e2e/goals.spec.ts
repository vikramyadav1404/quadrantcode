/**
 * F1.3 · the timezone copy on /settings/goals.
 *
 * D18 decides that a recorded day never moves: changing timezone affects future
 * activity only. That behaviour is correct and it looks like a bug — a shift can
 * make the same local date appear twice or make a day look skipped — so the
 * decision record commits to explaining it **before the user saves**, not after,
 * because afterwards they are already looking at a history that appears wrong.
 *
 * This spec exists because that commitment was written down and asserted
 * nowhere. Copy that only a human remembers to check is copy that quietly
 * disappears in a refactor, and the failure is silent: the page still works,
 * the streak is still right, and the user is left reading their own history as
 * evidence of a defect.
 *
 * It is a browser test rather than a unit test because the claim is about
 * WHEN the text appears — on change, before submit — which is a rendering
 * behaviour, not a function's return value.
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  await cleanup(sql);
  await sql.end();
});

test.beforeEach(async ({ context, baseURL }) => {
  await signInAs(context, sql, { email: 'goals@e2e.test', baseUrl: baseURL! });
});

test('the timezone consequence is stated on change, before saving', async ({ page }) => {
  await page.goto('/settings/goals');

  const timezone = page.getByLabel(/timezone/i);
  await expect(timezone).toBeVisible();

  /*
   * Located by the id the field's `aria-describedby` points at, not by its
   * text. The copy's first sentence sits inside a <strong>, so a text locator
   * resolves to that element and the later assertions — which are about
   * sentences in the parent — would fail against a paragraph that is present
   * and correct.
   */
  const note = page.locator('#timezone-effect');

  // Nothing has changed yet, so there is nothing to warn about. Showing the
  // note unconditionally would train the user to scroll past it.
  await expect(note).toBeHidden();

  await timezone.fill('America/New_York');

  /*
   * Visible WITHOUT a save. The save button is deliberately not clicked here:
   * the whole point of D18's mitigation is that the user reads this while they
   * can still change their mind.
   */
  await expect(note).toBeVisible();
  await expect(note).toContainText(/your past days stay as recorded/i);
  await expect(note).toContainText(/only days from now on use the new timezone/i);

  // The specific consequence, not just a reassurance. "Your history is fine"
  // without naming what they will see is the version that reads as a brush-off.
  await expect(note).toContainText(/appear twice or look skipped/i);
});

test('the note is associated with the field, not merely near it', async ({ page }) => {
  /*
   * A screen-reader user moving through the form by field would otherwise never
   * meet the explanation — it would be a paragraph somewhere after the input.
   * `aria-describedby` appears only once there is something to describe.
   */
  await page.goto('/settings/goals');

  const timezone = page.getByLabel(/timezone/i);
  await expect(timezone).not.toHaveAttribute('aria-describedby', /.+/);

  await timezone.fill('Europe/Berlin');

  await expect(timezone).toHaveAttribute('aria-describedby', 'timezone-effect');
  await expect(page.locator('#timezone-effect')).toBeVisible();
});

test('fields that are captured but not acting say so', async ({ page }) => {
  /*
   * `min_medium` and the reminder time are both stored and neither changes
   * anything today: the completion rule consults neither (`rules.ts`), and
   * F2.4 — which would send the reminder — is cut. Letting a user infer that a
   * setting affects their streak when it does not is the same class of harm as
   * the unexplained timezone shift, arrived at from the other direction.
   */
  await page.goto('/settings/goals');

  await expect(page.getByText(/does not currently affect whether a day counts/i)).toBeVisible();
  await expect(page.getByText(/reminders are not sent yet/i)).toBeVisible();
});
