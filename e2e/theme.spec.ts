/**
 * F0.4 acceptance criterion: "Theme switches via data-theme with no flash of
 * wrong theme on load."
 *
 * A flash is a PAINT event, so asserting the final DOM state proves nothing —
 * the wrong theme could have been visible for 200ms and the end state would
 * still be correct. These tests instead assert the mechanism that prevents it:
 * the theme attribute is set by a synchronous inline script in <head>, so it is
 * already applied at the very first opportunity the page can be observed.
 *
 * Cold load means no warm bundle cache and no prior attribute — a fresh
 * context per test.
 */
import { expect, test } from '@playwright/test';
import { appliedTheme, recordThemeAtFirstBody, themeAtFirstBody } from './helpers/auth';

test.describe('no flash of wrong theme', () => {
  test('dark is applied with no stored preference (dark-first default)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();

    await page.goto('/sign-in');

    // Dark is the :root default, so no attribute is needed for it.
    const theme = await appliedTheme(page);
    expect(theme === null || theme === 'dark').toBe(true);

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // #0b0d10
    expect(bg).toBe('rgb(11, 13, 16)');

    await context.close();
  });

  test('a stored light preference is applied BEFORE first paint', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();

    // Seed the preference, then reload cold.
    await page.goto('/sign-in');
    await page.evaluate(() => localStorage.setItem('quadrantcode-theme', 'light'));

    /*
     * The decisive assertion. An init script, installed before the reload, runs
     * before ANY page script and records the attribute at the moment <body> is
     * inserted, the first moment anything can be painted (#53). A synchronous
     * bootstrap in <head> has run by then. One that was deferred, async or in
     * <body> has not, and the recording would be unset.
     */
    await recordThemeAtFirstBody(page);
    await page.reload({ waitUntil: 'commit' });
    expect(await themeAtFirstBody(page), 'theme must be applied before <body> exists').toBe(
      'light',
    );

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(255, 255, 255)');

    await context.close();
  });

  test('the bootstrap script is synchronous and inside <head>', async ({ page }) => {
    await page.goto('/sign-in');

    const script = await page.evaluate(() => {
      const scripts = Array.from(document.head.querySelectorAll('script'));
      const boot = scripts.find((s) => s.textContent?.includes('quadrantcode-theme'));
      if (!boot) return null;
      return {
        inHead: boot.parentElement?.tagName === 'HEAD',
        isAsync: boot.async,
        isDefer: boot.defer,
        hasSrc: Boolean(boot.src),
        // Position matters: it must precede the body being parsed.
        indexAmongHeadScripts: scripts.indexOf(boot),
      };
    });

    expect(script, 'theme bootstrap script not found in <head>').not.toBeNull();
    expect(script!.inHead).toBe(true);
    // async/defer or an external src would run AFTER first paint — the flash.
    expect(script!.isAsync).toBe(false);
    expect(script!.isDefer).toBe(false);
    expect(script!.hasSrc).toBe(false);
  });

  test('toggling persists across a cold reload', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await recordThemeAtFirstBody(page);
    await page.goto('/sign-in');
    await page.evaluate(() => localStorage.setItem('quadrantcode-theme', 'light'));
    await page.reload({ waitUntil: 'commit' });
    expect(await themeAtFirstBody(page)).toBe('light');

    await page.evaluate(() => localStorage.setItem('quadrantcode-theme', 'dark'));
    await page.reload({ waitUntil: 'commit' });
    expect(await themeAtFirstBody(page)).toBe('dark');

    await context.close();
  });

  test('a corrupted stored value falls back to dark rather than throwing', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/sign-in');
    await page.evaluate(() => localStorage.setItem('quadrantcode-theme', 'chartreuse'));

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await recordThemeAtFirstBody(page);
    await page.reload({ waitUntil: 'commit' });

    const theme = await themeAtFirstBody(page);
    expect(theme === null || theme === 'dark').toBe(true);
    expect(errors).toEqual([]);

    await context.close();
  });
});
