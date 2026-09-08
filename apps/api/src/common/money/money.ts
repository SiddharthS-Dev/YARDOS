import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

/**
 * Money and quantity arithmetic.
 *
 * The platform never uses JavaScript numbers for money. `0.1 + 0.2` is not
 * `0.3` in IEEE-754, and an invoice that is off by a paisa is a defect that a
 * financier will find. Everything monetary is a `Decimal`, stored as
 * NUMERIC(18,4) in PostgreSQL and serialised to the wire as a decimal string.
 *
 * Scales:
 *   MONEY_SCALE = 4  matches NUMERIC(18,4). Four places (not two) so that
 *                    intermediate per-unit rates and tax fractions do not lose
 *                    precision before the final rounding.
 *   UNIT_SCALE  = 6  matches NUMERIC(14,6) for durations in billing units.
 *
 * Rounding is banker's-free: currency is rounded HALF_UP, which is what Indian
 * commercial invoicing expects and what a human checking the arithmetic will
 * reproduce by hand.
 */

// Enough working precision that long slab ladders never lose digits, and
// exponential notation never appears in a serialised amount.
Decimal.set({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export const MONEY_SCALE = 4;
export const UNIT_SCALE = 6;
export const DEFAULT_CURRENCY = 'INR';

export type MoneyInput = Decimal | Prisma.Decimal | string | number;

/**
 * Coerces any supported representation to a Decimal.
 *
 * Numbers are accepted but converted via `String(...)`, which preserves the
 * literal the developer wrote rather than its binary approximation.
 */
export function toDecimal(value: MoneyInput | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Cannot convert non-finite number ${value} to Decimal.`);
    }
    return new Decimal(String(value));
  }
  return new Decimal(value.toString());
}

/** Rounds to currency scale, HALF_UP. Use before persisting or returning. */
export function money(value: MoneyInput | null | undefined): Decimal {
  return toDecimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Rounds to unit scale. Use for durations expressed in billing units. */
export function units(value: MoneyInput | null | undefined): Decimal {
  return toDecimal(value).toDecimalPlaces(UNIT_SCALE, Decimal.ROUND_HALF_UP);
}

export const ZERO = new Decimal(0);

/** Fixed-scale decimal string for the wire and for persistence. */
export function moneyToString(value: MoneyInput | null | undefined): string {
  return money(value).toFixed(MONEY_SCALE);
}

export function unitsToString(value: MoneyInput | null | undefined): string {
  return units(value).toFixed(UNIT_SCALE);
}

/** Converts to the Prisma Decimal the client expects for NUMERIC columns. */
export function toPrismaDecimal(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(money(value).toFixed(MONEY_SCALE));
}

export function unitsToPrismaDecimal(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(units(value).toFixed(UNIT_SCALE));
}

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

export function addMoney(...values: MoneyInput[]): Decimal {
  return money(values.reduce<Decimal>((sum, v) => sum.plus(toDecimal(v)), ZERO));
}

export function subtractMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return money(toDecimal(a).minus(toDecimal(b)));
}

export function multiplyMoney(amount: MoneyInput, factor: MoneyInput): Decimal {
  return money(toDecimal(amount).times(toDecimal(factor)));
}

/**
 * Sums a slab ladder without rounding at each step.
 *
 * Rounding only once, at the end, avoids the classic accumulation error where
 * 40 lines each rounded up produce a total that is visibly larger than the sum
 * a financier computes from the printed line amounts. Line amounts themselves
 * are rounded for display; this returns the exact total of the raw values.
 */
export function sumExact(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((sum, v) => sum.plus(toDecimal(v)), ZERO);
}

export function isZero(value: MoneyInput): boolean {
  return toDecimal(value).isZero();
}

export function isNegative(value: MoneyInput): boolean {
  return toDecimal(value).isNegative();
}

export function isPositive(value: MoneyInput): boolean {
  return toDecimal(value).greaterThan(0);
}

export function maxMoney(a: MoneyInput, b: MoneyInput): Decimal {
  const da = toDecimal(a);
  const db = toDecimal(b);
  return money(da.greaterThan(db) ? da : db);
}

export function minMoney(a: MoneyInput, b: MoneyInput): Decimal {
  const da = toDecimal(a);
  const db = toDecimal(b);
  return money(da.lessThan(db) ? da : db);
}

export function compareMoney(a: MoneyInput, b: MoneyInput): -1 | 0 | 1 {
  return toDecimal(a).comparedTo(toDecimal(b)) as -1 | 0 | 1;
}

export function equalsMoney(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).equals(money(b));
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * Human-readable amount for invoices and PDFs, using the Indian digit grouping
 * convention (lakh/crore) for INR: 1,23,45,678.90.
 */
export function formatMoney(value: MoneyInput, currency = DEFAULT_CURRENCY): string {
  const rounded = money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const negative = rounded.isNegative();
  const [whole = '0', fraction = '00'] = rounded.abs().toFixed(2).split('.');

  const grouped = currency === 'INR' ? groupIndian(whole) : groupWestern(whole);
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

function groupWestern(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Amount in words, for the invoice footer. Indian numbering system.
 * Only the integral part is spelled; paise are given numerically.
 */
export function amountInWords(value: MoneyInput, currency = DEFAULT_CURRENCY): string {
  const rounded = money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).abs();
  const whole = rounded.floor();
  const paise = rounded.minus(whole).times(100).round().toNumber();

  const unitName = currency === 'INR' ? 'Rupees' : currency;
  const subUnitName = currency === 'INR' ? 'Paise' : 'Cents';

  const wordsPart = indianNumberToWords(whole.toNumber());
  const base = `${unitName} ${wordsPart}`;
  return paise > 0
    ? `${base} and ${indianNumberToWords(paise)} ${subUnitName} only`
    : `${base} only`;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? (TENS[tens] ?? '') : `${TENS[tens]} ${ONES[ones]}`;
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** Indian grouping: crore, lakh, thousand, hundred. */
function indianNumberToWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return 'Zero';
  const n = Math.floor(value);
  if (n === 0) return 'Zero';

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const remainder = n % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${indianNumberToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`);
  if (remainder > 0) parts.push(threeDigits(remainder));

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export { Decimal };
