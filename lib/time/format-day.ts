/**
 * One date, in the reader's own timezone.
 *
 * The timezone argument is the whole reason this exists rather than a bare
 * `toLocaleDateString()`: a session finished at 11pm in Asia/Kolkata is the
 * previous day in UTC, and a "last attempted" that disagrees with the streak
 * calendar by a day is the kind of thing users notice and never trust again.
 *
 * Call it on the server, where `user.timezone` is known. Formatting a Date
 * during a client component's render would use the server's zone under SSR and
 * the browser's on hydration — a mismatch, and the wrong day for anyone whose
 * stored timezone is neither.
 *
 * Moved here from the solve page, unchanged, so the attempt history uses the
 * same rule instead of the bare `toLocaleDateString()` it had (step T of the
 * v2 solve-screen plan).
 */
export function formatDay(value: Date | null | undefined, timeZone: string): string | null {
  if (!value) return null;

  return value.toLocaleDateString(undefined, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
