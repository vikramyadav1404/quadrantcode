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

/**
 * Elements that have genuinely escaped the page, at `viewportWidth`.
 *
 * Runs in the browser — `page.evaluate` ships this function's source, so it
 * must close over nothing.
 *
 * ## Why a scrollable ancestor is not a failure
 *
 * The original version flagged any element whose right edge passed the
 * viewport, which is wrong for a horizontally scrollable region: its content
 * is *supposed* to extend beyond, and the user reaches it by scrolling that
 * region. The 365-day heatmap is 53 columns wide and cannot fit 375px by
 * design — GitHub's contribution graph behaves the same way.
 *
 * `getBoundingClientRect` reports layout position and knows nothing about
 * clipping, so every off-screen cell looked like a broken layout. The criterion
 * this file encodes is "no horizontal overflow — the classic responsive
 * failure", and that means the PAGE scrolls sideways, not that some scroll
 * region has content in it.
 *
 * So an element is skipped when an ancestor clips or scrolls it horizontally.
 * Everything else is still reported, and the document-level check below is the
 * direct statement of the criterion.
 */
function findSpilling(viewportWidth: number): string[] {
  const escaped: string[] = [];

  const clippedHorizontally = (node: Element): boolean => {
    for (let el: Element | null = node.parentElement; el; el = el.parentElement) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true;
    }
    return false;
  };

  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.right <= viewportWidth + 1) continue;
    if (clippedHorizontally(el)) continue;
    escaped.push(`${el.tagName}.${el.className || '?'}`);
  }

  /*
   * The criterion itself, asserted directly rather than inferred from element
   * rects: if the document scrolls sideways, the layout IS broken, whatever
   * the per-element walk concluded.
   */
  const root = document.documentElement;
  if (root.scrollWidth > viewportWidth + 1) {
    escaped.push(`document scrolls horizontally: ${root.scrollWidth}px > ${viewportWidth}px`);
  }

  return escaped.slice(0, 5);
}

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
    const spilling = await page.evaluate(findSpilling, viewport.width);
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
  await expect(page.getByRole('textbox', { name: /email address/i })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

/*
 * The positive control for `findSpilling`.
 *
 * That detector was relaxed to ignore elements inside a horizontally scrollable
 * ancestor, because the 365-day heatmap legitimately extends past a 375px
 * viewport and is reached by scrolling its own region. Relaxing a gate is
 * exactly where one quietly stops detecting anything, so this asserts it still
 * fails on a real spill — and that the exemption is specific rather than a
 * blanket pass.
 *
 * It runs against the real dashboard so the baseline is the page the other
 * tests assert on, not a synthetic fixture that could drift away from it.
 */
test('the overflow detector still catches a genuine spill', async ({
  context,
  page,
  baseURL,
}) => {
  await signInAs(context, sql, { email: 'vp-control@e2e.test', baseUrl: baseURL! });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/dashboard');
  await expect(page.locator('#main')).toBeAttached();

  // Baseline: the real page is clean, heatmap and all.
  expect(await page.evaluate(findSpilling, 375), 'dashboard baseline').toEqual([]);

  // A genuine escape: appended to <body>, so no scrollable ancestor covers it.
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'spill-control';
    el.style.cssText = 'position:absolute;top:0;left:1200px;width:400px;height:20px';
    document.body.append(el);
  });
  const caught = await page.evaluate(findSpilling, 375);
  expect(caught.join(' '), 'a genuine spill must still be reported').toContain('DIV');

  await page.evaluate(() => document.getElementById('spill-control')?.remove());
  expect(await page.evaluate(findSpilling, 375), 'clean again once removed').toEqual([]);

  /*
   * And the exemption is specific: the SAME element inside a horizontally
   * scrollable container is not reported. If this ever starts failing, the
   * detector has become a blanket pass rather than a targeted one.
   */
  await page.evaluate(() => {
    const scroller = document.createElement('div');
    scroller.id = 'scroll-control';
    scroller.style.cssText = 'overflow-x:auto;width:200px';
    const wide = document.createElement('div');
    wide.style.cssText = 'width:1600px;height:20px';
    scroller.append(wide);
    document.body.append(scroller);
  });
  expect(await page.evaluate(findSpilling, 375), 'scrollable content is not a spill').toEqual(
    [],
  );
  await page.evaluate(() => document.getElementById('scroll-control')?.remove());
});
