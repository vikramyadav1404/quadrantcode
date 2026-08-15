/**
 * The day boundary. The only place in the codebase where a timezone is resolved.
 *
 * > A "day" means a day in the USER's IANA timezone. Never UTC, never the
 * > server's zone.
 *
 * Everything else in this module operates on `YYYY-MM-DD` strings that came out
 * of here. That is deliberate: timezone bugs are hard to find because the wrong
 * answer looks like a plausible date, so there is exactly one function that can
 * produce one and exactly one place to test.
 *
 * ## Why `Intl.DateTimeFormat` and not a date library
 *
 * It is built into Node, it is IANA-aware, and it gets DST right because it
 * consults tzdata rather than an offset. `en-CA` is used purely because its
 * short date format IS `YYYY-MM-DD`; nothing else about the locale matters, and
 * the parts are read individually rather than trusting the joined string.
 *
 * ## The tzdata caveat, which is why the cross-check test exists
 *
 * Node and Postgres each carry their own copy of tzdata and can be built
 * against different versions. `daily_sessions.local_date` is written from THIS
 * function, and any query that used `AT TIME ZONE` would use Postgres's copy.
 * If the two ever disagreed, every stored date would be quietly wrong while
 * both layers looked green — an assumption spanning two layers with no test
 * spanning them. `tests/streak/day.test.ts` spans them.
 */

/** A local calendar date, `YYYY-MM-DD`. Never a `Date`, never an instant. */
export type LocalDate = string;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Formatter construction is not free and these are reused constantly. */
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `Intl` silently remaps legacy abbreviations, and one of them is a trap.
 *
 *   IST → Asia/Calcutta      plausible, and right by luck
 *   EST → America/Panama     PLAUSIBLE AND WRONG
 *   GMT → UTC
 *
 * `America/Panama` does not observe DST. A user stored as `EST` would be
 * constructed without error, resolve to a real zone, produce real-looking
 * dates, and be an hour out for half the year — every streak silently breaking
 * around the DST boundary and nowhere to look for it.
 *
 * Rejecting these cannot be done by comparing the resolved zone to the input:
 * `Asia/Kolkata` legitimately resolves to `Asia/Calcutta`, and that is this
 * project's default. The discriminator is structural instead — a real IANA
 * identifier is `Area/Location`; the dangerous abbreviations have no slash.
 * `UTC` is the one accepted exception.
 */
function assertIanaShape(timeZone: string): void {
  if (timeZone.toUpperCase() === 'UTC') return;
  if (timeZone.includes('/')) return;

  throw new RangeError(
    `Refusing timezone "${timeZone}": not an IANA Area/Location identifier. ` +
      `Intl would silently map it to a real zone with the wrong DST rules ` +
      `(EST becomes America/Panama, which has none).`,
  );
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;

  assertIanaShape(timeZone);

  /*
   * Constructing with an unknown zone throws RangeError, which is the rest of
   * the validation. The `users.timezone` trigger already rejects non-IANA
   * values at the database, so reaching here with a bad one means something
   * bypassed it — and throwing is the right answer to that, not silently
   * falling back to UTC. A silent UTC fallback is how every streak on a
   * bad-data account drifts by a day with nobody noticing.
   */
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/**
 * The local calendar date an instant falls on, in the given zone.
 *
 * @example
 * // The same instant, two zones, two different days — the whole point.
 * localDateFor(new Date('2026-03-01T18:30:00Z'), 'Asia/Kolkata')     // '2026-03-02'
 * localDateFor(new Date('2026-03-01T18:30:00Z'), 'America/New_York') // '2026-03-01'
 */
export function localDateFor(instant: Date, timeZone: string): LocalDate {
  const parts = formatterFor(timeZone).formatToParts(instant);

  /*
   * Parts, not the joined string. `format()` returns a locale-formatted string
   * and relies on `en-CA` continuing to mean ISO order forever; reading the
   * named parts asks for the values directly and cannot be broken by a CLDR
   * change to that locale's pattern.
   */
  let year = '';
  let month = '';
  let day = '';
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }

  const result = `${year}-${month}-${day}`;
  if (!LOCAL_DATE.test(result)) {
    throw new Error(`localDateFor: produced a non-ISO date ${result} for ${timeZone}`);
  }
  return result;
}

/** Is this a well-formed `YYYY-MM-DD`, and a date that exists? */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) return false;

  /*
   * Two different failure modes, which is why this needs both a try and a
   * comparison:
   *
   *   '2026-04-31'  parses, then ROLLS OVER to 2026-05-01 — caught by the
   *                 round-trip comparison
   *   '2026-13-01'  is not parseable at all, and `toISOString()` THROWS
   *                 RangeError rather than returning something comparable
   *
   * A predicate that throws is worse than one that returns false: every caller
   * would need a try/catch around a function whose name promises a boolean.
   */
  try {
    return toUtcNoon(value).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

/**
 * A `Date` at noon UTC on the given local date.
 *
 * Noon, not midnight, and this is the load-bearing detail in all the arithmetic
 * below. Adding or subtracting 24h from midnight can land on the previous day
 * in a zone behind UTC; from noon there is 12 hours of slack in both directions,
 * so day arithmetic cannot cross a boundary by accident. The value is never
 * shown to anyone — it exists only so date maths is done on a real calendar
 * rather than on strings.
 */
function toUtcNoon(date: LocalDate): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The calendar date `days` before `date`.
 *
 * Calendar arithmetic, deliberately NOT string arithmetic. Decrementing the day
 * component of a string is where month rollovers, leap days and year boundaries
 * go wrong — `2024-03-01` back one day is `2024-02-29` only in a leap year, and
 * `2026-01-01` back one day changes the year. `Date` already knows all of that.
 */
export function previousLocalDate(date: LocalDate, days = 1): LocalDate {
  const shifted = new Date(toUtcNoon(date).getTime() - days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

/** The calendar date `days` after `date`. */
export function nextLocalDate(date: LocalDate, days = 1): LocalDate {
  const shifted = new Date(toUtcNoon(date).getTime() + days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcNoon(to).getTime() - toUtcNoon(from).getTime()) / DAY_MS);
}

/** `YYYY-MM`, used for the monthly freeze allowance (D18). */
export function localMonthOf(date: LocalDate): string {
  return date.slice(0, 7);
}

/** Every date from `from` to `to` inclusive. Empty when `to` precedes `from`. */
export function localDateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_, index) => nextLocalDate(from, index));
}
