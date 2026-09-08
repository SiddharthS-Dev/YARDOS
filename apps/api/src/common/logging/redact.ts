/**
 * Redaction applied to everything that reaches a log line or an audit
 * before/after snapshot.
 *
 * Requirement S35: never log passwords, tokens, credentials or unnecessary
 * sensitive payloads. Requirement S36: vehicle-ownership and financier data is
 * sensitive business information.
 *
 * Two categories, handled differently:
 *
 *   SECRET  - removed entirely and replaced with '[REDACTED]'. There is no
 *             operational reason to see a password hash in a log.
 *   PII     - partially masked so an operator can still correlate records
 *             ("was it the same phone number?") without the log becoming a
 *             copy of the personal-data store.
 */

/** Keys whose values are never logged in any form. */
const SECRET_KEYS = new Set(
  [
    'password',
    'newpassword',
    'currentpassword',
    'confirmpassword',
    'passwordhash',
    'passwordconfirmation',
    'token',
    'accesstoken',
    'refreshtoken',
    'idtoken',
    'authorization',
    'cookie',
    'setcookie',
    'secret',
    'apikey',
    'apisecret',
    'clientsecret',
    'privatekey',
    'sharedsecret',
    'sharedsecrethash',
    'signature',
    'mfasecret',
    'mfasecretencrypted',
    'encryptionkey',
    'recipientcipher',
    'authorizationcode',
    'authorizationcodehash',
    'keysecret',
    'webhooksecret',
    'creditcard',
    'cardnumber',
    'cvv',
    'pin',
  ].map((k) => k.toLowerCase()),
);

/** Keys masked rather than removed, so they stay useful for correlation. */
const PII_KEYS = new Set(
  [
    'email',
    'billingemail',
    'contactemail',
    'billingpartyemail',
    'phone',
    'contactphone',
    'billingphone',
    'billingpartyphone',
    'requestedforphone',
    'mobile',
    'registeredownername',
    'registeredowneraddress',
    'billingpartyaddress',
    'addressline1',
    'addressline2',
    'pan',
    'gstin',
    'aadhaar',
    'recipient',
    'recipientmasked',
    'chassisnumber',
    'enginenumber',
  ].map((k) => k.toLowerCase()),
);

export const REDACTED = '[REDACTED]';

/** `alice@example.com` -> `a***e@example.com`. */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return maskGeneric(value);
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 2) return `${local[0] ?? '*'}***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}

/** `+919876543210` -> `+91*****3210`. Keeps the last four digits only. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  const tail = digits.slice(-4);
  const headLength = Math.min(3, Math.max(0, digits.length - 4));
  return `${digits.slice(0, headLength)}${'*'.repeat(digits.length - headLength - 4)}${tail}`;
}

/** Keeps the first and last character, masks the middle. */
export function maskGeneric(value: string): string {
  if (value.length === 0) return '';
  if (value.length <= 2) return '*'.repeat(value.length);
  return `${value[0]}${'*'.repeat(Math.min(value.length - 2, 8))}${value[value.length - 1]}`;
}

/** Names: keeps initials only, e.g. `Ravi Kumar` -> `R*** K****`. */
export function maskName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.length <= 1 ? part : `${part[0]}${'*'.repeat(Math.min(part.length - 1, 6))}`))
    .join(' ');
}

function maskByKey(key: string, value: string): string {
  const k = key.toLowerCase();
  if (k.includes('email')) return maskEmail(value);
  if (k.includes('phone') || k.includes('mobile')) return maskPhone(value);
  if (k.includes('name')) return maskName(value);
  return maskGeneric(value);
}

/**
 * Recursively redacts an arbitrary value.
 *
 * Bounded on depth and breadth: a log line must never be able to serialise an
 * enormous object graph and stall the event loop.
 */
export function redact(input: unknown, depth = 0, maxDepth = 6): unknown {
  if (depth > maxDepth) return '[TRUNCATED:depth]';
  if (input === null || input === undefined) return input;

  const type = typeof input;
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
    return type === 'bigint' ? String(input) : input;
  }
  if (input instanceof Date) return input.toISOString();
  if (input instanceof Error) {
    return { name: input.name, message: input.message };
  }
  if (Buffer.isBuffer(input)) return `[Buffer:${input.length}]`;

  if (Array.isArray(input)) {
    const limit = 50;
    const items = input.slice(0, limit).map((item) => redact(item, depth + 1, maxDepth));
    if (input.length > limit) items.push(`[TRUNCATED:${input.length - limit} more]`);
    return items;
  }

  if (type === 'object') {
    // Prisma Decimal and similar value objects serialise cleanly via toString.
    const candidate = input as { toFixed?: unknown; toString?: () => string };
    if (typeof candidate.toFixed === 'function' && typeof candidate.toString === 'function') {
      return candidate.toString();
    }

    const output: Record<string, unknown> = {};
    let count = 0;
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (count++ >= 100) {
        output['[TRUNCATED]'] = 'too many keys';
        break;
      }
      const lower = key.toLowerCase();
      if (SECRET_KEYS.has(lower)) {
        output[key] = REDACTED;
      } else if (PII_KEYS.has(lower) && typeof value === 'string') {
        output[key] = maskByKey(key, value);
      } else {
        output[key] = redact(value, depth + 1, maxDepth);
      }
    }
    return output;
  }

  return `[${type}]`;
}

/** Redacts an object, preserving the object type for structured logging. */
export function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  return redact(input) as Record<string, unknown>;
}

/** True when the key must never appear in a log or audit snapshot. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase());
}
