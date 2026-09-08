import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENCY_KEY = 'smartpark:idempotency';

export interface IdempotencyOptions {
  /**
   * Namespace for the key, so the same client-supplied value used on two
   * different operations cannot collide.
   */
  scope: string;
  /**
   * When true the request is rejected if the client omits `Idempotency-Key`.
   * Used for operations that create money or move a vehicle, where a silent
   * duplicate is unacceptable.
   */
  required?: boolean;
  /** How long a completed result is replayed for. Default 24 hours. */
  ttlSeconds?: number;
}

/**
 * Makes a mutating endpoint safe to retry.
 *
 * The interceptor records the key before the handler runs, replays the stored
 * response for a repeat of the same request, and rejects the same key used
 * with a different body (requirement S56).
 */
export const Idempotent = (options: IdempotencyOptions): MethodDecorator =>
  SetMetadata(IDEMPOTENCY_KEY, options);
