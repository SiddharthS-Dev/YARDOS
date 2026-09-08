import { Injectable } from '@nestjs/common';
import { ActorType, AuditOutcome, Prisma } from '@prisma/client';

import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { RequestContextStore } from '@/common/context/request-context';
import { redact } from '@/common/logging/redact';
import { PrismaExecutor, PrismaService } from '@/infrastructure/prisma/prisma.service';

/**
 * Audit actions.
 *
 * Named `DOMAIN.VERB` so the trail can be filtered by area. Requirement S27
 * lists the events that must be covered; every one of them appears here.
 */
export const AuditAction = {
  /* Authentication */
  LOGIN_SUCCEEDED: 'AUTH.LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'AUTH.LOGIN_FAILED',
  LOGOUT: 'AUTH.LOGOUT',
  TOKEN_REFRESHED: 'AUTH.TOKEN_REFRESHED',
  TOKEN_REUSE_DETECTED: 'AUTH.TOKEN_REUSE_DETECTED',
  ACCOUNT_LOCKED: 'AUTH.ACCOUNT_LOCKED',
  PASSWORD_CHANGED: 'AUTH.PASSWORD_CHANGED',

  /* Identity administration */
  USER_CREATED: 'USER.CREATED',
  USER_UPDATED: 'USER.UPDATED',
  USER_STATUS_CHANGED: 'USER.STATUS_CHANGED',
  USER_ROLES_CHANGED: 'USER.ROLES_CHANGED',
  USER_SITE_ACCESS_CHANGED: 'USER.SITE_ACCESS_CHANGED',
  ROLE_CREATED: 'ROLE.CREATED',
  ROLE_PERMISSIONS_CHANGED: 'ROLE.PERMISSIONS_CHANGED',

  /* Topology */
  SITE_CREATED: 'SITE.CREATED',
  SITE_UPDATED: 'SITE.UPDATED',
  GATE_CREATED: 'GATE.CREATED',
  GATE_UPDATED: 'GATE.UPDATED',
  ZONE_CREATED: 'ZONE.CREATED',
  ZONE_UPDATED: 'ZONE.UPDATED',

  /* Vehicle & capture */
  VEHICLE_CREATED: 'VEHICLE.CREATED',
  VEHICLE_UPDATED: 'VEHICLE.UPDATED',
  VEHICLE_STATUS_CHANGED: 'VEHICLE.STATUS_CHANGED',
  ANPR_EVENT_INGESTED: 'ANPR.EVENT_INGESTED',
  ANPR_EVENT_REVIEWED: 'ANPR.EVENT_REVIEWED',
  ANPR_MANUAL_OVERRIDE: 'ANPR.MANUAL_OVERRIDE',
  ANPR_DEVICE_UPDATED: 'ANPR.DEVICE_UPDATED',

  /* Vehicle registry */
  REGISTRY_LOOKUP_REQUESTED: 'REGISTRY.LOOKUP_REQUESTED',
  REGISTRY_LOOKUP_COMPLETED: 'REGISTRY.LOOKUP_COMPLETED',
  REGISTRY_MANUAL_VERIFICATION: 'REGISTRY.MANUAL_VERIFICATION',
  OWNERSHIP_UPDATED: 'VEHICLE.OWNERSHIP_UPDATED',
  FINANCIER_MATCH_CHANGED: 'VEHICLE.FINANCIER_MATCH_CHANGED',

  /* Commercial configuration */
  FINANCIER_CREATED: 'FINANCIER.CREATED',
  FINANCIER_UPDATED: 'FINANCIER.UPDATED',
  CONTRACT_CREATED: 'CONTRACT.CREATED',
  CONTRACT_VERSION_CREATED: 'CONTRACT.VERSION_CREATED',
  CONTRACT_VERSION_ACTIVATED: 'CONTRACT.VERSION_ACTIVATED',
  CONTRACT_VERSION_SUPERSEDED: 'CONTRACT.VERSION_SUPERSEDED',
  RATE_PLAN_CREATED: 'RATE.PLAN_CREATED',
  RATE_PLAN_UPDATED: 'RATE.PLAN_UPDATED',
  RATE_PLAN_ACTIVATED: 'RATE.PLAN_ACTIVATED',
  BILLING_RULE_CHANGED: 'BILLING.RULE_CHANGED',
  TAX_PROFILE_CHANGED: 'BILLING.TAX_PROFILE_CHANGED',

  /* Operations */
  SESSION_OPENED: 'SESSION.OPENED',
  SESSION_ALLOCATED: 'SESSION.ALLOCATED',
  SESSION_HELD: 'SESSION.HELD',
  SESSION_HOLD_LIFTED: 'SESSION.HOLD_LIFTED',
  SESSION_CLOSED: 'SESSION.CLOSED',
  CHARGE_CALCULATED: 'BILLING.CHARGE_CALCULATED',
  CHARGE_RECALCULATED: 'BILLING.CHARGE_RECALCULATED',

  /* Release */
  RELEASE_REQUESTED: 'RELEASE.REQUESTED',
  RELEASE_ELIGIBILITY_CHECKED: 'RELEASE.ELIGIBILITY_CHECKED',
  RELEASE_APPROVED: 'RELEASE.APPROVED',
  RELEASE_REJECTED: 'RELEASE.REJECTED',
  RELEASE_COMPLETED: 'RELEASE.COMPLETED',

  /* Billing */
  INVOICE_GENERATED: 'INVOICE.GENERATED',
  INVOICE_ISSUED: 'INVOICE.ISSUED',
  INVOICE_SENT: 'INVOICE.SENT',
  INVOICE_VOIDED: 'INVOICE.VOIDED',
  CREDIT_NOTE_ISSUED: 'INVOICE.CREDIT_NOTE_ISSUED',
  PAYMENT_RECORDED: 'PAYMENT.RECORDED',
  PAYMENT_WEBHOOK_PROCESSED: 'PAYMENT.WEBHOOK_PROCESSED',
  PAYMENT_REFUNDED: 'PAYMENT.REFUNDED',

  /* Auction */
  AUCTION_CREATED: 'AUCTION.CREATED',
  AUCTION_PUBLISHED: 'AUCTION.PUBLISHED',
  AUCTION_OPENED: 'AUCTION.OPENED',
  AUCTION_CLOSED: 'AUCTION.CLOSED',
  LOT_ADDED: 'AUCTION.LOT_ADDED',
  LOT_WITHDRAWN: 'AUCTION.LOT_WITHDRAWN',
  BIDDER_REGISTERED: 'AUCTION.BIDDER_REGISTERED',
  BIDDER_APPROVED: 'AUCTION.BIDDER_APPROVED',
  BID_PLACED: 'AUCTION.BID_PLACED',
  BID_REJECTED: 'AUCTION.BID_REJECTED',
  WINNER_SELECTED: 'AUCTION.WINNER_SELECTED',
  SETTLEMENT_CREATED: 'AUCTION.SETTLEMENT_CREATED',
  SETTLEMENT_UPDATED: 'AUCTION.SETTLEMENT_UPDATED',

  /* Platform */
  SETTING_CHANGED: 'CONFIG.SETTING_CHANGED',
  INTEGRATION_CONFIGURED: 'CONFIG.INTEGRATION_CONFIGURED',
  NOTIFICATION_TEMPLATE_CHANGED: 'CONFIG.NOTIFICATION_TEMPLATE_CHANGED',
  DOCUMENT_UPLOADED: 'DOCUMENT.UPLOADED',
  DOCUMENT_DOWNLOADED: 'DOCUMENT.DOWNLOADED',
  DATA_EXPORTED: 'REPORT.EXPORTED',
  JOB_TRIGGERED: 'JOB.TRIGGERED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditRecordInput {
  action: AuditAction | string;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  siteId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  reason?: string | null;
  outcome?: AuditOutcome;
  errorCode?: string | null;
  /** Overrides the ambient actor. Used when a job acts for a specific user. */
  actor?: {
    id?: string | null;
    type?: ActorType;
    label?: string | null;
    roles?: string[];
  };
}

