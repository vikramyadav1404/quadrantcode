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
 */
import { InvalidCursorError } from './errors';

export type Cursor = {
  createdAt: Date;
  id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
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

  const createdAt = new Date(timestamp);
  if (Number.isNaN(createdAt.getTime())) throw new InvalidCursorError();

  return { createdAt, id };
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
