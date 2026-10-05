/**
 * Step T · a date is formatted in the reader's timezone, not the server's.
 *
 * Compared day-to-day rather than against literal strings, so the assertions
 * hold under any default locale: an instant is rendered in a zone, and the
 * result must equal that calendar day rendered at noon UTC.
 */
import { describe, expect, it } from 'vitest';
import { formatDay } from '@/lib/time/format-day';

/** Noon UTC on a given calendar day: the same day in every zone used here. */
const day = (isoDate: string) => formatDay(new Date(`${isoDate}T12:00:00Z`), 'UTC');

describe('T · formatDay', () => {
  it('11pm-ish UTC is ALREADY TOMORROW in Asia/Kolkata', () => {
    const instant = new Date('2026-10-03T19:00:00Z'); // 00:30 on 4 Oct in IST

    expect(formatDay(instant, 'Asia/Kolkata')).toBe(day('2026-10-04'));
    expect(formatDay(instant, 'UTC')).toBe(day('2026-10-03'));
  });

  it('an early-morning UTC instant is STILL YESTERDAY in America/Los_Angeles', () => {
    const instant = new Date('2026-10-04T03:00:00Z'); // 20:00 on 3 Oct in PDT

    expect(formatDay(instant, 'America/Los_Angeles')).toBe(day('2026-10-03'));
    expect(formatDay(instant, 'UTC')).toBe(day('2026-10-04'));
  });

  it('POSITIVE CONTROL · the two zones really disagree for that instant', () => {
    const instant = new Date('2026-10-03T19:00:00Z');
    expect(formatDay(instant, 'Asia/Kolkata')).not.toBe(formatDay(instant, 'UTC'));
  });

  it('returns null for a missing date rather than a placeholder', () => {
    expect(formatDay(null, 'UTC')).toBeNull();
    expect(formatDay(undefined, 'Asia/Kolkata')).toBeNull();
  });
});
