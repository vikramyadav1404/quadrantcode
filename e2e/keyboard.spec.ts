/**
 * F0.4 · keyboard traversal — the criterion carried as PARTIAL through F0.4
 * and F0.5.
 *
 * It stayed partial because there was nothing worth traversing: Phase 0 had no
 * list route and no multi-step flow. Both now exist, so it is closable rather
 * than deferrable a third time.
 *
 * Three things are asserted at every stop, because "reachable by keyboard" is
 * three separate claims:
 *   ORDER    — focus moves in the order the content reads
 *   NO TRAP  — focus can always continue forwards and backwards
 *   VISIBLE  — the focused element has a ring a sighted keyboard user can see
 *
 * A "focus ring" assertion is easy to fake: `:focus-visible` styling is in a
 * stylesheet, so checking that the rule exists proves nothing about whether it
 * applies. These read the COMPUTED style of the actually-focused element.
 */
import { type Page, expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
  /*
   * The `kb-` problems too, not just the users.
   *
   * This spec inserted two problems and never removed them, so they accumulated
   * in the catalog every other spec walks — and showed up as phantom rows in a
   * screenshot of the problems page, which is how they were noticed at all.
   *
   * It is the same leak `demo-seed.ts` had, and the irony is that THIS spec is
   * the one that caught the demo-seed version: extra catalog rows push its own
   * fixtures past the tab budget below. It was one seed away from failing
   * itself. `execution.spec.ts` already did this correctly — F1.6's finding.
   */
  await deleteProblems(sql, 'kb-%');
  await cleanup(sql);
  await sql.end();
});

/**
 * Moves the sequential-focus starting point back to the top of the document.
 *
 * Two obvious approaches are both wrong, and both were tried:
 *
 *   - `body.click({ position: { x: 1, y: 1 } })` lands ON the sr-only skip
 *     link, which is a 1x1 clipped element at the top-left — so the next Tab
 *     moves PAST the very element under test.
 *   - `activeElement.blur()` clears the active element but NOT Chromium's
 *     sequential navigation starting point, so tabbing resumes from wherever
 *     focus had been rather than from the top.
 *
 * Making `body` focusable and focusing it moves the starting point for real.
 */
async function resetFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
}

/** A label for whatever currently has focus, for readable failure messages. */
async function focusedDescriptor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return '(body)';
    /*
     * `||`, not `??`. `el.id` is '' rather than null on an element without an
     * id, so a `??` chain stops there and every label came back empty — which
     * made the reachability matchers below silently match nothing.
     */
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('name') ||
      el.id ||
      (el.textContent ?? '').trim().slice(0, 30);
    return `${el.tagName.toLowerCase()}${label ? `[${label}]` : ''}`;
  });
}

/**
 * Is the focused element visibly ringed?
 *
 * Accepts an outline OR a box-shadow, since either is a legitimate ring, but
 * requires one of them to be present and non-zero — `outline: none` with
 * nothing replacing it is the failure this catches.
 */
async function focusedHasVisibleRing(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;

    const style = getComputedStyle(el);
    const outlineWidth = Number.parseFloat(style.outlineWidth || '0');
    const hasOutline = outlineWidth > 0 && style.outlineStyle !== 'none';
    const hasShadow = style.boxShadow !== 'none' && style.boxShadow.length > 0;
    return hasOutline || hasShadow;
  });
}

/**
 * Tabs up to `steps` times, recording each stop.
 *
 * Stops early once focus leaves the document — reaching `(body)` means the tab
 * ring has wrapped past the browser chrome, and counting that as an unringed
 * stop would fail every page with fewer controls than `steps`.
 */
async function walk(page: Page, steps: number) {
  const stops: Array<{ element: string; ringed: boolean }> = [];

  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press('Tab');
    const element = await focusedDescriptor(page);
    if (element === '(body)') break;

    stops.push({ element, ringed: await focusedHasVisibleRing(page) });
  }

  return stops;
}

test('/login is fully keyboard operable', async ({ page }) => {
  await page.goto('/login');
  await resetFocus(page);

  // Exactly three tabbable stops: skip link, email, submit. Tabbing further
  // would land on (body) as focus leaves the document, which is not a missing
  // focus ring.
  const stops = await walk(page, 8);

  // The skip link comes first — that is what makes it useful.
  expect(stops[0]?.element).toContain('a');

  const emailReached = stops.some((stop) => stop.element.includes('email'));
  const submitReached = stops.some((stop) => stop.element.toLowerCase().includes('button'));
  expect(emailReached, `never reached the email field: ${JSON.stringify(stops)}`).toBe(true);
  expect(submitReached, `never reached submit: ${JSON.stringify(stops)}`).toBe(true);

  for (const stop of stops) {
    expect(stop.ringed, `no visible focus ring on ${stop.element}`).toBe(true);
  }
});

