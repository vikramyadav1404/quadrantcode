/**
 * F0.5 · the two criteria that need a browser.
 *
 * Both were recorded PARTIAL / NOT VERIFIED in docs/acceptance-status.md
 * because a unit test cannot answer either question: whether a string is
 * *rendered* as text rather than executed, and whether an optimistic UI rolls
 * back when the network stalls.
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

test('a bio containing <script> renders as visible plain text', async ({
  context,
  page,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, { email: 'xss@e2e.test', baseUrl: baseURL! });

  const payload = '<script>alert(1)</script>';
  await sql`
    UPDATE user_profiles SET display_name = 'XSS Tester', bio = ${payload}
    WHERE user_id = ${userId}
  `;

  // If the payload ever executed, this would fire and fail the test.
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto('/settings/profile');

  // exact: the public-profile disclosure begins "Your display name, avatar…",
  // so a loose label query also matches that checkbox.
  const bio = page.getByLabel('Bio', { exact: true });
  await expect(bio).toBeVisible();

  // The literal characters are present as a VALUE, not as markup.
  await expect(bio).toHaveValue(payload);

  /*
   * The payload must not have become an EXECUTABLE script element.
   *
   * Counting inline scripts is the wrong check and my first attempt used it:
   * Next.js legitimately inlines several (the theme bootstrap, RSC flight
   * data), and the flight payload contains the bio string escaped as JSON —
   * which is data, not code. The precise question is whether any script
   * element's body IS the payload's body.
   */
  const executableCopies = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('script:not([src])')).filter(
        (element) => (element.textContent ?? '').trim() === 'alert(1)',
      ).length,
  );
  const executed = await page.evaluate(() => (window as { __xss?: boolean }).__xss === true);

  expect(dialogs, 'an alert() dialog means the payload executed').toEqual([]);
  expect(executed).toBe(false);
  expect(executableCopies, 'the payload became a live script element').toBe(0);

  // And it survives a round trip through the form without being mangled.
  await expect(page.getByText('/280')).toBeVisible();
});

test('a stalled save rolls back to the last server-confirmed value', async ({
  context,
  page,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, {
    email: 'rollback@e2e.test',
    baseUrl: baseURL!,
  });

  await sql`
    UPDATE user_profiles SET display_name = 'Saved Name' WHERE user_id = ${userId}
  `;

  await page.goto('/settings/profile');

  const nameField = page.getByLabel('Display name', { exact: true });
  await expect(nameField).toHaveValue('Saved Name');

  /*
   * Stall the Server Action past the form's 10s save timeout.
   *
   * Route interception rather than CDP throttling: it targets exactly the
   * request under test and is deterministic, where a bandwidth cap would also
   * slow every asset and make the assertion timing-dependent. The code path is
   * identical — the save promise never settles before the timeout fires.
   */
  await page.route('**/settings/profile', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    await route.abort();
  });

  await nameField.fill('Optimistic Name');
  // Optimistic state is visible immediately, before the server replies.
  await expect(nameField).toHaveValue('Optimistic Name');

  await page.getByRole('button', { name: /save profile/i }).click();

  // After the timeout the field must return to the last CONFIRMED value.
  await expect(nameField).toHaveValue('Saved Name', { timeout: 20_000 });
  await expect(page.getByText(/reverted/i)).toBeVisible();

  // And the database was never written.
  const [row] = await sql`SELECT display_name FROM user_profiles WHERE user_id = ${userId}`;
  expect(row!.display_name).toBe('Saved Name');
});

test('the avatar falls back to initials with a stable colour across reloads', async ({
  context,
  page,
  baseURL,
}) => {
  const userId = await signInAs(context, sql, {
    email: 'initials@e2e.test',
    baseUrl: baseURL!,
  });
  await sql`UPDATE user_profiles SET display_name = 'Vikram Yadav' WHERE user_id = ${userId}`;

  await page.goto('/settings/profile');

  const avatar = page.getByRole('img', { name: 'Your avatar' });
  await expect(avatar).toHaveText('VY');

  const first = await avatar.evaluate((node) => getComputedStyle(node).backgroundColor);

  await page.reload();
  const second = await page
    .getByRole('img', { name: 'Your avatar' })
    .evaluate((node) => getComputedStyle(node).backgroundColor);

  expect(second).toBe(first);
});
