/**
 * Where middleware sends a /solve request while FEATURE_SOLVE_V2 is on (C2).
 *
 * v2 is a separate internal route, `/problems/[slug]/solve/v2`, in its own
 * route group with its own layout. Two reasons, both measured:
 *
 * - **Bundles.** A client component imported anywhere in a page's server graph
 *   lands in that route's JavaScript, `next/dynamic` or not. With v2 in the v1
 *   page, the strip's code shipped to every v1 user (CI run 37285772277:
 *   `solve/page-*.js` contained the strip marker with the flag off). A separate
 *   route keeps v1's chunk free of v2 code.
 * - **One timer.** The v2 route's layout renders no layout timer bar at all, so
 *   the strip is the only "Solve session timer", with one heartbeat.
 *
 * The browser URL never changes: this is a rewrite, not a redirect. With the
 * flag off it returns null for everything, and the middleware does nothing.
 *
 * Pure, so the middleware stays a thin caller and the rule is unit-tested.
 */
const SOLVE_PATH = /^\/problems\/([^/]+)\/solve\/?$/;

export function solveV2Rewrite(pathname: string, enabled: boolean): string | null {
  if (!enabled) return null;
  const match = SOLVE_PATH.exec(pathname);
  return match ? `/problems/${match[1]}/solve/v2` : null;
}
