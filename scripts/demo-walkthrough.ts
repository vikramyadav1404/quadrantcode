/**
 * Drive the running app through its main screens and screenshot each one.
 *
 *   npm run demo:walk -- <sessionToken> <timelineSessionId> [width]
 *
 * Companion to `demo-seed.ts`. That script creates a real `auth_sessions` row
 * and prints its token; this one carries it in the session cookie, which is
 * exactly what a magic link would have done.
 *
 * Screenshots land in `.playwright/demo/<width>/`. Width defaults to 1280 and
 * may be 375, 768 or 1440 — the three the split pane is checked at.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * `localhost`, not `127.0.0.1`. Chromium treats both as trustworthy origins in
 * principle, but the `__Secure-` cookie prefix is only reliably accepted over
 * http on `localhost` — and a walkthrough that silently drops its session
 * cookie reports 401 on every page and tells you nothing about the app.
 */
const BASE = process.env['DEMO_BASE_URL'] ?? 'http://localhost:3100';

/** One directory per width, so three runs do not overwrite each other. */
const outDir = (width: number) => join(process.cwd(), '.playwright', 'demo', String(width));

/**
 * The cookie Auth.js reads — and its name depends on `NODE_ENV`.
 *
 * `server/services/auth/config.ts` uses `__Secure-traceloop.session` in
 * production and `traceloop.session` otherwise. Rather than guess which one the
 * running server chose, this sets both: the wrong one is ignored, and a
 * walkthrough script that fails because it picked the wrong environment tells
 * you nothing about the app.
 *
 * The `__Secure-` prefix requires `secure: true` or the browser rejects the
 * cookie outright. That is fine over plain http here because Chromium treats
 * 127.0.0.1 as a trustworthy origin — the same reasoning `e2e/helpers/auth.ts`
 * records.
 */

/**
 * `wait` is a selector that must be on screen before the shutter.
 *
 * It was declared here from the start and never used, which was fine while
 * every screen was server-rendered. The solve page is not: Monaco arrives on a
 * dynamic import, and `networkidle` returns while the pane still says "Loading
 * the editor…" — so the screenshot showed the placeholder rather than the thing
 * it was taken to show.
 */
const SCREENS: { path: string; name: string; wait?: string }[] = [
  { path: '/login', name: '01-login' },
  { path: '/dashboard', name: '02-dashboard' },
  { path: '/problems', name: '03-problems' },
  { path: '/revision', name: '04-revision' },
  { path: '/analytics', name: '05-analytics' },
  { path: '/mistakes', name: '06-mistakes' },
  { path: '/sessions', name: '07-sessions' },
  { path: '/settings', name: '09-settings' },
  { path: '/settings/privacy', name: '10-privacy' },
  { path: '/admin/health', name: '11-health' },
  {
    path: '/problems/demo-search-rotated-style/solve',
    name: '12-solve',
    // The Monaco textarea, not the loading placeholder that precedes it.
    wait: '.monaco-editor',
  },
];

/**
 * Widths, because the split pane behaves differently across the breakpoint.
 *
 * `e2e/viewports.spec.ts` asserts the geometry at these same three numbers and
 * is the thing that FAILS a regression. This is for looking at — the assertion
 * says the panes are side by side, and a picture says whether that is any good
 * to read.
 */
const WIDTHS = [375, 768, 1440] as const;

async function main(): Promise<void> {
  const [token, timelineSessionId] = process.argv.slice(2);
  if (!token) {
    throw new Error('usage: demo:walk -- <sessionToken> [timelineSessionId] [width]');
  }

  /*
   * One width per run, so a walkthrough is a set of comparable pictures rather
   * than a mixture. `npm run demo:walk -- <token> <sessionId> 375`.
   */
  const width = Number(process.argv[4] ?? 1280);
  const wide = WIDTHS.includes(width as (typeof WIDTHS)[number]) || width === 1280;
  if (!Number.isFinite(width) || !wide) {
    throw new Error(
      `width must be one of ${[...WIDTHS, 1280].join(', ')} — got ${process.argv[4]}`,
    );
  }

  const OUT = outDir(width);
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height: 900 } });

  /*
   * Both names, and `secure` matching each.
   *
   * `__Secure-` REQUIRES secure:true or the browser drops it; the plain name
   * must not be secure over http or it is never sent back. Playwright rejects
   * `url` combined with these, so domain/path it is — the same form
   * `e2e/helpers/auth.ts` uses.
   */
  const { hostname } = new URL(BASE);

  await context.addCookies([
    {
      name: '__Secure-traceloop.session',
      value: token,
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'traceloop.session',
      value: token,
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const planted = (await context.cookies(BASE)).map((cookie) => cookie.name);
  if (planted.length === 0) {
    throw new Error('no session cookie survived — the browser rejected all of them');
  }

  const page = await context.newPage();
  const results: {
    name: string;
    status: number | undefined;
    title: string;
    /** Only for screens with a `wait`: did the thing we waited for appear. */
    rendered?: boolean;
  }[] = [];

  const screens = timelineSessionId
    ? [
        ...SCREENS.slice(0, 7),
        { path: `/sessions/${timelineSessionId}`, name: '08-timeline' },
        ...SCREENS.slice(7),
      ]
    : SCREENS;

  for (const screen of screens) {
    const response = await page.goto(`${BASE}${screen.path}`, { waitUntil: 'networkidle' });

    let waited = true;
    if (screen.wait) {
      /*
       * Recorded rather than thrown. A screenshot of the loading state is still
       * worth having; what is not acceptable is not KNOWING that is what it is,
       * which is how "the editor renders fine" gets said about a placeholder.
       */
      waited = await page
        .locator(screen.wait)
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
    }

    // A blank frame is a failure to launch, not a screenshot.
    const heading = await page
      .locator('h1')
      .first()
      .textContent()
      .catch(() => null);

    /*
     * `fullPage` is wrong for the solve screen and right for every other one.
     *
     * The split pane is sized to the viewport (`h-[calc(100vh-8rem)]`), so a
     * full-page capture of it is just the viewport with the surrounding chrome
     * stretched — and at 375, where the panes stack, fullPage produces a tall
     * strip that hides the very thing worth checking: what fits on a phone
     * screen without scrolling.
     */
    await page.screenshot({
      path: join(OUT, `${screen.name}.png`),
      fullPage: !screen.wait,
    });

    results.push({
      name: screen.name,
      status: response?.status(),
      title: (heading ?? '(no h1)').trim().slice(0, 60),
      ...(screen.wait ? { rendered: waited } : {}),
    });
  }

  await browser.close();

  console.log(JSON.stringify({ event: 'demo.walkthrough', out: OUT, width, results }, null, 2));
}

void main();
