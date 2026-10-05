/**
 * The v2 solve screen's shell (step C1), rendered only when FEATURE_SOLVE_V2 is on.
 *
 * ## C1 is plumbing, not a redesign
 *
 * It places the existing `ProblemPanel` and `RunPanel` (with the limits strip
 * under it) exactly as the solve page builds them: same props, same
 * accessible names, same test ids. That is why every /solve spec can run
 * unchanged against v2 (the `chromium-v2` Playwright project), and why each
 * later step (session strip, history card, …) is a reviewable diff on top of
 * a shell already proven to lose nothing.
 *
 * ## Rules for everything v2 adds
 *
 * - **v2 client components are imported only from this file** (or from files
 *   only it imports), never from the solve page or any shared component, so
 *   v1's client bundle cannot pick them up.
 * - **This file stays a server component.** The marker below is in server
 *   output only. `e2e/solve-v2-off.spec.ts` checks every response /solve
 *   returns with the flag off (HTML, RSC payload and JS chunks) for the marker,
 *   so v2 code reaching v1's bundle fails CI. If a later step's client code
 *   does get bundled into the route, load it with `next/dynamic` from here.
 * - **No Suspense boundary.** D39: a boundary above the timer bar drops
 *   server-action renders. `tests/app/no-loading-boundary.test.ts` enforces it.
 */
import { SplitPane } from '@/components/solve/SplitPane';
import { SOLVE_V2_MARKER } from '@/lib/solve-v2/marker';

export function SolveShellV2({
  problemPanel,
  editor,
}: {
  /** The page's `ProblemPanel`, unchanged. */
  problemPanel: React.ReactNode;
  /** The page's `RunPanel` and the execution-limits strip, unchanged. */
  editor: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={SOLVE_V2_MARKER}>
      <SplitPane
        leftLabel="the problem"
        rightLabel="the editor"
        left={problemPanel}
        right={editor}
      />
    </div>
  );
}
