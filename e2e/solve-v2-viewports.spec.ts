/**
 * C6 · the v2 solve screen at phone, tablet and desktop widths, with
 * FEATURE_SOLVE_V2 on (`chromium-v2` only), during a live sitting so the
 * session strip, the history card and the split pane are all on the page.
 *
 * At each width:
 *   · no horizontal scroll
 *   · the editor is tall enough to type in (more than 200px, the same floor
 *     as `viewports.spec.ts`, which caught a five-pixel editor once)
 *   · every strip control is visible, and reachable from the keyboard: Tab
 *     lands on each of Pause, I'm stuck, Solved, Give up and Abandon, and each
 *     is on screen when it has focus
 *   · the separator before Abandon is on the same line as Abandon
 *
 * Below 768px the panes stack (SplitPane's rule, unchanged): the plan allowed
 * stacking or tabs, and stacking needs no new control.
 */
import { expect, test, type Page } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const SLUG = 'c6-viewport-alpha';
const TITLE = 'C6 Viewport Alpha';
let sql: ReturnType<typeof postgres>;

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

/** The strip's controls, by the names v1's timer bar gives them. */
const CONTROLS = ['Pause', "I'm stuck", 'Solved', 'Give up', 'Abandon'] as const;

test.beforeAll(async () => {
  sql = db();
  await deleteProblems(sql, SLUG);
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SLUG}, ${TITLE}, 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SLUG}/`}, 'easy', 'published')
  `;
});

test.afterAll(async () => {
  await deleteProblems(sql, SLUG);
  await cleanup(sql);
  await sql.end();
});

const timerOf = (page: Page) => page.getByRole('region', { name: /solve session timer/i });

/** Signs in, starts a sitting on the problem page, opens /solve. */
async function sittingOnSolve(page: Page, email: string, baseURL: string) {
  await signInAs(page.context(), sql, { email, baseUrl: baseURL });
  await page.goto(`/problems/${SLUG}`);
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && !!response.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: /start solving/i }).click();
  expect((await started).ok()).toBe(true);
  await page.goto(`/problems/${SLUG}/solve`);
  await expect(timerOf(page)).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test(`the v2 solve screen works at ${viewport.width}px (${viewport.name})`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await sittingOnSolve(page, `c6-${viewport.width}@e2e.test`, baseURL!);

    // Everything measured is mounted first: Monaco arrives on a dynamic import.
    await expect(
      page.getByRole('region', { name: 'Your history on this problem' }),
    ).toBeVisible();
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });

    // No horizontal scroll.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal scrollbar at ${viewport.width}px`).toBeLessThanOrEqual(0);

    // The editor is big enough to type in.
    const editor = (await page.locator('.monaco-editor').first().boundingBox())!;
    expect(editor.height, `the editor collapsed at ${viewport.width}px`).toBeGreaterThan(200);

    // Every strip control is visible.
    const timer = timerOf(page);
    for (const name of CONTROLS) {
      await expect(timer.getByRole('button', { name, exact: true })).toBeVisible();
    }

    // The separator before Abandon wraps with it, so it is never left hanging
    // at the end of a line when Abandon moves to the next one (375px did that).
    const separator = (await timer.locator('[data-solve-v2-strip-separator]').boundingBox())!;
    const abandon = (await timer
      .getByRole('button', { name: 'Abandon', exact: true })
      .boundingBox())!;
    const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
    expect(
      Math.abs(middle(separator) - middle(abandon)),
      `the separator is on a different line from Abandon at ${viewport.width}px`,
    ).toBeLessThan(4);

    // ...and reachable by Tab, on screen when focused.
    expect(await tabWalk(page), `Tab order through the strip at ${viewport.width}px`).toEqual([
      ...CONTROLS,
    ]);
  });
}

/**
 * Tabs forward from the strip's first focusable element, its link to the
 * problem, and returns the strip controls that took focus, in order. Each one
 * must be on screen at the moment it has focus.
 */
async function tabWalk(page: Page): Promise<string[]> {
  await timerOf(page).getByRole('link', { name: TITLE }).focus();
  const reached: string[] = [];
  for (let press = 0; press < 12 && reached.length < CONTROLS.length; press++) {
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    const name = ((await focused.textContent()) ?? '').trim();
    if ((CONTROLS as readonly string[]).includes(name) && !reached.includes(name)) {
      await expect(focused, `${name} is on screen when focused`).toBeInViewport();
      reached.push(name);
    }
  }
  return reached;
}

test('NEGATIVE CONTROL: the Tab walk misses a control taken out of the tab order', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await sittingOnSolve(page, 'c6-negative@e2e.test', baseURL!);

  // Without this, the walk above could pass by never being able to fail.
  await timerOf(page)
    .getByRole('button', { name: 'Abandon', exact: true })
    .evaluate((button) => button.setAttribute('tabindex', '-1'));

  expect(await tabWalk(page)).toEqual(CONTROLS.filter((name) => name !== 'Abandon'));
});
