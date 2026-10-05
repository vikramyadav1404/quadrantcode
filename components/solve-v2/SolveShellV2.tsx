/**
 * The v2 solve screen's shell, rendered only by the v2 route
 * (`app/(solve-v2)/problems/[slug]/solve/v2/page.tsx`), which middleware serves
 * at /problems/[slug]/solve while FEATURE_SOLVE_V2 is on.
 *
 * ## What it holds
 *
 * - C1: the page's existing `ProblemPanel` and `RunPanel` (with the limits
 *   strip), passed in unchanged and placed in the existing `SplitPane`, so every
 *   /solve spec runs unchanged against v2 (the `chromium-v2` project).
 * - C2: the session strip above them while a sitting is live. The v2 route's
 *   layout renders no layout timer bar, so the strip is the only one.
 *
 * ## Rules for everything v2 adds
 *
 * - **v2 client components are imported only from this file** (or from files
 *   only it imports). Only the v2 route imports this file, so v2 code is in that
 *   route's bundle and never in v1's.
 * - **This file stays a server component.**
 * - **Every v2 component carries a marker** from `lib/solve-v2/marker.ts`.
 *   `e2e/solve-v2-off.spec.ts` checks every response /solve returns with the
 *   flag off (HTML, RSC payload and JS chunks) for all of them.
 * - **No Suspense boundary.** D39: a boundary above the timer drops
 *   server-action renders. `tests/app/no-loading-boundary.test.ts` enforces it.
 */
import { SplitPane } from '@/components/solve/SplitPane';
import { SOLVE_V2_MARKER } from '@/lib/solve-v2/marker';
import type { StripEventView } from '@/lib/solve-v2/strip-view';
import type { TimerBarState } from '@/lib/session/timer-bar-state';
import type { Confidence } from '@/lib/session/confidence';
import type { StuckCategory } from '@/lib/reflection/taxonomy';
import { SessionStripV2 } from './SessionStripV2';

type Result = Promise<{ ok: boolean; message?: string }>;

export type SolveShellV2Strip = {
  state: TimerBarState;
  events: StripEventView[];
  onPause: (input: { sessionId: string }) => Result;
  onResume: (input: { sessionId: string }) => Result;
  onAbandon: (input: { sessionId: string }) => Result;
  onComplete: (input: {
    sessionId: string;
    outcome: 'solved' | 'stuck';
    confidence?: Confidence;
  }) => Result;
  onMarkStuck: (input: { sessionId: string; category: StuckCategory; note?: string }) => Result;
};

export function SolveShellV2({
  problemPanel,
  editor,
  strip,
}: {
  /** The page's `ProblemPanel`, unchanged. */
  problemPanel: React.ReactNode;
  /** The page's `RunPanel` and the execution-limits strip, unchanged. */
  editor: React.ReactNode;
  /** The live sitting, if any: the same session the timer bar would show. */
  strip: SolveShellV2Strip | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={SOLVE_V2_MARKER}>
      {strip ? <SessionStripV2 {...strip} /> : null}
      <SplitPane
        leftLabel="the problem"
        rightLabel="the editor"
        left={problemPanel}
        right={editor}
      />
    </div>
  );
}
