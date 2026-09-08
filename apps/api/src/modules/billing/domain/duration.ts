import { DateTime } from 'luxon';

import { BillingUnit, RoundingMode } from '@smartpark/contracts';
import { Decimal, toDecimal, units as toUnits } from '@/common/money/money';

/**
 * Converting an elapsed stay into billable units.
 *
 * This is separated from the charge engine because it is where the subtle
 * business decisions live, and each one has to be defensible to a financier:
 *
 *   DAY vs CALENDAR_DAY
 *     DAY counts elapsed 24-hour periods from the entry instant. A vehicle in
 *     at 23:00 and out at 01:00 the next night has been there 26 hours = 2 days.
 *     CALENDAR_DAY counts distinct dates in the site's timezone, so the same
 *     stay spans 2 calendar dates = 2 days. They agree here but diverge often;
 *     which one applies is a contract term, not a code decision.
 *
 *   Timezone
 *     Calendar arithmetic uses the SITE timezone. A yard in a different zone to
 *     the server must not bill a different number of days because of where the
 *     application happens to be deployed.
 *
 *   Rounding
 *     CEIL is the usual yard convention - any part of a day is a full day - but
 *     it is a per-plan setting, never assumed.
 */

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 10080;

export interface DurationBreakdown {
  /** Whole minutes between entry and asOf. Never negative. */
  rawMinutes: number;
  /** Units before rounding, e.g. 2.5 days. */
  exactUnits: Decimal;
  /** Units after the plan's rounding rule. This is what gets charged. */
  roundedUnits: Decimal;
}

/**
 * @throws RangeError when `asOf` precedes `entryAt`. Callers translate this
 *         into the EXIT_BEFORE_ENTRY domain error.
 */
export function computeDuration(
  entryAt: Date,
  asOf: Date,
  billingUnit: BillingUnit,
  roundingMode: RoundingMode,
  timezone: string,
): DurationBreakdown {
  const elapsedMs = asOf.getTime() - entryAt.getTime();
  if (elapsedMs < 0) {
    throw new RangeError('asOf must not precede entryAt.');
  }

  const rawMinutes = Math.floor(elapsedMs / 60_000);
  const exactUnits = exactUnitsFor(entryAt, asOf, billingUnit, timezone, rawMinutes);
  const roundedUnits = applyRounding(exactUnits, roundingMode, billingUnit);

  return { rawMinutes, exactUnits: toUnits(exactUnits), roundedUnits: toUnits(roundedUnits) };
}

function exactUnitsFor(
  entryAt: Date,
  asOf: Date,
  billingUnit: BillingUnit,
  timezone: string,
  rawMinutes: number,
): Decimal {
  switch (billingUnit) {
    case 'MINUTE':
      return toDecimal(rawMinutes);

    case 'HOUR':
      return toDecimal(rawMinutes).dividedBy(MINUTES_PER_HOUR);

    case 'DAY':
      return toDecimal(rawMinutes).dividedBy(MINUTES_PER_DAY);

    case 'WEEK':
      return toDecimal(rawMinutes).dividedBy(MINUTES_PER_WEEK);

    case 'CALENDAR_DAY':
      return toDecimal(calendarDaysSpanned(entryAt, asOf, timezone));

    case 'MONTH':
      return calendarMonthsSpanned(entryAt, asOf, timezone);

    default: {
      // Exhaustiveness: a new BillingUnit must not silently price as zero.
      const unreachable: never = billingUnit;
      throw new Error(`Unsupported billing unit: ${String(unreachable)}`);
    }
  }
}

/**
 * Distinct calendar dates touched by the stay, in the site's timezone.
 * The entry date counts as day 1, so a same-day stay is one calendar day.
 */
export function calendarDaysSpanned(entryAt: Date, asOf: Date, timezone: string): number {
  const zone = safeZone(timezone);
  const start = DateTime.fromJSDate(entryAt, { zone }).startOf('day');
  const end = DateTime.fromJSDate(asOf, { zone }).startOf('day');
  const diff = end.diff(start, 'days').days;
  return Math.max(1, Math.round(diff) + 1);
}

/**
 * Calendar months spanned, as a fraction.
 *
 * Luxon's month diff already accounts for months of unequal length, so a stay
 * from 31 January to 28 February is one month, not 0.93 of one.
 */
export function calendarMonthsSpanned(entryAt: Date, asOf: Date, timezone: string): Decimal {
  const zone = safeZone(timezone);
  const start = DateTime.fromJSDate(entryAt, { zone });
  const end = DateTime.fromJSDate(asOf, { zone });
  const months = end.diff(start, 'months').months;
  return toDecimal(Number.isFinite(months) ? months : 0);
}

function applyRounding(
  exact: Decimal,
  mode: RoundingMode,
  billingUnit: BillingUnit,
): Decimal {
  // CALENDAR_DAY is already a whole count of dates; rounding it again would be
  // meaningless (and CEIL would be a no-op anyway).
  if (billingUnit === 'CALENDAR_DAY') return exact;

  if (exact.lessThanOrEqualTo(0)) return toDecimal(0);

  switch (mode) {
    case 'CEIL':
      return exact.ceil();
    case 'FLOOR':
      return exact.floor();
    case 'NEAREST':
      return exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    default: {
      const unreachable: never = mode;
      throw new Error(`Unsupported rounding mode: ${String(unreachable)}`);
    }
  }
}

/**
 * Falls back to UTC on an unknown zone rather than throwing.
 *
 * A misconfigured site timezone must not stop a vehicle being billed; it
 * produces a slightly different day boundary, which is visible and fixable,
 * whereas a crash in the nightly accrual is neither.
 */
function safeZone(timezone: string): string {
  return DateTime.local().setZone(timezone).isValid ? timezone : 'utc';
}

export function isValidTimezone(timezone: string): boolean {
  return DateTime.local().setZone(timezone).isValid;
}

/** Human-readable stay length for invoices and the console. */
export function describeDuration(rawMinutes: number): string {
  if (rawMinutes < 60) return `${rawMinutes} minute${rawMinutes === 1 ? '' : 's'}`;

  const days = Math.floor(rawMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((rawMinutes % MINUTES_PER_DAY) / 60);
  const minutes = rawMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 minutes';
}

/** Whole days a vehicle has been on site. Drives the ageing report. */
export function ageingDays(entryAt: Date, asOf: Date = new Date()): number {
  return Math.max(0, Math.floor((asOf.getTime() - entryAt.getTime()) / (MINUTES_PER_DAY * 60_000)));
}
