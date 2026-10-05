/**
 * What crosses from the server to the v2 session strip, in the client-safe
 * layer (`components/` may not import `server/`, F0.1).
 *
 * Produced by `server/services/timeline/strip.ts` (`getSessionStrip`), which
 * returns exactly these fields and nothing else of an event's payload.
 */
export type StripEventView = {
  id: string;
  /** A `session_event_type` value. `code_snapshot` is never included. */
  type: string;
  /** Active seconds from the session's start, paused time excluded. */
  elapsedSeconds: number;
  /** For `run_attempted`: the recorded verdict. Otherwise null. */
  verdict: string | null;
  /** For `stuck_marked`: the chosen category. Otherwise null. */
  category: string | null;
};
