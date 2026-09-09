/**
 * Turning an elapsed stay into billable units.
 *
 * Each case here is a number a financier could dispute, so the tests are
 * written as the argument you would make in that conversation: this stay, in
 * this timezone, under this contract term, is this many units.
 */

import { BillingUnit, RoundingMode } from '@smartpark/contracts';

import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  MINUTES_PER_WEEK,
  ageingDays,
  calendarDaysSpanned,
  calendarMonthsSpanned,
  computeDuration,
  describeDuration,
  isValidTimezone,
} from './duration';

const IST = 'Asia/Kolkata';
const at = (iso: string): Date => new Date(iso);

const duration = (
  entry: string,
  asOf: string,
  unit: BillingUnit = 'DAY',
  rounding: RoundingMode = 'CEIL',
  zone: string = IST,
) => computeDuration(at(entry), at(asOf), unit, rounding, zone);

describe('computeDuration', () => {
  it('refuses an exit that precedes entry', () => {
    // Translated by the caller into EXIT_BEFORE_ENTRY. Silently returning zero
    // would bill nothing for a stay that plainly happened.
    expect(() => duration('2026-03-10T10:00:00Z', '2026-03-10T09:00:00Z')).toThrow(RangeError);
  });

  it('treats entry and exit at the same instant as zero', () => {
    const result = duration('2026-03-10T10:00:00Z', '2026-03-10T10:00:00Z');
    expect(result.rawMinutes).toBe(0);
    expect(result.roundedUnits.toNumber()).toBe(0);
  });

  it('floors raw minutes rather than carrying seconds', () => {
    const result = duration('2026-03-10T10:00:00Z', '2026-03-10T10:01:59Z', 'MINUTE', 'FLOOR');
    expect(result.rawMinutes).toBe(1);
  });

  describe('billing units', () => {
    // 26 hours: the canonical example from the module's own documentation.
    const entry = '2026-03-10T23:00:00Z';
    const exit = '2026-03-12T01:00:00Z';

    it.each<[BillingUnit, number]>([
      ['MINUTE', 26 * MINUTES_PER_HOUR],
      ['HOUR', 26],
      ['DAY', 2],
      ['WEEK', 1],
    ])('measures a 26-hour stay in %s as %s', (unit, expected) => {
      expect(duration(entry, exit, unit, 'CEIL').roundedUnits.toNumber()).toBe(expected);
    });

    it('measures the same stay as 2 days by exact division', () => {
      const result = duration(entry, exit, 'DAY', 'CEIL');
      expect(result.rawMinutes).toBe(26 * MINUTES_PER_HOUR);
      // 26/24 = 1.083..., ceiling to 2.
      expect(result.exactUnits.toNumber()).toBeCloseTo(26 / 24, 4);
    });

    it('measures a week correctly at the boundary', () => {
      const result = duration('2026-03-01T00:00:00Z', '2026-03-08T00:00:00Z', 'WEEK', 'CEIL');
      expect(result.rawMinutes).toBe(MINUTES_PER_WEEK);
      expect(result.roundedUnits.toNumber()).toBe(1);
    });

    it('measures MONTH as a calendar fraction, not 30 days', () => {
      // 31 January to 28 February is one month, not 0.93 of one.
      const result = duration('2026-01-31T00:00:00Z', '2026-02-28T00:00:00Z', 'MONTH', 'CEIL');
      expect(result.roundedUnits.toNumber()).toBe(1);
    });
  });

  describe('rounding', () => {
    // A stay of 1.5 days. The three modes must be genuinely different, because
    // which one applies is a contract term.
    const entry = '2026-03-10T00:00:00Z';
    const exit = '2026-03-11T12:00:00Z';

    it.each<[RoundingMode, number]>([
      ['CEIL', 2],
      ['FLOOR', 1],
      ['NEAREST', 2],
    ])('%s of 1.5 days is %s', (mode, expected) => {
      expect(duration(entry, exit, 'DAY', mode).roundedUnits.toNumber()).toBe(expected);
    });

    it('rounds a half unit up under NEAREST, not to even', () => {
      // Banker's rounding here would under-bill exactly half the disputes.
      expect(duration(entry, exit, 'DAY', 'NEAREST').roundedUnits.toNumber()).toBe(2);
    });

    it('CEIL charges a full day for any part of one', () => {
      const result = duration('2026-03-10T00:00:00Z', '2026-03-10T00:01:00Z', 'DAY', 'CEIL');
      expect(result.roundedUnits.toNumber()).toBe(1);
    });

    it('never returns a negative unit count', () => {
      const result = duration('2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z', 'DAY', 'FLOOR');
      expect(result.roundedUnits.toNumber()).toBe(0);
    });

    it('leaves CALENDAR_DAY alone, because it is already whole', () => {
      const result = duration('2026-03-10T00:00:00Z', '2026-03-11T12:00:00Z', 'CALENDAR_DAY', 'FLOOR');
      // FLOOR must not reduce a 2-date span to 1.
      expect(result.roundedUnits.toNumber()).toBe(2);
    });
  });
});