test('/login can be submitted without touching the mouse', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email address').focus();
  await page.keyboard.type('keyboard@e2e.test');
  await page.keyboard.press('Enter');

  // Enter in a single-field form submits it; the panel replaces the form.
  await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({
    timeout: 15_000,
  });
});

test('the check-email panel keeps focus reachable, including resend', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('panel@e2e.test');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({
    timeout: 15_000,
  });

  await resetFocus(page);
  const stops = await walk(page, 8);

  const reachedResend = stops.some((stop) => /resend|wait/i.test(stop.element));
  expect(reachedResend, `resend unreachable: ${JSON.stringify(stops)}`).toBe(true);
  for (const stop of stops) expect(stop.ringed, stop.element).toBe(true);
});

test('/login/verify error states are keyboard operable', async ({ page }) => {
  // An invalid token renders the "not valid" state, which offers a resend.
  await page.goto('/login/verify?token=not-a-real-token&email=nobody@e2e.test');
  await expect(page.getByRole('heading', { name: /isn't valid/i })).toBeVisible();

  await resetFocus(page);
  const stops = await walk(page, 5);

  for (const stop of stops) expect(stop.ringed, stop.element).toBe(true);
  expect(stops.some((stop) => /back to sign in|resend|send a new/i.test(stop.element))).toBe(
    true,
  );
});

test('/onboarding is completable by keyboard alone', async ({ context, page, baseURL }) => {
  const userId = await signInAs(context, sql, {
    email: 'kb-onboarding@e2e.test',
    baseUrl: baseURL!,
    onboarded: false,
  });

  await page.goto('/onboarding');
  await resetFocus(page);

  const stops = await walk(page, 8);
  for (const stop of stops) expect(stop.ringed, stop.element).toBe(true);

  // Now actually complete it without the mouse.
  //
  // Select-all first: the field is PRE-FILLED with a name suggested from the
  // email local part, so typing straight into it appends rather than replaces.
  await page.getByLabel(/what should we call you/i).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Keyboard User');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // past timezone, keeping its value
  await page.keyboard.press('Tab'); // to the role select

  await page.getByRole('button', { name: /start tracking/i }).focus();
  expect(await focusedHasVisibleRing(page)).toBe(true);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/dashboard/);

  const [row] = await sql`SELECT display_name FROM user_profiles WHERE user_id = ${userId}`;
  expect(row!.display_name).toBe('Keyboard User');
});

test('/problems traverses in order, with no trap and a ring at every stop', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'kb-problems@e2e.test', baseUrl: baseURL! });

  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES
      ('kb-alpha', 'Keyboard Alpha', 'external_link', 'leetcode', 'https://leetcode.com/problems/kb-alpha/', 'easy', 'published'),
      ('kb-beta',  'Keyboard Beta',  'external_link', 'leetcode', 'https://leetcode.com/problems/kb-beta/',  'medium', 'published')
    ON CONFLICT (slug) DO NOTHING
  `;

  await page.goto('/problems');
  await expect(page.getByRole('heading', { name: 'Problems' })).toBeVisible();
  await resetFocus(page);

  const stops = await walk(page, 16);

  // ORDER: the skip link precedes the navigation, which precedes the content.
  expect(stops[0]?.element, 'skip link should be first').toContain('a');

  // Rows are reachable — the thing that made this criterion untestable before.
  const reachedRow = stops.some((stop) => /Keyboard Alpha|Keyboard Beta/i.test(stop.element));
  expect(reachedRow, `problem rows unreachable: ${JSON.stringify(stops)}`).toBe(true);

  // VISIBLE at every stop.
  const unringed = stops.filter((stop) => !stop.ringed).map((stop) => stop.element);
  expect(unringed, 'these stops had no visible focus ring').toEqual([]);

  // NO TRAP: focus must be able to come back out again.
  const forward = await focusedDescriptor(page);
  await page.keyboard.press('Shift+Tab');
  const backward = await focusedDescriptor(page);
  expect(backward, 'Shift+Tab did not move focus — possible trap').not.toBe(forward);
});

test('the skip link jumps past the navigation to main', async ({ context, page, baseURL }) => {
  await signInAs(context, sql, { email: 'kb-skip@e2e.test', baseUrl: baseURL! });

  await page.goto('/problems');
  await resetFocus(page);

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: /skip to main content/i });
  await expect(skip).toBeFocused();

  // It must become VISIBLE when focused — a permanently sr-only skip link is
  // useless to the sighted keyboard user it exists for.
  expect(await focusedHasVisibleRing(page)).toBe(true);

  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeAttached();
});
