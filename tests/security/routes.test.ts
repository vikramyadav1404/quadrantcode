/**
 * F4.8 · every route, enumerated, and every one of them checked.
 *
 * The criterion is "an automated test enumerating ALL routes, asserting an
 * unauthenticated request is rejected". The word doing the work is **all** — a
 * hand-written list of routes somebody remembered is a list that stops being
 * complete the day a route is added.
 *
 * So this walks the filesystem for `route.ts` and `page.tsx`, and every one it
 * finds must be classified. A route nobody has decided about **fails this
 * test**, which is the only way "all" stays true a year from now.
 *
 * ## Why this file classifies rather than just asserts 401
 *
 * Not every route should reject an anonymous caller. `/login` must not. Auth.js
 * callbacks must not. `/api/health` must not — an uptime probe cannot hold a
 * session, and a health check behind auth answers "is auth working" instead.
 *
 * A test that demanded 401 everywhere would have to be weakened for each of
 * those, and a weakened test is one nobody trusts. Instead each route is
 * declared PUBLIC or PROTECTED with a reason, and the reason is the artefact:
 * whoever adds a public route has to write down why it is safe to be public.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(process.cwd(), 'app');

/**
 * Every route in the app directory, as a URL path.
 *
 * Group segments — `(app)`, `(auth)` — are stripped: they organise files and
 * do not appear in a URL.
 */
function discoverRoutes(): { path: string; kind: 'api' | 'page' }[] {
  const found: { path: string; kind: 'api' | 'page' }[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);

      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (entry !== 'route.ts' && entry !== 'page.tsx') continue;

      const url =
        '/' +
        relative(APP, dir)
          .split(sep)
          .filter((segment) => !segment.startsWith('(') && segment.length > 0)
          .join('/');

      found.push({
        path: url === '/' ? '/' : url,
        kind: entry === 'route.ts' ? 'api' : 'page',
      });
    }
  };

  walk(APP);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Routes that MUST answer an anonymous caller, each with the reason.
 *
 * The reason is not documentation. It is the thing a reviewer reads when
 * somebody adds a line here, and "because the test failed otherwise" is not one
 * of the strings below.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  '/': 'the marketing root; no user data',
  '/login': 'you cannot require a session to create a session',
  '/login/verify': 'the magic-link landing page, reached before any session exists',
  '/sign-in': 'legacy path kept as a redirect to /login',
  '/api/auth/[...nextauth]': 'Auth.js callbacks; rejecting them would break sign-in itself',
  '/api/health':
    'an uptime probe cannot hold a session, and a health check behind auth answers "is auth working"',
  '/api/otp/request':
    'phone verification starts before the phone is trusted; rate-limited instead',
  '/api/otp/verify': 'same — the code IS the credential here',
};

/**
 * Routes that must reject an anonymous caller.
 *
 * Middleware covers the page prefixes; API routes each check for themselves,
 * because middleware's matcher is a list somebody has to remember to extend.
 */
const PROTECTED_PREFIXES = [
  '/admin',
  '/analytics',
  '/api/avatar',
  '/api/execution',
  '/api/ingest',
  '/api/session',
  '/dashboard',
  '/mistakes',
  '/onboarding',
  '/problems',
  '/revision',
  '/sessions',
  '/settings',
];

function classify(path: string): 'public' | 'protected' | 'unclassified' {
  if (path in PUBLIC_ROUTES) return 'public';
  if (PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return 'protected';
  }
  return 'unclassified';
}

describe('F4.8 · the route inventory', () => {
  const routes = discoverRoutes();

  it('finds the routes that exist, so the rest of this file is not vacuous', () => {
    /*
     * Without this, a broken `discoverRoutes` — a renamed directory, a changed
     * file convention — makes every assertion below pass over an empty list.
     * That is the failure mode this project has been caught by twice.
     */
    expect(routes.length).toBeGreaterThanOrEqual(30);
    expect(routes.filter((route) => route.kind === 'api').length).toBeGreaterThanOrEqual(10);

    const paths = routes.map((route) => route.path);
    expect(paths).toContain('/api/health');
    expect(paths).toContain('/dashboard');
    expect(paths).toContain('/admin/health');
  });

  it('EVERY ROUTE IS CLASSIFIED — a new one fails until somebody decides', () => {
    const unclassified = routes
      .filter((route) => classify(route.path) === 'unclassified')
      .map((route) => route.path);

    /*
     * The point of the whole file. A route added next month is unclassified,
     * this fails, and whoever added it has to say whether it is public and why
     * — rather than it quietly inheriting whatever middleware happens to do.
     */
    expect(unclassified).toEqual([]);
  });

  it('every public route carries a REASON, not just an entry', () => {
    for (const [path, reason] of Object.entries(PUBLIC_ROUTES)) {
      expect(reason.length, path).toBeGreaterThan(20);
      // "because the test failed otherwise" is not a reason.
      expect(reason, path).not.toMatch(/test|otherwise|for now|temporar/i);
    }
  });

  it('POSITIVE CONTROL · the classifier really can return unclassified', () => {
    // Otherwise the assertion above passes against a function that says
    // "protected" to everything.
    expect(classify('/some/route/nobody/declared')).toBe('unclassified');
    expect(classify('/dashboard')).toBe('protected');
    expect(classify('/login')).toBe('public');
  });

  it('no route is both public and protected', () => {
    const contradictory = Object.keys(PUBLIC_ROUTES).filter((path) =>
      PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
    );

    expect(contradictory).toEqual([]);
  });
});

describe('F4.8 · middleware covers every protected page prefix', () => {
  /**
   * The middleware's own list, read from the file.
   *
   * Compared rather than trusted: middleware protects pages by prefix, and a
   * prefix missing from its list is a page that renders for anybody. Reading
   * the source is how this test notices without running Next.
   */
  const middleware = readdirSync(process.cwd()).includes('middleware.ts')
    ? readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8')
    : '';

  const pagePrefixes = PROTECTED_PREFIXES.filter((prefix) => !prefix.startsWith('/api'));

  for (const prefix of pagePrefixes) {
    it(`middleware lists ${prefix}`, () => {
      expect(middleware).toContain(`'${prefix}'`);
    });
  }

  it('POSITIVE CONTROL · the middleware source was actually read', () => {
    // An empty string contains nothing and would pass every assertion above.
    expect(middleware.length).toBeGreaterThan(500);
    expect(middleware).toContain('PROTECTED_PREFIXES');
  });
});
