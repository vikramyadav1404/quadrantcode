/**
 * The v2 solve screen's shell, rendered only when FEATURE_SOLVE_V2 is on.
 *
 * ## What it holds
 *
 * - C1: the page's existing `ProblemPanel` and `RunPanel` (with the limits
 *   strip), passed in unchanged and placed in the existing `SplitPane`, so every
 *   /solve spec runs unchanged against v2 (the `chromium-v2` project).
 * - C2: the session strip above them while a sitting is live.
 *
 * ## Rules for everything v2 adds
 *
 * - **v2 client components are imported only from this file** (or from files
 *   only it imports), never from the solve page or any shared component, so
 *   v1's client bundle cannot pick them up. They are loaded with `next/dynamic`
 *   so their code is a separate chunk, fetched only when this shell renders.
 * - **This file stays a server component.**
 * - **Every v2 component carries a marker** from `lib/solve-v2/marker.ts`.
 *   `e2e/solve-v2-off.spec.ts` checks every response /solve returns with the
 *   flag off (HTML, RSC payload and JS chunks) for all of them.
 * - **No Suspense boundary.** D39: a boundary above the timer bar drops
 *   server-action renders. `tests/app/no-loading-boundary.test.ts` enforces it.
 */
import dynamic from 'next/dynamic';
import { SplitPane } from '@/components/solve/SplitPane';
import { SOLVE_V2_MARKER } from '@/lib/solve-v2/marker';
import type { StripEventView } from '@/lib/solve-v2/strip-view';
import type { TimerBarState } from '@/lib/session/timer-bar-state';
import type { Confidence } from '@/lib/session/confidence';
import type { StuckCategory } from '@/lib/reflection/taxonomy';

const SessionStripV2 = dynamic(() =>
  import('./SessionStripV2').then((module) => module.SessionStripV2),
);

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

/*
 * While the strip is on the page, the layout's timer bar is hidden so there is
 * one "Solve session timer". By CSS, scoped to this page by the strip's own
 * marker, which means:
 *   · the layout and TimerBar are untouched (flag off is byte-identical);
 *   · the hidden bar stays mounted and keeps the heartbeat going;
 *   · navigating away unmounts the strip, and the bar is back with no state.
 */
const HIDE_LAYOUT_TIMER_BAR =
  'body:has([data-solve-v2-strip]) [role="region"][aria-label="Solve session timer"]:not([data-solve-v2-strip]){display:none}';

export function SolveShellV2({
  problemPanel,
  editor,
  strip,
}: {
  /** The page's `ProblemPanel`, unchanged. */
  problemPanel: React.ReactNode;
  /** The page's `RunPanel` and the execution-limits strip, unchanged. */
  editor: React.ReactNode;
  /** The live sitting, if any — the same session the timer bar would show. */
  strip: SolveShellV2Strip | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={SOLVE_V2_MARKER}>
      {strip ? (
        <>
          <style>{HIDE_LAYOUT_TIMER_BAR}</style>
          <SessionStripV2 {...strip} />
        </>
      ) : null}
      <SplitPane
        leftLabel="the problem"
        rightLabel="the editor"
        left={problemPanel}
        right={editor}
      />
    </div>
  );
}
