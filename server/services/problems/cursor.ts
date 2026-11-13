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
 * The sort key is `(difficulty, number)`: easiest first, then by the
 * problem's public number. `number` is unique (migration 0028), so the order
 * is total without a tiebreak, and both columns are exact integers or enum
 * labels — none of the precision trouble the old `(created_at, id)` key had
 * with microsecond timestamps.
 *
 * The cursor is base64 of that pair. It is opaque to the client but NOT
 * trusted: `decodeCursor` validates the shape and rejects anything else, so a
 * tampered token produces a typed error rather than a malformed query.
 *
 * Tokens issued before 0028 carried `created_at|id` and no longer decode. The
 * catalog page answers one by starting from the first page rather than
 * failing.
 */
import { InvalidCursorError } from './errors';

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type Cursor = {
  difficulty: Difficulty;
  /** The last row's `problems.number`. */
  number: number;
};

/** Postgres `integer`: a number outside it cannot be a row's. */
const MAX_NUMBER = 2_147_483_647;

const NUMBER = /^[1-9]\d{0,9}$/;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.difficulty}|${cursor.number}`, 'utf8').toString('base64url');
}

export function decodeCursor(token: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError();
  }

  const separator = decoded.indexOf('|');
  if (separator === -1) throw new InvalidCursorError();

  const difficulty = decoded.slice(0, separator);
  const digits = decoded.slice(separator + 1);

  if (!(DIFFICULTIES as readonly string[]).includes(difficulty)) throw new InvalidCursorError();
  if (!NUMBER.test(digits)) throw new InvalidCursorError();

  const number = Number(digits);
  if (number > MAX_NUMBER) throw new InvalidCursorError();

  return { difficulty: difficulty as Difficulty, number };
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
