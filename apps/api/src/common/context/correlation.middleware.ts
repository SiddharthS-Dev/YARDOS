import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { HEADER_CORRELATION_ID } from '@smartpark/contracts';
import { RequestContextStore, RequestContext } from './request-context';

/**
 * Establishes the per-request context for the whole downstream call stack.
 *
 * An inbound correlation id is honoured so a trace can span the console, the
 * API and any future service; otherwise one is minted. It is echoed on the
 * response so a user reporting a problem can quote it and operations can find
 * every related log line and audit row.
 *
 * Inbound ids are sanitised: an attacker-supplied value ends up in logs, so it
 * must not be able to inject newlines or unbounded content.
 */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,64}$/;

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header(HEADER_CORRELATION_ID);
    const correlationId =
      inbound && SAFE_CORRELATION_ID.test(inbound) ? inbound : randomUUID();

    const context: RequestContext = {
      correlationId,
      requestId: randomUUID(),
      actorType: 'USER',
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent')?.slice(0, 512),
      startedAt: Date.now(),
    };

    res.setHeader(HEADER_CORRELATION_ID, correlationId);
    RequestContextStore.run(context, () => next());
  }
}

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is only trusted because the app is deployed behind a
 * known reverse proxy (see docs/deployment.md); Express `trust proxy` is set
 * accordingly in main.ts.
 */
function clientIp(req: Request): string | undefined {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return (req.ip ?? req.socket?.remoteAddress ?? undefined)?.slice(0, 64);
}
