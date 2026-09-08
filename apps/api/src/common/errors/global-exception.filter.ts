import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

import { ApiErrorBody, ErrorCode } from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { RequestContextStore } from '@/common/context/request-context';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { AppException } from './app-exception';

/**
 * The single exit point for every error leaving the API.
 *
 * Guarantees (requirement S34):
 *   - Exactly one response shape, always: code / message / correlationId /
 *     timestamp / path / details.
 *   - No stack trace, SQL fragment, table name, driver message or upstream
 *     payload ever reaches a client. Those go to the log, keyed by the same
 *     correlation id the client is given.
 *   - Every 5xx is logged at error level with the full cause; 4xx is logged at
 *     warn/debug, because client mistakes are not operational incidents.
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger: ScopedLogger;

  constructor(
    logger: AppLogger,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.logger = logger.forContext('ExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const correlationId = RequestContextStore.correlationId();

    const mapped = this.mapException(exception);

    const body: ApiErrorBody = {
      code: mapped.code,
      message: mapped.message,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request?.originalUrl,
      ...(mapped.details ? { details: mapped.details } : {}),
    };

    const logData = {
      status: mapped.status,
      code: mapped.code,
      method: request?.method,
      path: request?.originalUrl,
    };

    if (mapped.status >= 500) {
      this.logger.error(`Unhandled error: ${mapped.logMessage}`, exception, logData);
    } else if (mapped.status === 401 || mapped.status === 403) {
      // Authorisation failures are security-relevant, so they are always warn.
      this.logger.warn(`Access denied: ${mapped.logMessage}`, logData);
    } else {
      this.logger.debug(`Request rejected: ${mapped.logMessage}`, logData);
    }

    if (response.headersSent) {
      // A streamed response (a PDF download) already committed its status.
      // Destroy rather than append garbage to the body.
      response.destroy();
      return;
    }

    response.status(mapped.status).json(body);
  }

  private mapException(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    logMessage: string;
  } {
    /* --- Domain and application errors ---------------------------- */
    if (exception instanceof AppException) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
        logMessage: exception.message,
      };
    }

    /* --- Nest / validation errors --------------------------------- */
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // class-validator via ValidationPipe returns { message: string[] }.
      if (
        typeof payload === 'object' &&
        payload !== null &&
        Array.isArray((payload as { message?: unknown }).message)
      ) {
        const issues = (payload as { message: string[] }).message;
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'The request payload failed validation.',
          details: { issues: issues.slice(0, 50) },
          logMessage: `validation failed (${issues.length} issue(s))`,
        };
      }

      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string })?.message ?? exception.message);

      return {
        status,
        code: this.codeForHttpStatus(status),
        message,
        logMessage: message,
      };
    }

    /* --- Prisma ---------------------------------------------------- */
    const prismaMapped = this.mapPrismaException(exception);
    if (prismaMapped) return prismaMapped;

    /* --- Anything else --------------------------------------------- */
    // Deliberately opaque. The real message is in the log under the same
    // correlation id; leaking it here can disclose internals.
    const raw = exception instanceof Error ? exception.message : String(exception);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred. Quote the correlation id when reporting this.',
      // Only in non-production, and only to speed up local debugging.
      details: this.config.isProduction ? undefined : { developmentHint: raw.slice(0, 300) },
      logMessage: raw,
    };
  }

  /**
   * Translates Prisma driver errors into domain-meaningful responses.
   *
   * The database is a genuine authority here: unique indexes and triggers
   * enforce rules that application code alone cannot guarantee under
   * concurrency, so their violations must produce sensible API errors rather
   * than a blanket 500.
   */
  private mapPrismaException(exception: unknown):
    | { status: number; code: string; message: string; details?: Record<string, unknown>; logMessage: string }
    | null {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          const target = normaliseTarget(exception.meta?.['target']);
          return {
            status: HttpStatus.CONFLICT,
            code: this.conflictCodeForConstraint(target),
            message: conflictMessageForConstraint(target),
            details: { constraint: target },
            logMessage: `unique constraint violated: ${target}`,
          };
        }
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'A referenced record does not exist or is still in use.',
            details: { field: String(exception.meta?.['field_name'] ?? 'unknown') },
            logMessage: 'foreign key constraint violated',
          };
        case 'P2025':
          return {
            status: HttpStatus.NOT_FOUND,
            code: ErrorCode.NOT_FOUND,
            message: 'The requested record was not found.',
            logMessage: 'record not found',
          };
        case 'P2034':
          // Serialisation failure / deadlock. Safe for the client to retry.
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONCURRENT_MODIFICATION,
            message: 'The operation conflicted with a concurrent change. Please retry.',
            logMessage: 'transaction write conflict / deadlock',
          };
        default:
          break;
      }

      // Constraint and trigger violations raised by our own guards arrive with
      // the SQLSTATE and message in `meta`.
      const guard = matchDatabaseGuard(exception.message);
      if (guard) return guard;

      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_FAILED,
        message: 'The request violated a data-integrity rule.',
        details: { prismaCode: exception.code },
        logMessage: `prisma ${exception.code}: ${exception.message}`,
      };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_FAILED,
        message: 'The request payload did not match the expected shape.',
        logMessage: 'prisma validation error',
      };
    }

    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unable to reach its database.',
        logMessage: 'database unavailable',
      };
    }

    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      const guard = matchDatabaseGuard(exception.message);
      if (guard) return guard;
    }

    return null;
  }

  private codeForHttpStatus(status: number): string {
    switch (status) {
      case 400: return ErrorCode.VALIDATION_FAILED;
      case 401: return ErrorCode.UNAUTHENTICATED;
      case 403: return ErrorCode.PERMISSION_DENIED;
      case 404: return ErrorCode.NOT_FOUND;
      case 409: return ErrorCode.CONFLICT;
      case 413: return ErrorCode.PAYLOAD_TOO_LARGE;
      case 415: return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
      case 429: return ErrorCode.RATE_LIMITED;
      case 503: return ErrorCode.SERVICE_UNAVAILABLE;
      default:  return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.CONFLICT;
    }
  }

  /** Maps our named unique indexes onto specific, actionable error codes. */
  private conflictCodeForConstraint(target: string): string {
    if (target.includes('one_active_per_vehicle')) return ErrorCode.VEHICLE_ALREADY_ACTIVE;
    if (target.includes('one_active_per_space') || target.includes('one_open_per_space')) {
      return ErrorCode.PARKING_SPACE_NOT_AVAILABLE;
    }
    if (target.includes('one_active_per_session')) return ErrorCode.RELEASE_ALREADY_REQUESTED;
    if (target.includes('one_live_per_vehicle')) return ErrorCode.VEHICLE_ALREADY_IN_AUCTION;
    if (target.includes('bids') && target.includes('sequenceNo')) return ErrorCode.BID_NOT_HIGHEST;
    if (target.includes('idempotencyKey')) return ErrorCode.REQUEST_IN_PROGRESS;
    if (target.includes('dedupeKey') || target.includes('providerEventId')) {
      return ErrorCode.ANPR_EVENT_DUPLICATE;
    }
    if (target.includes('invoiceNumber')) return ErrorCode.INVOICE_ALREADY_EXISTS;
    return ErrorCode.CONFLICT;
  }
}

