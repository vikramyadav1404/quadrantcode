/**
 * F1.3 · the day boundary.
 *
 * The ticket's own warning: "timezone handling wrong = streak breaks daily =
 * product is dead". This file is the deliverable that matters, not the heatmap.
 *
 * Postgres-backed assertions are at the bottom and skip without a test
 * database; everything above is pure and always runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  daysBetween,
  isLocalDate,
  localDateFor,
  localDateRange,
  localMonthOf,
  nextLocalDate,
  previousLocalDate,
} from '@/server/services/streak/day';
import { type TestContext, hasTestDatabase, setupTestDb } from '../helpers/db';

const IST = 'Asia/Kolkata'; // +05:30, no DST
const NY = 'America/New_York'; // −05:00 / −04:00, DST
const CHATHAM = 'Pacific/Chatham'; // +12:45 / +13:45 — a 45-minute offset

describe('F1.3 · localDateFor — the acceptance criterion', () => {
  it('a solve at 23:59 IST counts for that IST day, not the next UTC day', () => {
    // 23:59 IST on 2026-03-01 is 18:29 UTC the same day, so this one is easy.
    // The one BELOW is the criterion that actually bites.
    const instant = new Date('2026-03-01T18:29:00Z');
    expect(localDateFor(instant, IST)).toBe('2026-03-01');
  });

  it('a solve at 00:01 IST is the NEW IST day while UTC is still on the old one', () => {
    /*
     * 00:01 IST on 2026-03-02 is 18:31 UTC on 2026-03-01. A naive
     * `toISOString().slice(0,10)` returns 2026-03-01 and the solve lands on
     * yesterday — the streak silently breaks for every user in a positive
     * offset who solves after 18:30 UTC.
     */
    const instant = new Date('2026-03-01T18:31:00Z');

    expect(localDateFor(instant, IST)).toBe('2026-03-02');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-03-01'); // the wrong answer
  });

  it('the same instant is a DIFFERENT day in IST and New York', () => {
    // The negative-offset half of the criterion. One instant, two days.
    const instant = new Date('2026-03-01T18:30:00Z');
    expect(localDateFor(instant, IST)).toBe('2026-03-02');
    expect(localDateFor(instant, NY)).toBe('2026-03-01');
  });

  it('a solve at 23:59 New York counts for that NY day, not the next UTC day', () => {
    // 23:59 EST on 2026-03-01 is 04:59 UTC on 2026-03-02 — the negative-offset
    // mirror, where UTC has already rolled over and the user has not.
    const instant = new Date('2026-03-02T04:59:00Z');
    expect(localDateFor(instant, NY)).toBe('2026-03-01');
  });

  it('handles a 45-minute offset zone', () => {
    // Chatham is +12:45. Offsets are not all whole hours, and anything that
    // divides by 3600000 gets this wrong.
    const instant = new Date('2026-03-01T11:16:00Z'); // 00:01 next day in Chatham
    expect(localDateFor(instant, CHATHAM)).toBe('2026-03-02');
  });
});

