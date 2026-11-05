/**
 * D39 · no Suspense boundary may sit above a page that renders the timer bar.
 *
 * The timer bar is rendered by `app/_shell/AppShell.tsx`, which the `(app)`
 * layout uses, so it is on every page under `(app)`; the v2 solve route
 * (`(solve-v2)`, C2) renders the session strip instead, with the same actions.
 * Those actions (Pause, Resume, I'm stuck, Solved, Give up, Abandon)
 * revalidate from whatever page is open. With Next 15.5.24 a server
 * action's re-render under a `<Suspense>` boundary is sometimes never committed
 * (vercel/next.js#87529): the session changes on the server and the bar on
 * screen does not. D39 measured it on the problem page (≈45% of starts) and
 * later caught it on /dashboard through `e2e/session-commit.spec.ts`.
 *
 * A `loading.tsx` is a `<Suspense>` boundary by another name, so this fails if
 * one appears anywhere it could wrap a page under `(app)`:
 *
 *   · `app/loading.tsx` — above both layouts
 *   · any `loading.tsx` inside `app/(app)/` or `app/(solve-v2)/`
 *   · a hand-written `<Suspense` in a file inside those groups, or in the shared
 *     shell and solve loader (`app/_shell/`, `app/_solve/`) that render them
 *
 * Routes outside those groups (sign-in, public pages) never render a timer
 * and may have boundaries.
 *
 * ## Revisited 2026-11-05 (#29): two boundaries are allowed again, on Next ≥ 16.4.5
 *
 * The D39 revisit restored the original boundary and ran
 * `session-commit.spec.ts --repeat-each=5`: 26 of 50 starts lost the timer on
 * 15.5.24, and 0 of 50 on 16.4.5. So the rule is now:
 *
 *   · the boundaries above a timer are EXACTLY the two list skeletons
 *     (dashboard, catalog). A new one is a deliberate change to this list, not
 *     an accident.
 *   · any boundary above a timer requires the installed Next to be at least
 *     16.4.5, so a downgrade cannot quietly bring D39 back.
 *
 * `e2e/session-commit.spec.ts` still runs Pause/Resume ×10 on the dashboard
 * and the catalog, now under these boundaries, as the behavioural guard.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP = join(ROOT, 'app');
const SHELL = join(APP, '(app)');

/** Every directory whose files render under a timer (bar or v2 strip). */
const TIMER_TREES = ['(app)', '(solve-v2)', '_shell', '_solve'];

/** The first Next version the D39 revisit showed the bug gone on (#29). */
const D39_FIXED_IN = '16.4.5';

/** The boundaries allowed above a timer since the revisit: the two list skeletons. */
const ALLOWED_BOUNDARIES = [
  'app/(app)/dashboard/loading.tsx',
  'app/(app)/problems/(catalog)/loading.tsx',
] as const;

