/**
 * Browsers submit `<textarea>` values with CRLF line endings: the HTML form
 * submission algorithm normalises every newline to CRLF. Stored native content
 * uses LF, which is what the batch files hold and what the importer compares
 * against.
 *
 * On 2026-11-09 two admin saves of an unchanged harbour-lot-echo statement
 * stored it with CRLF. The next `native:import` saw "version 1 changed" and
 * refused the whole import until the row was fixed by hand. Every admin form
 * now passes through this before validation, so a save can only change what
 * the admin actually changed.
 */
export function normalizeFormNewlines(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value,
    ]),
  );
}
