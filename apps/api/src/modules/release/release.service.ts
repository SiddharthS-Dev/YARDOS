import { Injectable } from '@nestjs/common';
import {
  ActorType,
  ApprovalDecision,
  ChargeCalculationType,
  ParkingSessionStatus,
  Prisma,
  ReleaseRequestStatus,
  VehicleStatus,
} from '@prisma/client';

import {
  BillingPartyType,
  ErrorCode,
  IN_AUCTION_VEHICLE_STATUSES,
  Paginated,
  TimelineEventType,
} from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import { RequestContextStore } from '@/common/context/request-context';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { generateReleaseNumber } from '@/common/util/ids';
import { randomNumericCode, sha256 } from '@/common/util/hash';
import { PrismaService, PrismaTransaction } from '@/infrastructure/prisma/prisma.service';
import { DomainEventType, OutboxService } from '@/infrastructure/outbox';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { ChargeService } from '@/modules/billing/charge.service';
import { AccessScope } from '@/modules/identity/guards';
import { InvoiceService } from '@/modules/invoice/invoice.service';
import { ParkingSessionService } from '@/modules/parking/parking-session.service';
import { SettingsService } from '@/modules/settings/settings.service';
import { ReleaseStateMachine } from '@/modules/shared/state-machine';
import { VehicleService } from '@/modules/vehicle/vehicle.service';

/** One eligibility check and its outcome. Frozen onto the request. */
export interface EligibilityCheck {
  code: string;
  label: string;
  passed: boolean;
  detail: string;
  /** A blocking failure prevents the release; a warning is advisory. */
  blocking: boolean;
}

export interface EligibilitySnapshot {
  checkedAt: string;
  eligible: boolean;
  checks: EligibilityCheck[];
  outstandingBalance: string | null;
  currency: string;
  finalChargeTotal: string | null;
}

export interface RequestReleaseInput {
  sessionId: string;
  reason: string;
  requestedForPartyType: BillingPartyType;
  requestedForName?: string | null;
  requestedForPhone?: string | null;
  requestedForIdRef?: string | null;
  /** Retrying with the same key returns the original request. */
  idempotencyKey?: string;
}

const SORTABLE = ['requestedAt', 'createdAt', 'status'] as const;

/**
 * Vehicle release.
 *
 * The workflow required by S17, and the most sensitive one in the platform:
 * these are third-party assets under repossession, and handing one to the wrong
 * person is not recoverable.
 *
 * The sequence is deliberate:
 *
 *   request -> eligibility -> final charge -> invoice -> settlement
 *           -> approval -> authorisation code -> gate exit -> visit closed
 *
 * Design decisions worth stating:
 *
 *   **This service orchestrates; it does not calculate.** The final charge
 *   comes from `ChargeService`, which invokes the already-tested
 *   `ChargeEngine`. There is no second pricing implementation here, and there
 *   must never be one.
 *
 *   **Approval is segregated.** A requester cannot approve their own release,
 *   enforced here and not merely by convention.
 *
 *   **The gate is the last step, not the first.** An approved release yields a
 *   one-time authorisation code; the visit closes only when a physical exit is
 *   recorded. `GateService` already refuses an exit capture with no approved
 *   release.
 *
 *   **One live request per stay**, guaranteed by a partial unique index rather
 *   than an application check, so two operators clicking simultaneously cannot
 *   both succeed.
 */
