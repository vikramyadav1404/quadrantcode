/**
 * Keyset ("cursor") pagination. No OFFSET anywhere — F1.1 requirement 1.
 *
 * Why keyset rather than OFFSET:
 *   - OFFSET n makes the database walk and discard n rows, so page 50 costs
 *     fifty times page 1.
 *   - More importantly, OFFSET is UNSTABLE. Insert a row while a user is
 *     paging and every later page shifts by one: a row is silently skipped and
 *     another is shown twice. Keyset pagination anchors on the last row's sort
 *     key, so inserts elsewhere cannot move the window.
 *
 * The sort key is `(created_at DESC, id DESC)`. `created_at` alone is not
 * unique — a bulk import stamps many rows in the same millisecond — and a
 * non-unique keyset loses or repeats rows at the tie boundary. `id` breaks the
 * tie and makes the ordering total.
 *
 * The cursor is base64 of that pair. It is opaque to the client but NOT
 * trusted: `decodeCursor` validates the shape and rejects anything else, so a
 * tampered token produces a typed error rather than a malformed query.
 *
 * ## The timestamp keeps its microseconds
 *
 * `created_at` is a Postgres `timestamptz`, stored to the microsecond. The
 * cursor used to carry a JavaScript `Date`, which holds milliseconds, so the
 * anchor was the row's time truncated. Every row stamped in one transaction
 * shares the same `now()`, microseconds included, and for those rows the
 * truncated anchor was neither equal to nor greater than their timestamp: the
 * id tie-break never ran and the rest of the group was skipped. Found on
 * 2026-11-09 when the catalog's originals-first view put a page boundary inside
 * batch 1's sixteen problems and the sixteenth vanished. The anchor is now the
 * database's own text form with all six fractional digits
 * (`listProblems` selects it), compared back as `timestamptz`.
 *
 * Older tokens, with three fractional digits, still decode; they page the way
 * they always did.
 */
import { InvalidCursorError } from './errors';

export type Cursor = {
  /** ISO-8601 UTC, `Z`-suffixed, with one to six fractional digits. */
  createdAt: string;
  id: string;
};

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(token: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError();
  }

  const separator = decoded.lastIndexOf('|');
  if (separator === -1) throw new InvalidCursorError();

  const timestamp = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);

  if (!UUID.test(id)) throw new InvalidCursorError();

  if (!TIMESTAMP.test(timestamp) || Number.isNaN(new Date(timestamp).getTime())) {
    throw new InvalidCursorError();
  }

  return { createdAt: timestamp, id };
}

/** Round-trips a cursor. Exported for tests and for callers that echo a page token. */
export function isValidCursor(token: string): boolean {
  try {
    decodeCursor(token);
    return true;
  } catch {
    return false;
  }
}