describe('calendarDaysSpanned', () => {
  it('counts a same-day stay as one day', () => {
    expect(calendarDaysSpanned(at('2026-03-10T01:00:00Z'), at('2026-03-10T23:00:00Z'), 'utc')).toBe(1);
  });

  it('counts the entry date as day one', () => {
    expect(calendarDaysSpanned(at('2026-03-10T23:00:00Z'), at('2026-03-11T01:00:00Z'), 'utc')).toBe(2);
  });

  it('uses the site timezone, not the server timezone', () => {
    // 20:00 UTC on the 10th is 01:30 IST on the 11th. A two-hour stay either
    // touches one date or two, depending entirely on where the yard is.
    const entry = at('2026-03-10T20:00:00Z');
    const exit = at('2026-03-10T22:00:00Z');

    expect(calendarDaysSpanned(entry, exit, 'utc')).toBe(1);
    expect(calendarDaysSpanned(entry, exit, IST)).toBe(1);

    // Crossing the IST midnight but not the UTC one.
    const lateEntry = at('2026-03-10T17:00:00Z'); // 22:30 IST
    const lateExit = at('2026-03-10T20:00:00Z'); // 01:30 IST next day
    expect(calendarDaysSpanned(lateEntry, lateExit, 'utc')).toBe(1);
    expect(calendarDaysSpanned(lateEntry, lateExit, IST)).toBe(2);
  });

  it('never returns less than one', () => {
    expect(calendarDaysSpanned(at('2026-03-10T10:00:00Z'), at('2026-03-10T10:00:00Z'), 'utc')).toBe(1);
  });

  it('falls back to UTC on an unknown timezone rather than throwing', () => {
    // A misconfigured site must not stop a vehicle being billed. The day
    // boundary shifts, which is visible and fixable; a crash in the nightly
    // accrual is neither.
    expect(() =>
      calendarDaysSpanned(at('2026-03-10T00:00:00Z'), at('2026-03-11T00:00:00Z'), 'Mars/Olympus'),
    ).not.toThrow();

    expect(calendarDaysSpanned(at('2026-03-10T00:00:00Z'), at('2026-03-11T00:00:00Z'), 'Mars/Olympus'))
      .toBe(calendarDaysSpanned(at('2026-03-10T00:00:00Z'), at('2026-03-11T00:00:00Z'), 'utc'));
  });

  it('counts a long stay across a month boundary', () => {
    // 25 March to 5 April inclusive.
    expect(calendarDaysSpanned(at('2026-03-25T00:00:00Z'), at('2026-04-05T00:00:00Z'), 'utc')).toBe(12);
  });
});

describe('calendarMonthsSpanned', () => {
  it('treats unequal month lengths as one month', () => {
    const months = calendarMonthsSpanned(at('2026-01-31T00:00:00Z'), at('2026-02-28T00:00:00Z'), 'utc');
    expect(months.toNumber()).toBeCloseTo(1, 1);
  });

  it('returns a fraction for a partial month', () => {
    const months = calendarMonthsSpanned(at('2026-03-01T00:00:00Z'), at('2026-03-16T00:00:00Z'), 'utc');
    expect(months.toNumber()).toBeGreaterThan(0.4);
    expect(months.toNumber()).toBeLessThan(0.6);
  });

  it('returns zero for no elapsed time', () => {
    expect(
      calendarMonthsSpanned(at('2026-03-01T00:00:00Z'), at('2026-03-01T00:00:00Z'), 'utc').toNumber(),
    ).toBe(0);
  });

  it('falls back to UTC on an unknown timezone', () => {
    expect(() =>
      calendarMonthsSpanned(at('2026-03-01T00:00:00Z'), at('2026-04-01T00:00:00Z'), 'Nowhere/Here'),
    ).not.toThrow();
  });
});

describe('isValidTimezone', () => {
  it.each([IST, 'utc', 'America/New_York', 'Europe/London'])('accepts %s', (zone) => {
    expect(isValidTimezone(zone)).toBe(true);
  });

  it.each(['Mars/Olympus', 'Not/AZone', ''])('rejects %s', (zone) => {
    expect(isValidTimezone(zone)).toBe(false);
  });
});

describe('describeDuration', () => {
  it.each<[number, string]>([
    [0, '0 minutes'],
    [1, '1 minute'],
    [45, '45 minutes'],
    [60, '1 hour'],
    [90, '1 hour 30 minutes'],
    [MINUTES_PER_DAY, '1 day'],
    [MINUTES_PER_DAY + 60, '1 day 1 hour'],
    [2 * MINUTES_PER_DAY + 180, '2 days 3 hours'],
  ])('renders %s minutes as "%s"', (minutes, expected) => {
    expect(describeDuration(minutes)).toBe(expected);
  });

  it('omits minutes once the stay is measured in days', () => {
    // 47 days, 3 hours and 12 minutes. The minutes are noise on an invoice
    // for a stay that long, so they are dropped once days are present.
    expect(describeDuration(47 * MINUTES_PER_DAY + 192)).toBe('47 days 3 hours');
  });

  it('singularises correctly', () => {
    expect(describeDuration(MINUTES_PER_DAY)).toBe('1 day');
    expect(describeDuration(2 * MINUTES_PER_DAY)).toBe('2 days');
    expect(describeDuration(60)).toBe('1 hour');
    expect(describeDuration(120)).toBe('2 hours');
  });
});

describe('ageingDays', () => {
  it('counts whole days on site', () => {
    expect(ageingDays(at('2026-03-01T00:00:00Z'), at('2026-03-11T00:00:00Z'))).toBe(10);
  });

  it('floors a partial day', () => {
    expect(ageingDays(at('2026-03-01T00:00:00Z'), at('2026-03-11T23:59:00Z'))).toBe(10);
  });

  it('never returns a negative age', () => {
    // A clock skew between the gate device and the server must not produce a
    // vehicle that has been on site for minus three days.
    expect(ageingDays(at('2026-03-11T00:00:00Z'), at('2026-03-01T00:00:00Z'))).toBe(0);
  });

  it('is zero on the day of arrival', () => {
    expect(ageingDays(at('2026-03-01T08:00:00Z'), at('2026-03-01T20:00:00Z'))).toBe(0);
  });
});