@Injectable()
export class ReleaseService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargeService,
    private readonly invoices: InvoiceService,
    private readonly sessions: ParkingSessionService,
    private readonly vehicles: VehicleService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Release');
  }

  /**
   * Evaluates whether a vehicle may be released, without changing anything.
   *
   * Exposed on its own so the console can show an operator the blockers before
   * they commit to a request.
   */
  async checkEligibility(
    actor: AuthenticatedUser,
    sessionId: string,
  ): Promise<EligibilitySnapshot> {
    const session = await this.prisma.parkingSession.findFirst({
      where: {
        id: sessionId,
        organizationId: actor.organizationId,
        ...(actor.financierId ? { financierId: actor.financierId } : {}),
      },
      include: {
        vehicle: { select: { id: true, status: true, registrationNumber: true } },
        invoices: {
          where: { status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] } },
          select: { id: true, invoiceNumber: true, balance: true, currency: true },
        },
        releaseRequests: {
          where: {
            status: {
              in: [
                'DRAFT',
                'SUBMITTED',
                'ELIGIBILITY_FAILED',
                'AWAITING_PAYMENT',
                'AWAITING_APPROVAL',
                'APPROVED',
              ],
            },
          },
          select: { id: true, requestNumber: true, status: true },
        },
      },
    });
    if (!session) throw notFound('Parking session', sessionId);
    AccessScope.assertSite(actor, session.siteId);

    return this.buildEligibility(session);
  }

  /**
   * Raises a release request and takes it as far as it can go without a human
   * decision.
   *
   * On success the request lands in AWAITING_PAYMENT (a balance is outstanding)
   * or AWAITING_APPROVAL (nothing left to collect). Eligibility failures are
   * recorded as ELIGIBILITY_FAILED rather than throwing, so the blockers are
   * visible and the request can be resubmitted once cleared.
   */
  async requestRelease(
    actor: AuthenticatedUser,
    input: RequestReleaseInput,
  ): Promise<ReleaseDetail> {
    const requestId = await this.prisma.transaction(async (tx) => {
      const session = await tx.parkingSession.findFirst({
        where: { id: input.sessionId, organizationId: actor.organizationId },
        include: {
          vehicle: { select: { id: true, status: true, registrationNumber: true } },
          invoices: {
            where: { status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] } },
            select: { id: true, invoiceNumber: true, balance: true, currency: true },
          },
          releaseRequests: {
            where: {
              status: {
                in: [
                  'DRAFT',
                  'SUBMITTED',
                  'ELIGIBILITY_FAILED',
                  'AWAITING_PAYMENT',
                  'AWAITING_APPROVAL',
                  'APPROVED',
                ],
              },
            },
            select: { id: true, requestNumber: true, status: true },
          },
        },
      });
      if (!session) throw notFound('Parking session', input.sessionId);
      AccessScope.assertSite(actor, session.siteId);

      // A financier portal user may only request release of their own vehicle.
      AccessScope.assertFinancier(actor, session.financierId);

      /* --- Already in flight? ---------------------------------------- */
      const inFlight = session.releaseRequests[0];
      if (inFlight) {
        throw new AppException(
          ErrorCode.RELEASE_ALREADY_REQUESTED,
          `Release ${inFlight.requestNumber} is already in progress for this stay (${inFlight.status}).`,
          { details: { releaseRequestId: inFlight.id, status: inFlight.status } },
        );
      }

      /* --- Eligibility ----------------------------------------------- */
      const eligibility = await this.buildEligibility(session);

      const requestNumber = generateReleaseNumber();

      const created = await tx.releaseRequest.create({
        data: {
          organizationId: actor.organizationId,
          siteId: session.siteId,
          sessionId: session.id,
          vehicleId: session.vehicleId,
          requestNumber,
          status: ReleaseRequestStatus.DRAFT,
          requestedById: actor.id,
          requestedForPartyType: input.requestedForPartyType,
          requestedForName: input.requestedForName ?? null,
          requestedForPhone: input.requestedForPhone ?? null,
          requestedForIdRef: input.requestedForIdRef ?? null,
          reason: input.reason.slice(0, 512),
          eligibilitySnapshot: eligibility as unknown as Prisma.InputJsonValue,
          eligibilityCheckedAt: new Date(),
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.transition(tx, created.id, ReleaseRequestStatus.SUBMITTED, actor.id);

      if (!eligibility.eligible) {
        await this.transition(
          tx,
          created.id,
          ReleaseRequestStatus.ELIGIBILITY_FAILED,
          actor.id,
        );

        await this.audit.record(tx, {
          action: AuditAction.RELEASE_ELIGIBILITY_CHECKED,
          entityType: 'ReleaseRequest',
          entityId: created.id,
          organizationId: actor.organizationId,
          siteId: session.siteId,
          outcome: 'FAILURE',
          errorCode: ErrorCode.RELEASE_NOT_ELIGIBLE,
          afterState: {
            requestNumber,
            blockers: eligibility.checks.filter((c) => !c.passed && c.blocking).map((c) => c.code),
          },
          reason: input.reason,
        });

        this.logger.info('Release request blocked by eligibility', {
          releaseRequestId: created.id,
          blockers: eligibility.checks.filter((c) => !c.passed && c.blocking).map((c) => c.code),
        });

        return created.id;
      }

      /* --- Final charge ---------------------------------------------- */
      // Computed as at NOW, since the vehicle is still on site. The exit
      // timestamp is not yet known; the calculation is refreshed when the
      // physical exit is recorded, and the invoice is raised then.
      const charge = await this.charges.calculateAndStore(
        tx,
        session.id,
        ChargeCalculationType.ESTIMATE,
        new Date(),
        { requireRate: false, actorId: actor.id },
      );

      await tx.releaseRequest.update({
        where: { id: created.id },
        data: { chargeCalculationId: charge.calculationId },
      });

      /* --- Route on outstanding balance ------------------------------- */
      const requireSettlement = await this.settings.getBoolean(
        actor.organizationId,
        'release.requireInvoiceSettled',
        false,
      );

      const hasOutstanding =
        eligibility.outstandingBalance !== null &&
        Number(eligibility.outstandingBalance) > 0;

      const next =
        hasOutstanding && requireSettlement
          ? ReleaseRequestStatus.AWAITING_PAYMENT
          : ReleaseRequestStatus.AWAITING_APPROVAL;

      await this.transition(tx, created.id, next, actor.id);

      /* --- Vehicle lifecycle ------------------------------------------ */
      await this.vehicles.transition(tx, session.vehicleId, VehicleStatus.RELEASE_REQUESTED, {
        reason: `Release ${requestNumber} requested: ${input.reason}`,
        sessionId: session.id,
        siteId: session.siteId,
        actorId: actor.id,
        actorType: ActorType.USER,
        tolerateNoop: true,
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: actor.organizationId,
          vehicleId: session.vehicleId,
          sessionId: session.id,
          siteId: session.siteId,
          type: TimelineEventType.RELEASE_REQUESTED,
          occurredAt: new Date(),
          actorId: actor.id,
          actorType: ActorType.USER,
          title: `Release ${requestNumber} requested`,
          description: input.reason.slice(0, 1000),
          payload: {
            releaseRequestId: created.id,
            requestedForPartyType: input.requestedForPartyType,
            estimatedCharge: charge.breakdown?.total ?? null,
          },
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.outbox.record(tx, {
        eventType: DomainEventType.RELEASE_REQUESTED,
        aggregateType: 'ReleaseRequest',
        aggregateId: created.id,
        payload: {
          releaseRequestId: created.id,
          requestNumber,
          organizationId: actor.organizationId,
          siteId: session.siteId,
          sessionId: session.id,
          vehicleId: session.vehicleId,
          status: next,
          actorId: actor.id,
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.RELEASE_REQUESTED,
        entityType: 'ReleaseRequest',
        entityId: created.id,
        organizationId: actor.organizationId,
        siteId: session.siteId,
        afterState: {
          requestNumber,
          status: next,
          requestedForPartyType: input.requestedForPartyType,
          requestedForName: input.requestedForName ?? null,
          estimatedChargeTotal: charge.breakdown?.total ?? null,
          outstandingBalance: eligibility.outstandingBalance,
        },
        reason: input.reason,
      });

      return created.id;
    });

    return this.findById(actor, requestId);
  }

  /**
   * Approves or rejects a release.
   *
   * On approval a one-time gate authorisation code is generated and returned
   * ONCE. Only its hash is stored, so a leaked database cannot be used to walk
   * a vehicle out of the yard.
   *
   * @throws AppException SELF_APPROVAL_NOT_PERMITTED,
   *         OUTSTANDING_BALANCE_BLOCKS_RELEASE
   */
  async decide(
    actor: AuthenticatedUser,
    releaseRequestId: string,
    decision: ApprovalDecision,
    remarks: string,
  ): Promise<{ release: ReleaseDetail; authorizationCode: string | null }> {
    let authorizationCode: string | null = null;

    await this.prisma.transaction(async (tx) => {
      const request = await tx.releaseRequest.findFirst({
        where: { id: releaseRequestId, organizationId: actor.organizationId },
        include: { session: true },
      });
      if (!request) throw notFound('Release request', releaseRequestId);
      AccessScope.assertSite(actor, request.siteId);

      // Segregation of duty. Enforced, not documented.
      if (request.requestedById === actor.id) {
        throw new AppException(
          ErrorCode.SELF_APPROVAL_NOT_PERMITTED,
          'You cannot approve a release you requested yourself.',
          { details: { releaseRequestId } },
        );
      }

      if (
        request.status !== ReleaseRequestStatus.AWAITING_APPROVAL &&
        request.status !== ReleaseRequestStatus.AWAITING_PAYMENT
      ) {
        throw new AppException(
          ErrorCode.INVALID_RELEASE_STATE_TRANSITION,
          `A release in state ${request.status} cannot be decided.`,
          { details: { status: request.status } },
        );
      }

      if (decision === ApprovalDecision.APPROVED) {
        // Re-check the balance at the moment of approval: it may have been
        // settled, or a new charge may have accrued, since the request.
        if (request.status === ReleaseRequestStatus.AWAITING_PAYMENT) {
          const outstanding = await tx.invoice.aggregate({
            _sum: { balance: true },
            where: {
              sessionId: request.sessionId,
              status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] },
            },
          });
          const balance = outstanding._sum.balance ?? new Prisma.Decimal(0);
          if (balance.greaterThan(0)) {
            throw new AppException(
              ErrorCode.OUTSTANDING_BALANCE_BLOCKS_RELEASE,
              `This release cannot be approved while ${balance.toFixed(2)} remains outstanding.`,
              { details: { outstandingBalance: balance.toFixed(4) } },
            );
          }
          await this.transition(
            tx,
            releaseRequestId,
            ReleaseRequestStatus.AWAITING_APPROVAL,
            actor.id,
          );
        }

        const ttlMinutes = await this.settings.getNumber(
          actor.organizationId,
          'release.authorizationCodeTtlMinutes',
          240,
        );

        authorizationCode = randomNumericCode(6);

        await tx.releaseRequest.update({
          where: { id: releaseRequestId },
          data: {
            approvedById: actor.id,
            approvedAt: new Date(),
            // Hash only. The plaintext is returned once and never stored.
            authorizationCodeHash: sha256(authorizationCode),
            authorizationExpiresAt: new Date(Date.now() + ttlMinutes * 60_000),
          },
        });

        await this.transition(tx, releaseRequestId, ReleaseRequestStatus.APPROVED, actor.id);

        await this.vehicles.transition(
          tx,
          request.vehicleId,
          VehicleStatus.RELEASE_APPROVED,
          {
            reason: `Release ${request.requestNumber} approved.`,
            sessionId: request.sessionId,
            siteId: request.siteId,
            actorId: actor.id,
            actorType: ActorType.USER,
            tolerateNoop: true,
          },
        );
      } else {
        await tx.releaseRequest.update({
          where: { id: releaseRequestId },
          data: {
            rejectedById: actor.id,
            rejectedAt: new Date(),
            rejectionReason: remarks.slice(0, 512),
          },
        });
        await this.transition(tx, releaseRequestId, ReleaseRequestStatus.REJECTED, actor.id);

        // A rejected release returns the vehicle to the yard.
        await this.vehicles.transition(tx, request.vehicleId, VehicleStatus.PARKED, {
          reason: `Release ${request.requestNumber} rejected: ${remarks}`,
          sessionId: request.sessionId,
          siteId: request.siteId,
          actorId: actor.id,
          actorType: ActorType.USER,
          tolerateNoop: true,
        });
      }

      // Append-only approval log, protected by a database trigger.
      const context = RequestContextStore.get();
      await tx.releaseApproval.create({
        data: {
          releaseRequestId,
          approverId: actor.id,
          decision,
          remarks: remarks.slice(0, 512),
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          correlationId: context.correlationId,
        },
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: actor.organizationId,
          vehicleId: request.vehicleId,
          sessionId: request.sessionId,
          siteId: request.siteId,
          type:
            decision === ApprovalDecision.APPROVED
              ? TimelineEventType.RELEASE_APPROVED
              : TimelineEventType.RELEASE_REJECTED,
          occurredAt: new Date(),
          actorId: actor.id,
          actorType: ActorType.USER,
          title:
            decision === ApprovalDecision.APPROVED
              ? `Release ${request.requestNumber} approved`
              : `Release ${request.requestNumber} rejected`,
          description: remarks.slice(0, 1000),
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.outbox.record(tx, {
        eventType:
          decision === ApprovalDecision.APPROVED
            ? DomainEventType.RELEASE_APPROVED
            : DomainEventType.RELEASE_REJECTED,
        aggregateType: 'ReleaseRequest',
        aggregateId: releaseRequestId,
        payload: {
          releaseRequestId,
          requestNumber: request.requestNumber,
          organizationId: actor.organizationId,
          siteId: request.siteId,
          sessionId: request.sessionId,
          vehicleId: request.vehicleId,
          status: decision === ApprovalDecision.APPROVED ? 'APPROVED' : 'REJECTED',
          actorId: actor.id,
        },
      });

      await this.audit.record(tx, {
        action:
          decision === ApprovalDecision.APPROVED
            ? AuditAction.RELEASE_APPROVED
            : AuditAction.RELEASE_REJECTED,
        entityType: 'ReleaseRequest',
        entityId: releaseRequestId,
        organizationId: actor.organizationId,
        siteId: request.siteId,
        beforeState: { status: request.status },
        afterState: {
          status: decision === ApprovalDecision.APPROVED ? 'APPROVED' : 'REJECTED',
          approverId: actor.id,
          // Never the code itself.
          authorizationCodeIssued: decision === ApprovalDecision.APPROVED,
        },
        reason: remarks,
      });
    });

    return { release: await this.findById(actor, releaseRequestId), authorizationCode };
  }

  /**
   * Records the physical exit and closes the visit.
   *
   * This is where the money is finalised: the FINAL charge is computed to the
   * actual exit instant and the invoice is raised from it. Doing it here rather
   * than at approval means the amount reflects the real departure time, which
   * is what the financier will be invoiced for.
   *
   * @throws AppException RELEASE_NOT_APPROVED, RELEASE_AUTHORIZATION_INVALID
   */
  async completeRelease(
    actor: AuthenticatedUser,
    releaseRequestId: string,
    input: {
      authorizationCode?: string | null;
      exitAnprEventId?: string | null;
      exitGateId?: string | null;
      exitAt?: Date;
    } = {},
  ): Promise<{ release: ReleaseDetail; invoiceId: string | null; invoiceNumber: string | null }> {
    let invoiceId: string | null = null;
    let invoiceNumber: string | null = null;

    await this.prisma.transaction(
      async (tx) => {
        const request = await tx.releaseRequest.findFirst({
          where: { id: releaseRequestId, organizationId: actor.organizationId },
        });
        if (!request) throw notFound('Release request', releaseRequestId);
        AccessScope.assertSite(actor, request.siteId);

        if (request.status === ReleaseRequestStatus.COMPLETED) {
          throw new AppException(
            ErrorCode.RELEASE_ALREADY_COMPLETED,
            `Release ${request.requestNumber} has already been completed.`,
          );
        }
        if (request.status !== ReleaseRequestStatus.APPROVED) {
          throw new AppException(
            ErrorCode.RELEASE_NOT_APPROVED,
            `Release ${request.requestNumber} is ${request.status} and cannot be completed.`,
            { details: { status: request.status } },
          );
        }

        /* --- Authorisation code -------------------------------------- */
        if (request.authorizationCodeHash) {
          if (!input.authorizationCode) {
            throw new AppException(
              ErrorCode.RELEASE_AUTHORIZATION_INVALID,
              'The gate authorisation code is required to complete this release.',
            );
          }
          if (sha256(input.authorizationCode) !== request.authorizationCodeHash) {
            this.logger.warn('Release completion rejected: bad authorisation code', {
              releaseRequestId,
            });
            throw new AppException(
              ErrorCode.RELEASE_AUTHORIZATION_INVALID,
              'That authorisation code is not valid for this release.',
            );
          }
          if (
            request.authorizationExpiresAt &&
            request.authorizationExpiresAt < new Date()
          ) {
            throw new AppException(
              ErrorCode.RELEASE_AUTHORIZATION_INVALID,
              'The authorisation code has expired. Ask for a fresh approval.',
              { details: { expiredAt: request.authorizationExpiresAt.toISOString() } },
            );
          }
        }

        const exitAt = input.exitAt ?? new Date();

        /* --- Close the visit and freeze the FINAL charge -------------- */
        const closed = await this.sessions.closeSession(tx, {
          sessionId: request.sessionId,
          exitAt,
          exitAnprEventId: input.exitAnprEventId ?? null,
          exitGateId: input.exitGateId ?? null,
          closureReason: `Released under ${request.requestNumber}.`,
          actorId: actor.id,
          // A stay must be priced before it can be invoiced. An unrated stay
          // fails here rather than producing a zero invoice.
          requireRate: true,
        });

        /* --- Invoice from that frozen calculation --------------------- */
        if (closed.calculationId) {
          const generated = await this.invoices.generateForSession(tx, {
            sessionId: request.sessionId,
            actorId: actor.id,
            organizationId: actor.organizationId,
            chargeCalculationId: closed.calculationId,
            // Deterministic: retrying completion cannot raise a second invoice.
            idempotencyKey: `release:${releaseRequestId}`,
            customer:
              request.requestedForPartyType === 'CUSTOMER' && request.requestedForName
                ? {
                    name: request.requestedForName,
                    phone: request.requestedForPhone,
                  }
                : null,
            releaseRequestedForPartyType: request.requestedForPartyType,
            notes: `Raised on release ${request.requestNumber}.`,
          });
          invoiceId = generated.invoiceId;
          invoiceNumber = generated.invoiceNumber;

          await tx.releaseRequest.update({
            where: { id: releaseRequestId },
            data: { invoiceId, chargeCalculationId: closed.calculationId },
          });
        }

        await tx.releaseRequest.update({
          where: { id: releaseRequestId },
          data: {
            completedAt: exitAt,
            completedById: actor.id,
            exitAnprEventId: input.exitAnprEventId ?? null,
            // Consume the code so it cannot be replayed.
            authorizationCodeHash: null,
            authorizationExpiresAt: null,
          },
        });

        await this.transition(tx, releaseRequestId, ReleaseRequestStatus.COMPLETED, actor.id);

        await this.vehicles.transition(tx, request.vehicleId, VehicleStatus.EXITED, {
          reason: `Exited under release ${request.requestNumber}.`,
          sessionId: request.sessionId,
          siteId: request.siteId,
          actorId: actor.id,
          actorType: ActorType.USER,
        });

        await tx.vehicleTimelineEvent.create({
          data: {
            organizationId: actor.organizationId,
            vehicleId: request.vehicleId,
            sessionId: request.sessionId,
            siteId: request.siteId,
            type: TimelineEventType.VEHICLE_EXITED,
            occurredAt: exitAt,
            actorId: actor.id,
            actorType: ActorType.USER,
            title: 'Vehicle exited',
            description: `Released under ${request.requestNumber}.`,
            payload: { releaseRequestId, invoiceId, invoiceNumber },
            correlationId: RequestContextStore.correlationId(),
          },
        });

        await this.outbox.record(tx, {
          eventType: DomainEventType.RELEASE_COMPLETED,
          aggregateType: 'ReleaseRequest',
          aggregateId: releaseRequestId,
          payload: {
            releaseRequestId,
            requestNumber: request.requestNumber,
            organizationId: actor.organizationId,
            siteId: request.siteId,
            sessionId: request.sessionId,
            vehicleId: request.vehicleId,
            status: 'COMPLETED',
            actorId: actor.id,
          },
        });

        await this.audit.record(tx, {
          action: AuditAction.RELEASE_COMPLETED,
          entityType: 'ReleaseRequest',
          entityId: releaseRequestId,
          organizationId: actor.organizationId,
          siteId: request.siteId,
          beforeState: { status: ReleaseRequestStatus.APPROVED },
          afterState: {
            status: ReleaseRequestStatus.COMPLETED,
            exitAt: exitAt.toISOString(),
            invoiceId,
            invoiceNumber,
            chargeCalculationId: closed.calculationId,
          },
        });
      },
      // Closing a visit, pricing it and invoicing it in one transaction is
      // several writes; the default timeout is tight for a slow database.
      { timeoutMs: 30_000 },
    );

    return { release: await this.findById(actor, releaseRequestId), invoiceId, invoiceNumber };
  }

  async cancel(
    actor: AuthenticatedUser,
    releaseRequestId: string,
    reason: string,
  ): Promise<ReleaseDetail> {
    await this.prisma.transaction(async (tx) => {
      const request = await tx.releaseRequest.findFirst({
        where: { id: releaseRequestId, organizationId: actor.organizationId },
      });
      if (!request) throw notFound('Release request', releaseRequestId);
      AccessScope.assertSite(actor, request.siteId);

      await this.transition(tx, releaseRequestId, ReleaseRequestStatus.CANCELLED, actor.id);

      // Return the vehicle to the yard unless it has already left.
      await this.vehicles.transition(tx, request.vehicleId, VehicleStatus.PARKED, {
        reason: `Release ${request.requestNumber} cancelled: ${reason}`,
        sessionId: request.sessionId,
        siteId: request.siteId,
        actorId: actor.id,
        actorType: ActorType.USER,
        tolerateNoop: true,
      });

      await this.audit.record(tx, {
        action: AuditAction.RELEASE_REJECTED,
        entityType: 'ReleaseRequest',
        entityId: releaseRequestId,
        organizationId: actor.organizationId,
        siteId: request.siteId,
        beforeState: { status: request.status },
        afterState: { status: ReleaseRequestStatus.CANCELLED },
        reason,
      });
    });

    return this.findById(actor, releaseRequestId);
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
    filters: { status?: ReleaseRequestStatus[]; siteId?: string; search?: string },
  ): Promise<Paginated<ReleaseListItem>> {
    const siteFilter = AccessScope.siteFilter(actor);

    const where: Prisma.ReleaseRequestWhereInput = {
      organizationId: actor.organizationId,
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(filters.siteId ? { siteId: filters.siteId } : siteFilter ? { siteId: siteFilter } : {}),
      ...(actor.financierId ? { session: { financierId: actor.financierId } } : {}),
      ...(filters.search
        ? {
            OR: [
              { requestNumber: { contains: filters.search.toUpperCase() } },
              {
                vehicle: {
                  normalizedRegistrationNumber: {
                    contains: filters.search.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.releaseRequest.findMany({
        where,
        include: releaseInclude,
        orderBy: query.orderBy(SORTABLE, 'requestedAt'),
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.releaseRequest.count({ where }),
    ]);

    return paginate(rows.map(toReleaseItem), totalItems, query);
  }

  async findById(actor: AuthenticatedUser, releaseRequestId: string): Promise<ReleaseDetail> {
    const request = await this.prisma.releaseRequest.findFirst({
      where: {
        id: releaseRequestId,
        organizationId: actor.organizationId,
        ...(actor.financierId ? { session: { financierId: actor.financierId } } : {}),
      },
      include: {
        ...releaseInclude,
        approvals: { orderBy: { decidedAt: 'asc' } },
        invoice: { select: { id: true, invoiceNumber: true, total: true, balance: true, status: true } },
      },
    });
    if (!request) throw notFound('Release request', releaseRequestId);

    return {
      ...toReleaseItem(request),
      reason: request.reason,
      requestedForName: request.requestedForName,
      requestedForPhone: request.requestedForPhone,
      requestedForIdRef: request.requestedForIdRef,
      rejectionReason: request.rejectionReason,
      eligibility: (request.eligibilitySnapshot ?? null) as EligibilitySnapshot | null,
      chargeCalculationId: request.chargeCalculationId,
      invoiceId: request.invoice?.id ?? null,
      invoiceNumber: request.invoice?.invoiceNumber ?? null,
      invoiceTotal: request.invoice?.total.toFixed(4) ?? null,
      invoiceBalance: request.invoice?.balance.toFixed(4) ?? null,
      invoiceStatus: request.invoice?.status ?? null,
      // Whether a code is currently outstanding - never the code itself.
      authorizationPending: request.authorizationCodeHash !== null,
      authorizationExpiresAt: request.authorizationExpiresAt?.toISOString() ?? null,
      approvals: request.approvals.map((approval) => ({
        approverId: approval.approverId,
        decision: approval.decision,
        remarks: approval.remarks,
        decidedAt: approval.decidedAt.toISOString(),
      })),
    };
  }

  /* ---------------------------------------------------------------- */

  /**
   * Runs every eligibility rule.
   *
   * Blocking failures stop the release; non-blocking ones are advisory and
   * shown to the operator. Which balance rule applies is configuration
   * (`release.requireInvoiceSettled`), because whether financiers settle per
   * vehicle or on account is unresolved (OI-03).
   */
  private async buildEligibility(session: {
    id: string;
    siteId: string;
    organizationId: string;
    status: ParkingSessionStatus;
    rateUnresolved: boolean;
    holdReason: string | null;
    financierId: string | null;
    vehicle: { id: string; status: VehicleStatus; registrationNumber: string };
    invoices: Array<{ invoiceNumber: string; balance: Prisma.Decimal; currency: string }>;
    releaseRequests: Array<{ id: string; requestNumber: string; status: ReleaseRequestStatus }>;
  }): Promise<EligibilitySnapshot> {
    const checks: EligibilityCheck[] = [];

    /* Visit must be live. */
    const liveStatuses: ParkingSessionStatus[] = [
      ParkingSessionStatus.OPEN,
      ParkingSessionStatus.ON_HOLD,
      ParkingSessionStatus.PENDING_EXIT,
    ];
    const sessionLive = liveStatuses.includes(session.status);
    checks.push({
      code: 'SESSION_ACTIVE',
      label: 'Vehicle is on site',
      passed: sessionLive,
      detail: sessionLive
        ? `Stay is ${session.status}.`
        : `Stay is ${session.status}; the vehicle is not on site.`,
      blocking: true,
    });

    /* No legal or financier hold. */
    const held = session.status === ParkingSessionStatus.ON_HOLD;
    checks.push({
      code: 'NO_HOLD',
      label: 'No hold in force',
      passed: !held,
      detail: held
        ? `Hold in force: ${session.holdReason ?? 'no reason recorded'}. Lift it before releasing.`
        : 'No hold in force.',
      blocking: true,
    });

    /* Not committed to an auction. */
    const inAuction = (IN_AUCTION_VEHICLE_STATUSES as readonly string[]).includes(
      session.vehicle.status,
    );
    checks.push({
      code: 'NOT_IN_AUCTION',
      label: 'Not committed to an auction',
      passed: !inAuction,
      detail: inAuction
        ? `Vehicle is ${session.vehicle.status} in an auction process and cannot be released.`
        : 'Vehicle is not in an auction.',
      blocking: true,
    });

    /* The stay must be priced, or nothing can be invoiced. */
    checks.push({
      code: 'RATE_RESOLVED',
      label: 'Stay is priced',
      passed: !session.rateUnresolved,
      detail: session.rateUnresolved
        ? 'No rate plan is attached to this stay. Finance must attach one before release.'
        : 'A rate plan is attached.',
      blocking: true,
    });

    /* Outstanding balance - blocking only if configured that way. */
    const outstanding = session.invoices.reduce(
      (sum, invoice) => sum.add(invoice.balance),
      new Prisma.Decimal(0),
    );
    const currency = session.invoices[0]?.currency ?? 'INR';
    const requireSettlement = await this.settings.getBoolean(
      session.organizationId,
      'release.requireInvoiceSettled',
      false,
    );

    checks.push({
      code: 'NO_OUTSTANDING_BALANCE',
      label: 'No outstanding balance',
      passed: outstanding.lessThanOrEqualTo(0),
      detail: outstanding.greaterThan(0)
        ? `${currency} ${outstanding.toFixed(2)} outstanding across ${session.invoices.length} invoice(s).` +
          (requireSettlement
            ? ' Settlement is required before release.'
            : ' Advisory only: release.requireInvoiceSettled is off (OI-03).')
        : 'Nothing outstanding.',
      blocking: requireSettlement,
    });

    /* No other release already in flight. */
    const otherRequest = session.releaseRequests[0];
    checks.push({
      code: 'NO_ACTIVE_RELEASE',
      label: 'No release already in progress',
      passed: otherRequest === undefined,
      detail: otherRequest
        ? `Release ${otherRequest.requestNumber} is already ${otherRequest.status}.`
        : 'No other release in progress.',
      blocking: true,
    });

    /* Estimated final charge, for the operator's information. */
    let finalChargeTotal: string | null = null;
    try {
      const estimate = await this.charges.estimate(session.id);
      finalChargeTotal = estimate.breakdown?.total ?? null;
    } catch (error) {
      // An estimate failure must not make the vehicle unreleasable; the
      // RATE_RESOLVED check already covers the case that matters.
      this.logger.debug('Could not estimate the final charge during eligibility', {
        sessionId: session.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      checkedAt: new Date().toISOString(),
      eligible: checks.every((check) => check.passed || !check.blocking),
      checks,
      outstandingBalance: outstanding.toFixed(4),
      currency,
      finalChargeTotal,
    };
  }

  /**
   * The only route by which `release_requests.status` changes.
   *
   * Validates against `RELEASE_TRANSITIONS` and applies an optimistic version
   * check, so two concurrent decisions cannot both land.
   */
  private async transition(
    tx: PrismaTransaction,
    releaseRequestId: string,
    to: ReleaseRequestStatus,
    actorId: string,
  ): Promise<void> {
    const request = await tx.releaseRequest.findUniqueOrThrow({
      where: { id: releaseRequestId },
      select: { status: true, version: true },
    });

    ReleaseStateMachine.assert(request.status, to);

    const result = await tx.releaseRequest.updateMany({
      where: { id: releaseRequestId, version: request.version },
      data: { status: to, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new AppException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'The release request changed while you were working on it. Reload and try again.',
        { details: { releaseRequestId, actorId } },
      );
    }
  }
}

/* ------------------------------------------------------------------ */

const releaseInclude = {
  vehicle: {
    select: { id: true, registrationNumber: true, make: true, model: true, status: true },
  },
  site: { select: { id: true, name: true, code: true } },
  session: {
    select: { id: true, sessionNumber: true, entryAt: true, financierId: true, rateUnresolved: true },
  },
} satisfies Prisma.ReleaseRequestInclude;

type ReleaseRow = Prisma.ReleaseRequestGetPayload<{ include: typeof releaseInclude }>;

export interface ReleaseListItem {
  id: string;
  requestNumber: string;
  status: string;
  requestedAt: string;
  requestedById: string;
  requestedForPartyType: string;
  approvedAt: string | null;
  completedAt: string | null;
  siteId: string;
  siteName: string;
  sessionId: string;
  sessionNumber: string;
  vehicleId: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  vehicleStatus: string;
}

export interface ReleaseDetail extends ReleaseListItem {
  reason: string;
  requestedForName: string | null;
  requestedForPhone: string | null;
  requestedForIdRef: string | null;
  rejectionReason: string | null;
  eligibility: EligibilitySnapshot | null;
  chargeCalculationId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceTotal: string | null;
  invoiceBalance: string | null;
  invoiceStatus: string | null;
  authorizationPending: boolean;
  authorizationExpiresAt: string | null;
  approvals: Array<{
    approverId: string;
    decision: string;
    remarks: string | null;
    decidedAt: string;
  }>;
}

function toReleaseItem(row: ReleaseRow): ReleaseListItem {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    requestedById: row.requestedById,
    requestedForPartyType: row.requestedForPartyType,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    siteId: row.siteId,
    siteName: row.site.name,
    sessionId: row.sessionId,
    sessionNumber: row.session.sessionNumber,
    vehicleId: row.vehicleId,
    registrationNumber: row.vehicle.registrationNumber,
    make: row.vehicle.make,
    model: row.vehicle.model,
    vehicleStatus: row.vehicle.status,
  };
}
