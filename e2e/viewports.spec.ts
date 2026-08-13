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
import { cleanup, db, signInAs } from './helpers/auth';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  sql = db();
});

test.afterAll(async () => {
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
