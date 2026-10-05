/**
 * The v2 solve screen's marker: the `data-testid` on `SolveShellV2`'s root.
 *
 * One definition, used by the shell and by both specs. `e2e/solve-v2-off.spec.ts`
 * asserts this string appears in NO response /solve returns with the flag off
 * (HTML, RSC payload and JS chunks); `e2e/solve-v2-shell.spec.ts` asserts it is
 * on the page with the flag on.
 *
 * Imported only by server code and tests, so it never reaches a client bundle
 * on its own.
 */
export const SOLVE_V2_MARKER = 'solve-v2-shell';
