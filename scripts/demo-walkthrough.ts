/**
 * Drive the running app through its main screens and screenshot each one.
 *
 *   npm run demo:walk -- <sessionToken> <timelineSessionId>
 *
 * Companion to `demo-seed.ts`. That script creates a real `auth_sessions` row
 * and prints its token; this one carries it in the session cookie, which is
 * exactly what a magic link would have done.
 *
 * Screenshots land in `.playwright/demo/`.
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
const OUT = join(process.cwd(), '.playwright', 'demo');

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
];

async function main(): Promise<void> {
  const [token, timelineSessionId] = process.argv.slice(2);
  if (!token) throw new Error('usage: demo:walk -- <sessionToken> [timelineSessionId]');

  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

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
  const results: { name: string; status: number | undefined; title: string }[] = [];

  const screens = timelineSessionId
    ? [
        ...SCREENS.slice(0, 7),
        { path: `/sessions/${timelineSessionId}`, name: '08-timeline' },
        ...SCREENS.slice(7),
      ]
    : SCREENS;

  for (const screen of screens) {
    const response = await page.goto(`${BASE}${screen.path}`, { waitUntil: 'networkidle' });

    // A blank frame is a failure to launch, not a screenshot.
    const heading = await page
      .locator('h1')
      .first()
      .textContent()
      .catch(() => null);

    await page.screenshot({ path: join(OUT, `${screen.name}.png`), fullPage: true });

    results.push({
      name: screen.name,
      status: response?.status(),
      title: (heading ?? '(no h1)').trim().slice(0, 60),
    });
  }

  await browser.close();

  console.log(JSON.stringify({ event: 'demo.walkthrough', out: OUT, results }, null, 2));
}

void main();