describe('F1.3 · localDateFor — DST', () => {
  it('spring-forward: the missing hour does not shift the date', () => {
    /*
     * 2026-03-08, America/New_York. 02:00 jumps to 03:00, so the day is 23
     * hours long. Every instant across it must still report 2026-03-08.
     */
    const across = [
      '2026-03-08T04:59:00Z', // 23:59 on the 7th, EST
      '2026-03-08T05:00:00Z', // 00:00 on the 8th, EST
      '2026-03-08T06:59:00Z', // 01:59 EST — the last moment before the jump
      '2026-03-08T07:00:00Z', // 03:00 EDT — 02:00 never happens
      '2026-03-09T03:59:00Z', // 23:59 on the 8th, EDT
    ].map((iso) => localDateFor(new Date(iso), NY));

    expect(across).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-08',
      '2026-03-08',
      '2026-03-08',
    ]);
  });

  it('fall-back: the repeated hour resolves to ONE date', () => {
    /*
     * 2026-11-01, America/New_York. 01:00–02:00 happens twice — once EDT, once
     * EST — so the day is 25 hours long and 01:30 is genuinely ambiguous.
     *
     * The assertion the review asked for: BOTH occurrences must land on the
     * same local DATE. That is a property of the calendar rather than of
     * anything we wrote, which is exactly why it is asserted rather than left
     * implicit in a passing test — if it were ever false, a solve in the
     * repeated hour would be attributed to the wrong day.
     */
    const firstOneThirty = new Date('2026-11-01T05:30:00Z'); // 01:30 EDT
    const secondOneThirty = new Date('2026-11-01T06:30:00Z'); // 01:30 EST

    expect(localDateFor(firstOneThirty, NY)).toBe('2026-11-01');
    expect(localDateFor(secondOneThirty, NY)).toBe('2026-11-01');
    expect(localDateFor(firstOneThirty, NY)).toBe(localDateFor(secondOneThirty, NY));
  });

  it('a 25-hour day still spans exactly one date', () => {
    const across = [
      '2026-11-01T03:59:00Z', // 23:59 on 10-31, EDT
      '2026-11-01T04:00:00Z', // 00:00 on 11-01, EDT
      '2026-11-02T04:59:00Z', // 23:59 on 11-01, EST
      '2026-11-02T05:00:00Z', // 00:00 on 11-02, EST
    ].map((iso) => localDateFor(new Date(iso), NY));

    expect(across).toEqual(['2026-10-31', '2026-11-01', '2026-11-01', '2026-11-02']);
  });

  it('IST has no DST, so nothing shifts across the same dates', () => {
    // The positive control for the DST tests: if localDateFor were applying a
    // fixed offset rather than consulting tzdata, these would still pass while
    // the New York ones failed. Asserting both directions is what distinguishes
    // "handles DST" from "happens to be right for this zone".
    expect(localDateFor(new Date('2026-03-08T06:59:00Z'), IST)).toBe('2026-03-08');
    expect(localDateFor(new Date('2026-11-01T06:30:00Z'), IST)).toBe('2026-11-01');
  });

  it('rejects a zone that is not IANA rather than falling back to UTC', () => {
    // A silent UTC fallback is how every streak on a bad-data account drifts by
    // a day with nobody noticing.
    expect(() => localDateFor(new Date(), 'Not/AZone')).toThrow();
  });

  it('rejects legacy ABBREVIATIONS, which Intl silently remaps', () => {
    /*
     * The trap this found. Intl accepts these and maps them to real zones:
     *
     *   IST -> Asia/Calcutta     plausible, right by luck
     *   EST -> America/Panama    PLAUSIBLE AND WRONG — Panama has no DST
     *   GMT -> UTC
     *
     * A user stored as 'EST' would construct without error, resolve to a real
     * zone, produce real-looking dates, and be an hour out for half the year.
     */
    for (const abbreviation of ['IST', 'EST', 'GMT', 'PST', 'CET']) {
      expect(() => localDateFor(new Date(), abbreviation), abbreviation).toThrow(/IANA/);
    }
  });

  it('proves the remap is real, and that EST is the dangerous one', () => {
    /*
     * The positive control for the guard above. If Intl ever stopped remapping,
     * the guard would be protecting against nothing and this test says so.
     */
    const resolved = (zone: string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: zone }).resolvedOptions().timeZone;

    expect(resolved('EST')).toBe('America/Panama');
    // …and Panama has no DST, so the two would diverge across a US DST change.
    const afterUsDstChange = new Date('2026-03-08T07:30:00Z');
    expect(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Panama',
        hour: '2-digit',
        hour12: false,
      }).format(afterUsDstChange),
    ).not.toBe(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        hour12: false,
      }).format(afterUsDstChange),
    );
  });

  it('still accepts real zones, including aliases and UTC', () => {
    // The other half of the control: the guard must not reject legitimate
    // input. `Asia/Kolkata` itself resolves to `Asia/Calcutta`, which is why
    // the guard is structural rather than a resolved-equals-input comparison.
    for (const zone of [
      'Asia/Kolkata',
      'Asia/Calcutta',
      'America/New_York',
      'UTC',
      'Etc/UTC',
    ]) {
      expect(() => localDateFor(new Date(), zone), zone).not.toThrow();
    }
  });
});

