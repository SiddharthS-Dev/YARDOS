import { ErrorCode, httpStatusForErrorCode } from '@smartpark/contracts';

/**
 * The only exception type the domain and application layers throw.
 *
 * Carrying a machine-readable `code` (rather than an HTTP status) keeps the
 * domain free of transport concerns: the same error is meaningful when raised
 * from a background job, where there is no HTTP response at all. The filter
 * maps `code` to a status on the way out.
 *
 * `details` is for the client. It must never contain SQL, stack traces,
 * upstream payloads, credentials or another party's data.
 */
export class AppException extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** Attached to the audit record when the failing action is audited. */
  readonly auditReason?: string;
  /** Underlying cause. Logged server-side, never serialised to the client. */
  override readonly cause?: unknown;

  constructor(
    code: ErrorCode | string,
    message: string,
    options: {
      details?: Record<string, unknown>;
      status?: number;
      auditReason?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'AppException';
    this.code = code;
    this.status = options.status ?? httpStatusForErrorCode(code);
    this.details = options.details;
    this.auditReason = options.auditReason;
    this.cause = options.cause;
    Error.captureStackTrace?.(this, AppException);
  }
}

/* ------------------------------------------------------------------ */
/* Constructors for the shapes used everywhere                         */
/* ------------------------------------------------------------------ */

export function notFound(
  entity: string,
  identifier?: string | Record<string, unknown>,
): AppException {
  const details =
    typeof identifier === 'string'
      ? { entity, id: identifier }
      : { entity, ...(identifier ?? {}) };
  return new AppException(
    ErrorCode.NOT_FOUND,
    typeof identifier === 'string'
      ? `${entity} "${identifier}" was not found.`
      : `${entity} was not found.`,
    { details },
  );
}

export function validationFailed(
  message: string,
  details?: Record<string, unknown>,
): AppException {
  return new AppException(ErrorCode.VALIDATION_FAILED, message, { details });
}

export function conflict(
  code: ErrorCode | string,
  message: string,
  details?: Record<string, unknown>,
): AppException {
  return new AppException(code, message, { details });
}

export function permissionDenied(
  required: string | string[],
  message = 'You do not have permission to perform this action.',
): AppException {
  return new AppException(ErrorCode.PERMISSION_DENIED, message, {
    details: { requiredPermissions: Array.isArray(required) ? required : [required] },
  });
}

/**
 * Raised when an optimistic-locking update matched zero rows, i.e. another
 * transaction changed the aggregate first. Callers should re-read and retry.
 */
export function concurrentModification(entity: string, id: string): AppException {
  return new AppException(
    ErrorCode.CONCURRENT_MODIFICATION,
    `${entity} was modified by another operation. Reload and try again.`,
    { details: { entity, id } },
  );
}

/** Raised by a state machine when a transition is not in the transition table. */
export function invalidTransition(
  code: ErrorCode | string,
  entity: string,
  from: string,
  to: string,
  allowed: readonly string[],
): AppException {
  return new AppException(
    code,
    `${entity} cannot move from ${from} to ${to}.`,
    { details: { entity, from, to, allowedTransitions: allowed } },
  );
}
