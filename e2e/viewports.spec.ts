/**
 * F0.4 acceptance criterion: "Layout intact at 375px, 768px, and 1440px."
 *
 * "Intact" is made concrete rather than eyeballed:
 *   - no horizontal overflow (the classic responsive failure)
 *   - exactly ONE navigation is visible — sidebar above 768px, bottom nav below
 *   - the skip link and main landmark exist at every width
 *   - nothing overlaps the viewport edge
 */
import { expect, test } from '@playwright/test';
import type postgres from 'postgres';
import { cleanup, db, deleteProblems, signInAs } from './helpers/auth';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

/** The split pane's breakpoint. Tailwind `md`, and the number the CSS uses. */
const SPLIT_BREAKPOINT = 768;

const SOLVE_SLUG = 'vp-split-pane-style';

let sql: ReturnType<typeof postgres>;

test.beforeAll(async () => {
  sql = db();
  await sql`
    INSERT INTO problems (slug, title, source_type, platform, external_url, difficulty, status)
    VALUES (${SOLVE_SLUG}, 'Viewport fixture', 'external_link', 'leetcode',
            ${`https://leetcode.com/problems/${SOLVE_SLUG}/`}, 'easy', 'published')
    ON CONFLICT (slug) DO NOTHING
  `;
});

test.afterAll(async () => {
  await deleteProblems(sql, SOLVE_SLUG);
  await cleanup(sql);
  await sql.end();
});

for (const viewport of VIEWPORTS) {
  test(`dashboard layout is intact at ${viewport.width}px (${viewport.name})`, async ({
    context,
    page,
    baseURL,
  }) => {
    await signInAs(context, sql, { email: `vp-${viewport.width}@e2e.test`, baseUrl: baseURL! });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // 1. No horizontal overflow.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal scrollbar at ${viewport.width}px`).toBeLessThanOrEqual(0);

    /*
     * 2. Exactly one navigation visible, and the right one for the width.
     *
     * `checkVisibility()`, NOT `offsetParent !== null`: offsetParent is null for
     * `position: fixed` elements, so the first version of this test reported the
     * fixed bottom nav as hidden and failed at 375px against a layout that was
     * actually correct.
     */
    const sidebarVisible = await page
      .locator('nav[data-nav="sidebar"]')
      .evaluate((node) => (node as HTMLElement).checkVisibility());
    const bottomVisible = await page
      .locator('nav[data-nav="bottom"]')
      .evaluate((node) => (node as HTMLElement).checkVisibility());

    expect(
      [sidebarVisible, bottomVisible].filter(Boolean).length,
      'exactly one Main navigation should be visible',
    ).toBe(1);

    if (viewport.width >= 768) {
      expect(sidebarVisible, 'sidebar shows at >=768px').toBe(true);
      expect(bottomVisible, 'bottom nav hides at >=768px').toBe(false);
    } else {
      expect(sidebarVisible, 'sidebar hides below 768px').toBe(false);
      expect(bottomVisible, 'bottom nav shows below 768px').toBe(true);
    }

    // 3. Landmarks present at every width.
    await expect(page.locator('#main')).toBeAttached();
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeAttached();

    // 4. Nothing spills past the right edge.
    const spilling = await page.evaluate((w) => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > w + 1) bad.push(el.tagName + '.' + (el.className || '?'));
      }
      return bad.slice(0, 5);
    }, viewport.width);
    expect(spilling, 'elements overflowing the viewport').toEqual([]);
  });
}

/*
 * The solve screen, at the same three widths.
 *
 * The dashboard loop above is F0.4's criterion and it passed for the LeetCode
 * layout without ever loading the page that layout changed. That is the vacuous
 * pass this project keeps re-learning: a suite going green is evidence about
 * what it visits, not about what changed.
 *
 * So the geometry is asserted rather than eyeballed. "Side by side" means the
 * left pane ends before the right one begins; "stacked" means it ends above it.
 * Both are read off `getBoundingClientRect`, which cannot be satisfied by a
 * layout that merely renders without crashing.
 */
for (const viewport of VIEWPORTS) {
  test(`the solve screen ${viewport.width >= SPLIT_BREAKPOINT ? 'splits' : 'stacks'} at ${
    viewport.width
  }px (${viewport.name})`, async ({ context, page, baseURL }) => {
    await signInAs(context, sql, {
      email: `vps-${viewport.width}@e2e.test`,
      baseUrl: baseURL!,
    });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/problems/${SOLVE_SLUG}/solve`);

    // Both halves present before any measurement: Monaco arrives asynchronously,
    // and a rect read mid-mount measures the loading placeholder instead.
    await expect(page.getByRole('heading', { name: 'Viewport fixture' })).toBeVisible();
    await expect(page.getByLabel('Language')).toBeVisible();
    // Monaco arrives on a dynamic import; before it lands the pane is a
    // placeholder with a different height than the thing being measured.
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });

    const left = page.locator('[data-pane="left"]');
    const right = page.locator('[data-pane="right"]');
    const divider = page.getByRole('separator');

    const leftBox = (await left.boundingBox())!;
    const rightBox = (await right.boundingBox())!;

    if (viewport.width >= SPLIT_BREAKPOINT) {
      await expect(divider).toBeVisible();
      expect(
        leftBox.x + leftBox.width,
        `panes should sit side by side at ${viewport.width}px`,
      ).toBeLessThanOrEqual(rightBox.x + 1);
    } else {
      /*
       * Below the breakpoint there is nothing to resize, and the divider is
       * `display: none` rather than merely invisible — so it is out of the tab
       * order too, which `keyboard.spec.ts` budgets on.
       */
      await expect(divider).toBeHidden();
      expect(
        leftBox.y + leftBox.height,
        `panes should stack at ${viewport.width}px`,
      ).toBeLessThanOrEqual(rightBox.y + 1);
    }

    /*
     * The editor has to be big enough to type in.
     *
     * This assertion exists because the version of this test WITHOUT it passed
     * at 375px against an editor five pixels tall. Stacking order was correct,
     * there was no overflow, Monaco had mounted — and the page was unusable.
     * `flex-1` in a column with no definite height is a fraction of nothing.
     *
     * 200px is deliberately modest: the point is to catch a collapse, not to
     * pin the design to a number that a later layout has to argue with.
     */
    const editor = (await page.locator('.monaco-editor').first().boundingBox())!;
    expect(editor.height, `the editor collapsed at ${viewport.width}px`).toBeGreaterThan(200);

    // The editor is the widest thing on the page and the likeliest to spill.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `horizontal scrollbar on /solve at ${viewport.width}px`,
    ).toBeLessThanOrEqual(0);
  });
}

test('the sign-in page is usable at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');

  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
