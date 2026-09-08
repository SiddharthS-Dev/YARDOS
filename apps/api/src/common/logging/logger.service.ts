import { Inject, Injectable, LoggerService as NestLoggerService, Scope } from '@nestjs/common';
import pino, { Logger as PinoLogger } from 'pino';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { RequestContextStore } from '@/common/context/request-context';
import { redactObject } from './redact';

/**
 * Structured application logger.
 *
 * Every line automatically carries the correlation id, request id and actor
 * from the ambient request context, so a single trace can be followed from an
 * ANPR capture all the way to an invoice without any call site remembering to
 * pass it (requirement S38).
 *
 * Output is newline-delimited JSON in every environment except local
 * development, where `LOG_PRETTY=true` turns on a human-readable transport.
 * Production is forbidden from enabling pretty output by the config guard.
 */
@Injectable({ scope: Scope.DEFAULT })
export class AppLogger implements NestLoggerService {
  private readonly root: PinoLogger;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = pino({
      level: config.log.level,
      base: {
        service: 'smartpark-api',
        version: config.version,
        env: config.env,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      // Defence in depth: `redact()` handles the payloads we build, and pino's
      // own redaction catches anything that slips through by path.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'password',
          '*.password',
          'token',
          '*.token',
          'secret',
          '*.secret',
        ],
        censor: '[REDACTED]',
      },
      transport: config.log.pretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: false,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,service,version,env',
              messageFormat: '{context} {msg}',
            },
          }
        : undefined,
    });
  }

  /** A child logger permanently tagged with a component name. */
  forContext(context: string): ScopedLogger {
    return new ScopedLogger(this.root, context);
  }

  private base(): Record<string, unknown> {
    const ctx = RequestContextStore.peek();
    if (!ctx) return {};
    return {
      correlationId: ctx.correlationId,
      requestId: ctx.requestId,
      userId: ctx.userId,
      actorType: ctx.actorType,
      ...(ctx.jobName ? { job: ctx.jobName } : {}),
    };
  }

  log(message: unknown, context?: string): void {
    this.root.info({ ...this.base(), context }, String(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.root.error({ ...this.base(), context, stack }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.root.warn({ ...this.base(), context }, String(message));
  }

  debug(message: unknown, context?: string): void {
    this.root.debug({ ...this.base(), context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.root.trace({ ...this.base(), context }, String(message));
  }

  fatal(message: unknown, context?: string): void {
    this.root.fatal({ ...this.base(), context }, String(message));
  }
}

/**
 * A logger bound to one component. Prefer this over the raw logger so every
 * line says where it came from.
 */
export class ScopedLogger {
  constructor(
    private readonly root: PinoLogger,
    private readonly context: string,
  ) {}

  private enrich(data?: Record<string, unknown>): Record<string, unknown> {
    const ctx = RequestContextStore.peek();
    return {
      context: this.context,
      ...(ctx
        ? {
            correlationId: ctx.correlationId,
            requestId: ctx.requestId,
            userId: ctx.userId,
            actorType: ctx.actorType,
            ...(ctx.jobName ? { job: ctx.jobName } : {}),
          }
        : {}),
      ...(data ? redactObject(data) : {}),
    };
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.root.trace(this.enrich(data), message);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.root.debug(this.enrich(data), message);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.root.info(this.enrich(data), message);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.root.warn(this.enrich(data), message);
  }

  /**
   * Logs an error. The stack is captured server-side only; it is never part of
   * an API response (requirement S34).
   */
  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    const errorInfo =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : error !== undefined
          ? { error: String(error) }
          : {};
    this.root.error({ ...this.enrich(data), ...errorInfo }, message);
  }

  fatal(message: string, error?: unknown, data?: Record<string, unknown>): void {
    const errorInfo =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : {};
    this.root.fatal({ ...this.enrich(data), ...errorInfo }, message);
  }
}
