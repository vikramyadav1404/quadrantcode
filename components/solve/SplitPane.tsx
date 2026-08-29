'use client';

/**
 * Two panes with a draggable divider between them.
 *
 * ## Written rather than installed
 *
 * The obvious packages (`react-split-pane`, `allotment`) are 20–40 kB for a
 * mouse handler and a CSS grid. This project has made that trade twice already
 * — inline SVG instead of Recharts (**D22**) and a hand-written diff instead of
 * `diff` (**D25**) — and the reasoning is the same: a dependency that F4.8 has
 * to audit should earn its place.
 *
 * ## Below the breakpoint there is no split
 *
 * Two panes at 375px means two unusable panes. Under `md` the children stack
 * and the caller shows tabs instead — which is what LeetCode does too, and what
 * `e2e/viewports.spec.ts` checks at 375 / 768 / 1440.
 *
 * ## The divider is reachable from a keyboard
 *
 * `role="separator"` with arrow keys, because a mouse-only control in the
 * middle of the primary working screen is one a keyboard user simply cannot
 * move. F0.4's keyboard traversal test exists for exactly this class of thing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Percent of the width given to the left pane. */
const DEFAULT_SPLIT = 42;
const MIN_SPLIT = 25;
const MAX_SPLIT = 70;

/** How far one arrow-key press moves the divider. */
const KEYBOARD_STEP = 2;

export function SplitPane({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Named for the separator's accessible label — "resize the problem panel". */
  leftLabel: string;
  rightLabel: string;
}) {
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const clamp = (value: number) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));

  const onPointerMove = useCallback((event: PointerEvent) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return;

    setSplit(clamp(((event.clientX - bounds.left) / bounds.width) * 100));
  }, []);

  /*
   * Listeners on the WINDOW, not the divider. A pointer moving faster than
   * React re-renders leaves the divider behind, and a handler bound to the
   * divider then stops receiving events mid-drag — the drag "sticks" and the
   * user has to click to recover.
   */
  useEffect(() => {
    if (!dragging) return;

    const stop = () => setDragging(false);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    // A drag that survives the pointer leaving the window is a stuck drag.
    window.addEventListener('pointercancel', stop);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging, onPointerMove]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col md:grid md:h-[calc(100vh-8rem)]"
      ref={container}
      style={{
        // Only the md+ grid uses the ratio; below it the flex column ignores it.
        gridTemplateColumns: `${split}% 0.5rem 1fr`,
      }}
    >
      <div className="min-h-0 overflow-auto" data-pane="left">
        {left}
      </div>

      {/*
        One element, hidden below md where there is no split to resize.

        `hidden` sets `display: none`, which removes it from the accessibility
        tree AND from the tab order — so no `aria-hidden` is needed, and adding
        one would be worse: an `aria-hidden` container wrapping a `tabIndex={0}`
        child is focusable-but-invisible to a screen reader, which is the exact
        thing that rule exists to prevent.
      */}
      <div
        aria-label={`Resize ${leftLabel} and ${rightLabel}`}
        aria-orientation="vertical"
        aria-valuemax={MAX_SPLIT}
        aria-valuemin={MIN_SPLIT}
        aria-valuenow={Math.round(split)}
        className="hidden cursor-col-resize bg-[var(--border)] transition-colors hover:bg-[var(--accent)] focus-visible:bg-[var(--accent)] focus-visible:outline-none md:block"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setSplit((value) => clamp(value - KEYBOARD_STEP));
          if (event.key === 'ArrowRight') setSplit((value) => clamp(value + KEYBOARD_STEP));
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        role="separator"
        tabIndex={0}
      />

      <div className="min-h-0 overflow-auto" data-pane="right">
        {right}
      </div>
    </div>
  );
}
