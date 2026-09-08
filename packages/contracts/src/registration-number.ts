/**
 * Registration-number normalisation.
 *
 * Requirement S31: `TN01AB1234`, `TN-01-AB-1234` and `TN 01 AB 1234` must all
 * resolve to the same vehicle. This module is the single implementation, shared
 * by the API (which stores the normalised form in a unique column and indexes
 * it) and by the console (which normalises before it searches, so the user sees
 * consistent results as they type).
 *
 * Design rules:
 *   - Normalisation is lossless in the sense that matters: it only removes
 *     separators and case. It never "corrects" characters.
 *   - OCR confusion handling (O/0, I/1, S/5, B/8) is offered separately as
 *     `plateCandidates()` for *search* and low-confidence ANPR review. It is
 *     deliberately NOT applied during normalisation, because silently rewriting
 *     a plate would attach a stay - and an invoice - to the wrong vehicle.
 */

/** Characters treated as separators and removed during normalisation. */
const SEPARATORS = /[\s\-._/\\|,:;()[\]{}#*]+/g;
const NON_ALPHANUMERIC = /[^A-Z0-9]/g;

export const REGISTRATION_NUMBER_MAX_LENGTH = 16;
export const REGISTRATION_NUMBER_MIN_LENGTH = 4;

/**
 * Canonical form: uppercase, alphanumeric only.
 *
 * @returns the normalised plate, or an empty string when the input contains no
 *          alphanumeric characters at all.
 */
export function normalizeRegistrationNumber(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .toUpperCase()
    .replace(SEPARATORS, '')
    .replace(NON_ALPHANUMERIC, '')
    .slice(0, REGISTRATION_NUMBER_MAX_LENGTH);
}

/**
 * Standard Indian formats accepted without a warning.
 *
 *   STATE     e.g. TN 01 AB 1234   - two letters, 1-2 digits, 1-3 letters, 1-4 digits
 *   BH SERIES e.g. 22 BH 1234 AA   - year, literal BH, four digits, 1-2 letters
 *   DEFENCE   e.g. 21 BH 1234 A    - handled by the BH pattern
 *
 * A plate that matches none of these is still accepted (foreign, trade,
 * temporary and older plates exist) but is flagged so operations can review it.
 */
const PATTERN_STATE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;
const PATTERN_BH_SERIES = /^\d{2}BH\d{4}[A-Z]{1,2}$/;
const PATTERN_TEMPORARY = /^[A-Z]{2}\d{1,2}(TC|TR|TEMP)\d{1,6}$/;

export type RegistrationNumberFormat = 'STATE' | 'BH_SERIES' | 'TEMPORARY' | 'UNRECOGNISED';

export interface RegistrationNumberAnalysis {
  /** Canonical, storable form. */
  normalized: string;
  /** True when the value is usable as a plate at all. */
  valid: boolean;
  format: RegistrationNumberFormat;
  /** Two-letter state/UT code when the format exposes one. */
  stateCode?: string;
  /** Human-readable reason when `valid` is false. */
  reason?: string;
}

export function analyzeRegistrationNumber(input: string): RegistrationNumberAnalysis {
  const normalized = normalizeRegistrationNumber(input);

  if (normalized.length === 0) {
    return {
      normalized,
      valid: false,
      format: 'UNRECOGNISED',
      reason: 'Contains no alphanumeric characters.',
    };
  }
  if (normalized.length < REGISTRATION_NUMBER_MIN_LENGTH) {
    return {
      normalized,
      valid: false,
      format: 'UNRECOGNISED',
      reason: `Shorter than the minimum of ${REGISTRATION_NUMBER_MIN_LENGTH} characters.`,
    };
  }

  if (PATTERN_BH_SERIES.test(normalized)) {
    return { normalized, valid: true, format: 'BH_SERIES' };
  }
  if (PATTERN_TEMPORARY.test(normalized)) {
    return {
      normalized,
      valid: true,
      format: 'TEMPORARY',
      stateCode: normalized.slice(0, 2),
    };
  }
  if (PATTERN_STATE.test(normalized)) {
    return {
      normalized,
      valid: true,
      format: 'STATE',
      stateCode: normalized.slice(0, 2),
    };
  }

  // Accepted but flagged: real yards do receive plates that fit no standard
  // pattern. Blocking them would block the business, so we admit and review.
  return {
    normalized,
    valid: true,
    format: 'UNRECOGNISED',
    reason: 'Does not match a standard Indian registration format; flagged for review.',
  };
}

export function isValidRegistrationNumber(input: string): boolean {
  return analyzeRegistrationNumber(input).valid;
}

/**
 * Group a normalised plate for display: `TN01AB1234` -> `TN 01 AB 1234`.
 * Falls back to the raw normalised value for formats it cannot segment.
 */
export function formatRegistrationNumber(input: string): string {
  const normalized = normalizeRegistrationNumber(input);
  const stateMatch = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(normalized);
  if (stateMatch) {
    return [stateMatch[1], stateMatch[2], stateMatch[3], stateMatch[4]]
      .filter((part) => part && part.length > 0)
      .join(' ');
  }
  const bhMatch = /^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/.exec(normalized);
  if (bhMatch) {
    return `${bhMatch[1]} ${bhMatch[2]} ${bhMatch[3]} ${bhMatch[4]}`;
  }
  return normalized;
}

/**
 * Glyph pairs that optical character recognition most often confuses.
 * Used only to widen a *search* or to suggest alternatives to a human
 * reviewing a low-confidence capture.
 */
const OCR_CONFUSIONS: ReadonlyArray<readonly [string, string]> = [
  ['0', 'O'],
  ['1', 'I'],
  ['2', 'Z'],
  ['5', 'S'],
  ['8', 'B'],
  ['6', 'G'],
];

/**
 * Every plate reachable from `input` by swapping at most `maxSubstitutions`
 * confusable glyphs, including the input itself.
 *
 * Bounded on purpose: the candidate set grows combinatorially, and an unbounded
 * fuzzy match against a national vehicle repository is both slow and dangerous.
 *
 * @param maxSubstitutions defaults to 1; values above 2 are clamped.
 */
export function plateCandidates(input: string, maxSubstitutions = 1): string[] {
  const normalized = normalizeRegistrationNumber(input);
  if (normalized.length === 0) return [];

  const depth = Math.max(0, Math.min(2, Math.trunc(maxSubstitutions)));
  const seen = new Set<string>([normalized]);
  let frontier: string[] = [normalized];

  for (let round = 0; round < depth; round++) {
    const next: string[] = [];
    for (const candidate of frontier) {
      for (let i = 0; i < candidate.length; i++) {
        const ch = candidate[i];
        if (ch === undefined) continue;
        for (const pair of OCR_CONFUSIONS) {
          const swap = pair[0] === ch ? pair[1] : pair[1] === ch ? pair[0] : undefined;
          if (swap === undefined) continue;
          const mutated = candidate.slice(0, i) + swap + candidate.slice(i + 1);
          if (!seen.has(mutated)) {
            seen.add(mutated);
            next.push(mutated);
          }
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return Array.from(seen);
}

/**
 * Mask a plate for display to a caller who lacks `vehicle:pii:read`, and for
 * log lines. Keeps enough to be recognisable in an audit trail, not enough to
 * identify the vehicle: `TN01AB1234` -> `TN01****34`.
 */
export function maskRegistrationNumber(input: string): string {
  const normalized = normalizeRegistrationNumber(input);
  if (normalized.length <= 4) return '*'.repeat(normalized.length);
  const head = normalized.slice(0, 4);
  const tail = normalized.slice(-2);
  const hiddenCount = Math.max(0, normalized.length - head.length - tail.length);
  return `${head}${'*'.repeat(hiddenCount)}${tail}`;
}
