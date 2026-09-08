import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex digest. */
export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** HMAC-SHA256 hex digest, used for webhook signature verification. */
export function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Constant-time comparison.
 *
 * Comparing a signature or a token with `===` leaks its prefix through timing.
 * Length is compared first because `timingSafeEqual` throws on a mismatch, and
 * the length of a signature is not itself a secret.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** URL-safe random token. 32 bytes gives 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Short human-quotable code, e.g. a one-time gate authorisation code. */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  // Rejection-free: take modulo of a wide random integer. The tiny bias over
  // 6 digits is irrelevant for a short-lived, rate-limited, single-use code.
  const value = randomBytes(6).readUIntBE(0, 6) % max;
  return value.toString().padStart(digits, '0');
}

/**
 * Deterministic hash of a JSON-serialisable value, with object keys sorted so
 * that logically identical inputs always hash identically.
 *
 * The charge engine relies on this: `inputsHash` must be stable across
 * processes and across time, or a recalculation cannot be proven equivalent.
 */
export function stableHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** JSON with deterministic key ordering. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortValue);

  // Decimal and other value objects expose toString; use it so 1.50 and 1.5
  // never hash differently for the same stored NUMERIC.
  const candidate = value as { toFixed?: unknown; toString?: () => string };
  if (typeof candidate.toFixed === 'function' && typeof candidate.toString === 'function') {
    return candidate.toString();
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) sorted[key] = sortValue(child);
  }
  return sorted;
}