/** `version >= floor`, on major.minor.patch; a prerelease counts as its numbers. */
function isAtLeast(version: string, floor: string): boolean {
  const parts = (value: string) =>
    value
      .split('-')[0]!
      .split('.')
      .map((part) => Number(part));
  const [a, b] = [parts(version), parts(floor)];
  for (let index = 0; index < 3; index += 1) {
    const [x, y] = [a[index] ?? 0, b[index] ?? 0];
    if (x !== y) return x > y;
  }
  return true;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

/** Repo-relative, forward-slashed, for readable failure messages. */
const rel = (file: string) => relative(ROOT, file).split(sep).join('/');

/**
 * The rule itself, over a list of repo-relative paths and their contents, so it
 * can be checked against invented trees as well as the real one.
 */
function boundariesAboveTimerBar(files: { path: string; source: string }[]): string[] {
  return files
    .filter(({ path, source }) => {
      if (path === 'app/loading.tsx') return true;
      if (!TIMER_TREES.some((tree) => path.startsWith(`app/${tree}/`))) return false;
      if (path.endsWith('/loading.tsx') || path.endsWith('/loading.jsx')) return true;
      return /\.(t|j)sx?$/.test(path) && /<Suspense[\s>]/.test(source);
    })
    .map(({ path }) => path);
}

describe('D39 · loading boundaries above the timer bar: only the allowed two, on Next ≥ 16.4.5', () => {
  const shellFiles = walk(SHELL);
  const files = [
    ...TIMER_TREES.flatMap((tree) => walk(join(APP, tree))),
    ...readdirSync(APP)
      .map((entry) => join(APP, entry))
      .filter((path) => !statSync(path).isDirectory()),
  ].map((file) => ({ path: rel(file), source: readFileSync(file, 'utf8') }));

  it('POSITIVE CONTROL · the walk really reaches the pages under (app)', () => {
    // Otherwise a renamed directory makes the assertion below pass over nothing.
    const pages = shellFiles.filter((file) => file.endsWith(`${sep}page.tsx`));
    expect(pages.length).toBeGreaterThanOrEqual(10);
    expect(pages.map(rel)).toContain('app/(app)/dashboard/page.tsx');
    expect(pages.map(rel)).toContain('app/(app)/problems/[slug]/solve/page.tsx');
    expect(files.map((file) => file.path)).toContain(
      'app/(solve-v2)/problems/[slug]/solve/v2/page.tsx',
    );
  });

  it('the timers are where this rule assumes', () => {
    // If they move, the scope of this rule has to move with them.
    expect(readFileSync(join(APP, '_shell', 'AppShell.tsx'), 'utf8')).toContain('<TimerBar');
    expect(readFileSync(join(SHELL, 'layout.tsx'), 'utf8')).toContain('<AppShell timerBar>');
    expect(readFileSync(join(APP, '(solve-v2)', 'layout.tsx'), 'utf8')).toContain(
      '<AppShell timerBar={false}>',
    );
    expect(
      readFileSync(join(ROOT, 'components', 'solve-v2', 'SolveShellV2.tsx'), 'utf8'),
    ).toContain('<SessionStripV2');
  });

  it('THE ONLY BOUNDARIES ABOVE THEM ARE THE TWO LIST SKELETONS', () => {
    expect(
      boundariesAboveTimerBar(files),
      'a new Suspense boundary above a timer: add it here deliberately, after running ' +
        'e2e/session-commit.spec.ts --repeat-each=5 against it (D39)',
    ).toEqual([...ALLOWED_BOUNDARIES].sort());
  });

  it('A BOUNDARY ABOVE A TIMER NEEDS NEXT ≥ 16.4.5, where D39 no longer reproduces', () => {
    const installed = (
      JSON.parse(readFileSync(join(ROOT, 'node_modules', 'next', 'package.json'), 'utf8')) as {
        version: string;
      }
    ).version;
    if (boundariesAboveTimerBar(files).length === 0) return;
    expect(
      isAtLeast(installed, D39_FIXED_IN),
      `next ${installed} is older than ${D39_FIXED_IN}: below it, a boundary above the ` +
        'timer bar drops server-action renders (D39, vercel/next.js#87529)',
    ).toBe(true);
  });

  it('CONTROL · the version check refuses 15.5.24 and accepts 16.4.5 and later', () => {
    expect(isAtLeast('15.5.24', D39_FIXED_IN)).toBe(false);
    expect(isAtLeast('16.4.4', D39_FIXED_IN)).toBe(false);
    expect(isAtLeast('16.4.5', D39_FIXED_IN)).toBe(true);
    expect(isAtLeast('16.5.0', D39_FIXED_IN)).toBe(true);
    expect(isAtLeast('17.0.0', D39_FIXED_IN)).toBe(true);
    expect(isAtLeast('16.5.0-canary.3', D39_FIXED_IN)).toBe(true);
  });

  it('NEGATIVE CONTROL · the rule does catch each kind of boundary', () => {
    expect(
      boundariesAboveTimerBar([
        { path: 'app/loading.tsx', source: '' },
        { path: 'app/(app)/dashboard/loading.tsx', source: '' },
        { path: 'app/(app)/problems/(catalog)/loading.tsx', source: '' },
        { path: 'app/(app)/sessions/page.tsx', source: 'return <Suspense fallback={null}>' },
        { path: 'app/(solve-v2)/problems/[slug]/solve/v2/loading.tsx', source: '' },
        { path: 'app/_shell/AppShell.tsx', source: '<Suspense fallback={null}>' },
      ]),
    ).toHaveLength(6);
  });

  it('…and leaves routes that never render the timer bar alone', () => {
    expect(
      boundariesAboveTimerBar([
        { path: 'app/(auth)/login/loading.tsx', source: '' },
        { path: 'app/u/[handle]/page.tsx', source: '<Suspense fallback={null}>' },
        { path: 'app/(app)/sessions/page.tsx', source: '// mentions Suspense in prose' },
      ]),
    ).toEqual([]);
  });
});
