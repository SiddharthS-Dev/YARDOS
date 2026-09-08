import { randomBytes } from 'node:crypto';

/**
 * Human-facing reference numbers.
 *
 * These appear on paperwork and are read aloud over the phone, so they avoid
 * the characters people confuse (I, O, 0, 1) and keep a readable prefix that
 * says what the document is.
 *
 * They are NOT primary keys - every table keys on a UUID - and they are not
 * secrets. Uniqueness is guaranteed by a unique index plus a bounded retry, not
 * by the generator alone.
 */
const UNAMBIGUOUS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += UNAMBIGUOUS[(bytes[i] as number) % UNAMBIGUOUS.length];
  }
  return out;
}

/** `SES-20250908-7K4M2Q` */
export function generateSessionNumber(now: Date = new Date()): string {
  return `SES-${yyyymmdd(now)}-${randomSuffix(6)}`;
}

/** `REL-20250908-9XQ2` */
export function generateReleaseNumber(now: Date = new Date()): string {
  return `REL-${yyyymmdd(now)}-${randomSuffix(4)}`;
}

/** `AUC-2025-4K7P` */
export function generateAuctionCode(now: Date = new Date()): string {
  return `AUC-${now.getUTCFullYear()}-${randomSuffix(4)}`;
}

/** `BDR-8H3NQ2` */
export function generateBidderCode(): string {
  return `BDR-${randomSuffix(6)}`;
}

function yyyymmdd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Indian financial year label for an invoice series, e.g. `2025-26`.
 * The year runs 1 April to 31 March.
 */
export function financialYear(date: Date, timezoneOffsetMinutes = 330): string {
  const local = new Date(date.getTime() + timezoneOffsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