/**
 * The audit trail.
 *
 * Two properties make this trustworthy rather than decorative:
 *
 *   1. Written INSIDE the caller's transaction. `record(tx, ...)` means the
 *      audit entry and the change it describes commit together, so the trail
 *      can never claim something that was rolled back, nor miss something that
 *      succeeded.
 *
 *   2. Append-only at the database. A trigger rejects UPDATE and DELETE on
 *      `audit_logs` outright, so the trail cannot be quietly rewritten even by
 *      someone with direct SQL access through the application role.
 *
 * Before/after snapshots pass through the same redaction as the logs, so a
 * password hash or a token can never be preserved in the trail.
 */
@Injectable()
export class AuditService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Audit');
  }

  /**
   * Records an entry using the caller's transaction.
   *
   * Prefer this over `recordDetached` everywhere a state change is involved.
   */
  async record(tx: PrismaExecutor, input: AuditRecordInput): Promise<void> {
    const context = RequestContextStore.get();

    const before = input.beforeState ? (redact(input.beforeState) as Prisma.InputJsonValue) : undefined;
    const after = input.afterState ? (redact(input.afterState) as Prisma.InputJsonValue) : undefined;

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId ?? context.organizationId ?? null,
        actorId: input.actor?.id ?? context.userId ?? null,
        actorType: input.actor?.type ?? (context.actorType as ActorType),
        actorLabel: input.actor?.label ?? context.userLabel ?? null,
        actorRoles: input.actor?.roles ?? context.userRoles ?? [],
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        siteId: input.siteId ?? null,
        ...(before !== undefined ? { beforeState: before } : {}),
        ...(after !== undefined ? { afterState: after } : {}),
        changedFields: diffKeys(input.beforeState, input.afterState),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        correlationId: context.correlationId,
        requestId: context.requestId,
        reason: input.reason ?? null,
        outcome: input.outcome ?? AuditOutcome.SUCCESS,
        errorCode: input.errorCode ?? null,
      },
    });
  }

  /**
   * Records an entry outside any transaction.
   *
   * For events with no accompanying state change - a failed login, a document
   * download, an export. Never used for a business mutation.
   */
  async recordDetached(input: AuditRecordInput): Promise<void> {
    try {
      await this.record(this.prisma, input);
    } catch (error) {
      // An audit write must not take down the operation that triggered it, but
      // a silent loss is unacceptable, so it is escalated in the log.
      this.logger.error('Failed to write audit entry', error, {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
      });
    }
  }

  /** Records a failed attempt. Kept distinct so failures are easy to query. */
  async recordFailure(
    input: Omit<AuditRecordInput, 'outcome'> & { errorCode: string },
  ): Promise<void> {
    await this.recordDetached({ ...input, outcome: AuditOutcome.FAILURE });
  }
}

/**
 * Field-level diff between two snapshots.
 *
 * Stored alongside the states so "what actually changed" is answerable with a
 * simple array-contains query, rather than requiring a JSON comparison over
 * millions of rows.
 */
export function diffKeys(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!deepEqual(before[key], after[key])) changed.push(key);
  }
  return changed.sort();
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();

  // Decimal and similar value objects.
  const aObj = a as { toFixed?: unknown; toString?: () => string };
  const bObj = b as { toFixed?: unknown; toString?: () => string };
  if (typeof aObj?.toFixed === 'function' && typeof bObj?.toFixed === 'function') {
    return String(a) === String(b);
  }

  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