function normaliseTarget(target: unknown): string {
  if (Array.isArray(target)) return target.join(',');
  if (typeof target === 'string') return target;
  return 'unknown';
}

function conflictMessageForConstraint(target: string): string {
  if (target.includes('one_active_per_vehicle')) {
    return 'This vehicle already has an active parking session.';
  }
  if (target.includes('one_active_per_space') || target.includes('one_open_per_space')) {
    return 'That parking space is already occupied.';
  }
  if (target.includes('one_active_per_session')) {
    return 'A release request is already in progress for this stay.';
  }
  if (target.includes('one_live_per_vehicle')) {
    return 'This vehicle is already listed in a live auction.';
  }
  if (target.includes('dedupeKey') || target.includes('providerEventId')) {
    return 'This capture event has already been received.';
  }
  if (target.includes('invoiceNumber')) {
    return 'An invoice with that number already exists.';
  }
  return 'A record with the same unique value already exists.';
}

/**
 * Recognises the custom exceptions raised by the database immutability
 * triggers so they surface as meaningful 409s rather than opaque 500s.
 */
function matchDatabaseGuard(message: string):
  | { status: number; code: string; message: string; logMessage: string }
  | null {
  if (/is append-only/i.test(message)) {
    return {
      status: HttpStatus.CONFLICT,
      code: ErrorCode.CONFLICT,
      message: 'That record is part of an append-only history and cannot be changed.',
      logMessage: 'append-only trigger rejected mutation',
    };
  }
  if (/Bid .* is immutable|bids are immutable/i.test(message)) {
    return {
      status: HttpStatus.CONFLICT,
      code: ErrorCode.BID_IMMUTABLE,
      message: 'Bids are immutable records; only their status may change.',
      logMessage: 'bid immutability trigger rejected mutation',
    };
  }
  if (/Invoice .* is issued and its financial content is immutable|cannot be deleted: void it/i.test(message)) {
    return {
      status: HttpStatus.CONFLICT,
      code: ErrorCode.INVALID_INVOICE_STATE_TRANSITION,
      message: 'An issued invoice cannot be altered. Void it and raise a credit note.',
      logMessage: 'invoice immutability trigger rejected mutation',
    };
  }
  if (/FINAL charge calculation .* is immutable/i.test(message)) {
    return {
      status: HttpStatus.CONFLICT,
      code: ErrorCode.CHARGE_CALCULATION_STALE,
      message: 'A final charge calculation cannot be edited; recalculate into a new one.',
      logMessage: 'charge calculation immutability trigger rejected mutation',
    };
  }
  return null;
}