describe('F1.3 · date arithmetic — where string arithmetic dies', () => {
  it.each([
    ['leap day backwards', '2024-03-01', '2024-02-29'],
    ['NON-leap year backwards', '2026-03-01', '2026-02-28'],
    ['year boundary backwards', '2026-01-01', '2025-12-31'],
    ['month boundary backwards', '2026-05-01', '2026-04-30'],
    ['31-day month backwards', '2026-08-01', '2026-07-31'],
  ])('%s: %s → %s', (_label, from, expected) => {
    expect(previousLocalDate(from)).toBe(expected);
  });

  it.each([
    ['leap day forwards', '2024-02-28', '2024-02-29'],
    ['NON-leap year forwards', '2026-02-28', '2026-03-01'],
    ['year boundary forwards', '2025-12-31', '2026-01-01'],
  ])('%s: %s → %s', (_label, from, expected) => {
    expect(nextLocalDate(from)).toBe(expected);
  });

  it('round-trips across every boundary', () => {
    for (const date of ['2024-02-29', '2026-01-01', '2025-12-31', '2026-03-01']) {
      expect(nextLocalDate(previousLocalDate(date))).toBe(date);
      expect(previousLocalDate(nextLocalDate(date))).toBe(date);
    }
  });

  it('counts days across a leap year correctly', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // leap: 29th exists
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1); // no 29th
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });

  it('is negative when the range runs backwards', () => {
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1);
    expect(localDateRange('2026-03-01', '2026-02-28')).toEqual([]);
  });

  it('builds an inclusive range', () => {
    expect(localDateRange('2026-02-27', '2026-03-01')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
    expect(localDateRange('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
    expect(localDateRange('2026-01-01', '2026-12-31')).toHaveLength(365);
  });

  it('validates real dates and rejects impossible ones', () => {
    expect(isLocalDate('2024-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false); // not a leap year
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-04-31')).toBe(false);
    expect(isLocalDate('2026-3-01')).toBe(false);
    expect(isLocalDate(20260301)).toBe(false);
  });

  it('localMonthOf is the freeze allowance window', () => {
    expect(localMonthOf('2026-03-08')).toBe('2026-03');
    expect(localMonthOf('2026-12-31')).toBe('2026-12');
  });
});

/**
 * The cross-check.
 *
 * Node and Postgres each ship their own tzdata and can be built against
 * different versions. Every `local_date` in the database comes from
 * `localDateFor`; any SQL using `AT TIME ZONE` would use Postgres's copy. If
 * they ever disagreed, every stored date would be quietly wrong while both
 * layers reported green — an assumption spanning two layers with no test
 * spanning them. This is that test.
 */
const suite = hasTestDatabase ? describe : describe.skip;

suite('F1.3 · Node and Postgres agree on the day boundary', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  const INSTANTS = [
    '2026-03-01T18:29:00Z',
    '2026-03-01T18:31:00Z', // the IST rollover
    '2026-03-02T04:59:00Z', // the NY rollover
    '2026-03-08T06:59:00Z', // spring-forward, before
    '2026-03-08T07:00:00Z', // spring-forward, after
    '2026-11-01T05:30:00Z', // fall-back, first 01:30
    '2026-11-01T06:30:00Z', // fall-back, second 01:30
    '2024-02-29T12:00:00Z', // leap day
    '2025-12-31T23:30:00Z', // year boundary
  ];

  it.each([IST, NY, CHATHAM, 'UTC', 'Europe/London', 'Australia/Lord_Howe'])(
    'agrees for every sample instant in %s',
    async (timeZone) => {
      for (const iso of INSTANTS) {
        const [row] = await ctx.sql`
          SELECT to_char((${iso}::timestamptz AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS d
        `;
        expect(localDateFor(new Date(iso), timeZone), `${iso} in ${timeZone}`).toBe(row!.d);
      }
    },
  );

  it('the cross-check can actually fail', async () => {
    /*
     * The positive control. If the SQL above were subtly wrong — comparing
     * against UTC, say — every assertion would pass for UTC and quietly pass
     * for the others too if `localDateFor` had the same bug. This asserts the
     * two produce DIFFERENT answers for different zones, so the comparison is
     * discriminating rather than tautological.
     */
    const iso = '2026-03-01T18:30:00Z';
    const [row] = await ctx.sql`
      SELECT
        to_char((${iso}::timestamptz AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS ist,
        to_char((${iso}::timestamptz AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD') AS ny
    `;
    expect(row!.ist).not.toBe(row!.ny);
    expect(row!.ist).toBe('2026-03-02');
    expect(row!.ny).toBe('2026-03-01');
  });
});
