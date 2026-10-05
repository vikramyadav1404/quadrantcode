/**
 * D39 · no Suspense boundary may sit above a page that renders the timer bar.
 *
 * The timer bar is in `app/(app)/layout.tsx`, so it is on every page under
 * `(app)`, and its actions (Pause, Resume, I'm stuck, Solved, Give up, Abandon)
 * revalidate the layout from whatever page is open. With Next 15.5.24 a server
 * action's re-render under a `<Suspense>` boundary is sometimes never committed
 * (vercel/next.js#87529): the session changes on the server and the bar on
 * screen does not. D39 measured it on the problem page (≈45% of starts) and
 * later caught it on /dashboard through `e2e/session-commit.spec.ts`.
 *
 * A `loading.tsx` is a `<Suspense>` boundary by another name, so this fails if
 * one appears anywhere it could wrap a page under `(app)`:
 *
 *   · `app/loading.tsx` — above the `(app)` layout itself
 *   · any `loading.tsx` inside `app/(app)/`
 *   · a hand-written `<Suspense` in a file inside `app/(app)/`
 *
 * Routes outside `(app)` (sign-in, public pages) never render the timer bar
 * and may have boundaries. Revisit after upgrading to Next ≥ 16.2 (issue #29),
 * using the regression spec as D39 describes — not by deleting this test.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP = join(ROOT, 'app');
const SHELL = join(APP, '(app)');

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
      if (!path.startsWith('app/(app)/')) return false;
      if (path.endsWith('/loading.tsx') || path.endsWith('/loading.jsx')) return true;
      return /\.(t|j)sx?$/.test(path) && /<Suspense[\s>]/.test(source);
    })
    .map(({ path }) => path);
}

describe('D39 · no loading boundary above a page with the timer bar', () => {
  const shellFiles = walk(SHELL);
  const files = [
    ...shellFiles,
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
  });

  it('the timer bar is where this rule assumes: in the (app) layout', () => {
    // If it moves, the scope of this rule has to move with it.
    const layout = readFileSync(join(SHELL, 'layout.tsx'), 'utf8');
    expect(layout).toContain('<TimerBar');
  });

  it('THERE IS NO loading.tsx OR <Suspense> ABOVE ANY OF THEM', () => {
    expect(
      boundariesAboveTimerBar(files),
      'a Suspense boundary above the timer bar brings back D39 (vercel/next.js#87529)',
    ).toEqual([]);
  });

  it('NEGATIVE CONTROL · the rule does catch each kind of boundary', () => {
    expect(
      boundariesAboveTimerBar([
        { path: 'app/loading.tsx', source: '' },
        { path: 'app/(app)/dashboard/loading.tsx', source: '' },
        { path: 'app/(app)/problems/(catalog)/loading.tsx', source: '' },
        { path: 'app/(app)/sessions/page.tsx', source: 'return <Suspense fallback={null}>' },
      ]),
    ).toHaveLength(4);
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
