import { SetMetadata } from '@nestjs/common';

export const AUDITED_KEY = 'smartpark:audited';

export interface AuditOptions {
  /** Verb recorded in the trail, e.g. 'VEHICLE.ADMIT', 'INVOICE.ISSUE'. */
  action: string;
  entityType: string;
  /**
   * Where to find the entity id. `param:id` reads a route parameter,
   * `body:sessionId` reads the request body, `result:id` reads the response.
   */
  entityIdFrom?: string;
  /**
   * Record the request body in the audit `afterState`. Off by default; enable
   * only where the payload is genuinely useful and free of bulk PII.
   */
  captureBody?: boolean;
}

/**
 * Records an audit entry for a route.
 *
 * Complements - never replaces - the explicit `AuditService.record()` calls
 * that domain services make inside their transactions. This decorator is for
 * request-level "who called what"; the in-transaction writes carry the
 * before/after state that matters for financial and lifecycle changes.
 */
export const Audited = (options: AuditOptions): MethodDecorator =>
  SetMetadata(AUDITED_KEY, options);
