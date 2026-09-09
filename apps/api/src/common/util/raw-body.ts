import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The exact bytes of the request body, as the sender transmitted them.
 *
 * An HMAC over a webhook payload is only meaningful if it is computed over
 * what the sender actually signed. Re-serialising the parsed body with
 * `JSON.stringify` produces a different byte sequence whenever the sender's
 * key order, whitespace, number formatting or unicode escaping differs from
 * Node's - so verification would either fail against a legitimate caller or,
 * worse, succeed against a document nobody signed.
 *
 * `rawBody: true` on the Nest application keeps the undecoded buffer here.
 *
 * Returns an empty string when no body was buffered. That is deliberate: an
 * empty string cannot match any signature over real content, so a caller that
 * requires a signature fails closed rather than skipping the check.
 */
export function rawBodyOf(request: RawBodyRequest<Request>): string {
  const raw = request.rawBody;
  if (!raw) return '';
  return raw.toString('utf8');
}
