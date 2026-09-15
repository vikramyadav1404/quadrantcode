'use client';

/**
 * The live session id, shared with whatever on the page needs to know.
 *
 * ## Why this exists rather than a prop
 *
 * Components that render a notice ABOUT a session hold that notice in client
 * state, and client state is exactly what `revalidatePath` does not clear. The
 * problem page's "Session started — the timer is at the top of the page"
 * outlived the session: abandoning from the timer bar re-rendered the shell and
 * removed the bar, and the paragraph pointing at the bar stayed behind.
 *
 * The first version of this fix had the page read `getActiveSession` itself and
 * pass it down. That worked and it was wasteful: `app/(app)/layout.tsx` has
 * already done that read, one component above, and a layout cannot hand props
 * to the page beneath it. The second read also made the problem page slower to
 * render, which measurably worsened the cold-start flake in
 * `e2e/session.spec.ts` — every test there navigates and clicks immediately, so
 * time-to-hydrate is not free.
 *
 * So the value travels by context instead. No extra query, and it updates from
 * the LAYOUT's re-render rather than the page's — which matters, because the
 * timer bar disappearing is itself the proof that the layout re-renders.
 */
import { createContext, useContext } from 'react';

const ActiveSessionContext = createContext<string | null | undefined>(undefined);

export function ActiveSessionProvider({
  sessionId,
  children,
}: {
  /** The live session as the server last rendered it, or null for none. */
  sessionId: string | null;
  children: React.ReactNode;
}) {
  return (
    <ActiveSessionContext.Provider value={sessionId}>{children}</ActiveSessionContext.Provider>
  );
}

/**
 * The live session id, or null when there is none.
 *
 * Throws outside a provider rather than defaulting to null, following
 * `useToast`: a silent null here would make every session-aware notice behave
 * as though the session had just ended, which is the bug this file exists to
 * fix and would be invisible.
 */
export function useActiveSessionId(): string | null {
  const value = useContext(ActiveSessionContext);
  if (value === undefined) {
    throw new Error('useActiveSessionId must be used inside <ActiveSessionProvider>.');
  }
  return value;
}
