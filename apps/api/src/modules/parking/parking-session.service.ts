import { Injectable } from '@nestjs/common';
import {
  ActorType,
  ChargeCalculationType,
  ParkingSessionStatus,
  ParkingSpaceStatus,
  Prisma,
  VehicleStatus,
} from '@prisma/client';

import { ErrorCode, Paginated, TimelineEventType } from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import { RequestContextStore } from '@/common/context/request-context';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainEventType, OutboxService } from '@/infrastructure/outbox';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { ChargeService } from '@/modules/billing/charge.service';
import { ageingDays } from '@/modules/billing/domain/duration';
import { AccessScope } from '@/modules/identity/guards';
import { VehicleService } from '@/modules/vehicle/vehicle.service';
import { ParkingSessionStateMachine } from '@/modules/shared/state-machine';

export interface SessionListFilters {
  siteId?: string;
  financierId?: string;
  status?: ParkingSessionStatus[];
  zoneId?: string;
  search?: string;
  rateUnresolvedOnly?: boolean;
  /** Stays longer than N days. Drives the ageing work queue. */
  minAgeingDays?: number;
}

const SORTABLE = ['entryAt', 'exitAt', 'createdAt', 'sessionNumber'] as const;

/**
 * Parking session operations that are not the gate itself: listing, holds,
 * re-allocation and the manual close.
 */
@Injectable()
export class ParkingSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargeService,
    private readonly vehicles: VehicleService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
    filters: SessionListFilters,
  ): Promise<Paginated<SessionListItem>> {
    const siteFilter = AccessScope.siteFilter(actor);

    const where: Prisma.ParkingSessionWhereInput = {
      organizationId: actor.organizationId,
      // Financier portal users see only their own vehicles' stays.
      ...(actor.financierId ? { financierId: actor.financierId } : {}),
      ...(filters.financierId ? { financierId: filters.financierId } : {}),
      ...(filters.siteId ? { siteId: filters.siteId } : siteFilter ? { siteId: siteFilter } : {}),
      ...(filters.status && filters.status.length > 0 ? { status: { in: filters.status } } : {}),
      ...(filters.zoneId ? { zoneId: filters.zoneId } : {}),
      ...(filters.rateUnresolvedOnly ? { rateUnresolved: true } : {}),
      ...(filters.minAgeingDays
        ? { entryAt: { lte: new Date(Date.now() - filters.minAgeingDays * 86_400_000) } }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { sessionNumber: { contains: filters.search.toUpperCase() } },
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
      this.prisma.parkingSession.findMany({
        where,
        include: sessionInclude,
        orderBy: query.orderBy(SORTABLE, 'entryAt'),
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.parkingSession.count({ where }),
    ]);

    return paginate(rows.map(toListItem), totalItems, query);
  }

  async findById(actor: AuthenticatedUser, sessionId: string): Promise<SessionDetail> {
    const session = await this.prisma.parkingSession.findFirst({
      where: {
        id: sessionId,
        organizationId: actor.organizationId,
        ...(actor.financierId ? { financierId: actor.financierId } : {}),
      },
      include: {
        ...sessionInclude,
        contractVersion: { include: { contract: { select: { code: true, title: true } } } },
        ratePlan: { select: { code: true, name: true, billingUnit: true } },
        allocations: { orderBy: { allocatedAt: 'desc' }, include: { zone: true, space: true } },
      },
    });
    if (!session) throw notFound('Parking session', sessionId);
    AccessScope.assertSite(actor, session.siteId);

    const estimate = await this.charges.estimate(sessionId);

    return {
      ...toListItem(session),
      contractCode: session.contractVersion?.contract.code ?? null,
      contractTitle: session.contractVersion?.contract.title ?? null,
      ratePlanCode: session.ratePlan?.code ?? null,
      ratePlanName: session.ratePlan?.name ?? null,
      billingUnit: session.ratePlan?.billingUnit ?? null,
      admissionMethod: session.admissionMethod,
      holdReason: session.holdReason,
      closureReason: session.closureReason,
      currentCharge: estimate.breakdown
        ? {
            subtotal: estimate.breakdown.subtotal,
            taxTotal: estimate.breakdown.taxTotal,
            total: estimate.breakdown.total,
            currency: estimate.breakdown.currency,
            chargeableUnits: estimate.breakdown.chargeableUnits,
            explanation: estimate.breakdown.explanation,
          }
        : null,
      chargeUnavailableReason: estimate.unavailableReason ?? null,
      allocations: session.allocations.map((allocation) => ({
        zoneName: allocation.zone.name,
        spaceCode: allocation.space?.code ?? null,
        allocatedAt: allocation.allocatedAt.toISOString(),
        releasedAt: allocation.releasedAt?.toISOString() ?? null,
        reason: allocation.reason,
      })),
    };
  }

  /**
   * Places a hold, which blocks release without ending the stay.
   *
   * Used for a court order, a financier dispute, or a documentation problem.
   * Charges keep accruing - the vehicle is still occupying a bay.
   */
  async placeHold(
    actor: AuthenticatedUser,
    sessionId: string,
    reason: string,
  ): Promise<SessionListItem> {
    return this.prisma.transaction(async (tx) => {
      const session = await tx.parkingSession.findUnique({ where: { id: sessionId } });
      if (!session) throw notFound('Parking session', sessionId);
      AccessScope.assertSite(actor, session.siteId);

      ParkingSessionStateMachine.assert(session.status, ParkingSessionStatus.ON_HOLD);

      const updated = await tx.parkingSession.updateMany({
        where: { id: sessionId, version: session.version },
        data: {
          status: ParkingSessionStatus.ON_HOLD,
          holdReason: reason.slice(0, 512),
          heldById: actor.id,
          heldAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new AppException(
          ErrorCode.CONCURRENT_MODIFICATION,
          'The stay changed while you were working on it. Reload and try again.',
        );
      }

      await this.vehicles.transition(tx, session.vehicleId, VehicleStatus.UNDER_HOLD, {
        reason,
        sessionId,
        siteId: session.siteId,
        actorId: actor.id,
        actorType: ActorType.USER,
        tolerateNoop: true,
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: session.organizationId,
          vehicleId: session.vehicleId,
          sessionId,
          siteId: session.siteId,
          type: TimelineEventType.HOLD_PLACED,
          occurredAt: new Date(),
          actorId: actor.id,
          actorType: ActorType.USER,
          title: 'Hold placed',
          description: reason.slice(0, 1000),
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.outbox.record(tx, {
        eventType: DomainEventType.SESSION_HELD,
        aggregateType: 'ParkingSession',
        aggregateId: sessionId,
        payload: { sessionId, organizationId: session.organizationId, reason },
      });

      await this.audit.record(tx, {
        action: AuditAction.SESSION_HELD,
        entityType: 'ParkingSession',
        entityId: sessionId,
        organizationId: session.organizationId,
        siteId: session.siteId,
        beforeState: { status: session.status },
        afterState: { status: ParkingSessionStatus.ON_HOLD },
        reason,
      });

      const reloaded = await tx.parkingSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: sessionInclude,
      });
      return toListItem(reloaded);
    });
  }

  async liftHold(
    actor: AuthenticatedUser,
    sessionId: string,
    reason: string,
  ): Promise<SessionListItem> {
    return this.prisma.transaction(async (tx) => {
      const session = await tx.parkingSession.findUnique({ where: { id: sessionId } });
      if (!session) throw notFound('Parking session', sessionId);
      AccessScope.assertSite(actor, session.siteId);

      ParkingSessionStateMachine.assert(session.status, ParkingSessionStatus.OPEN);

      await tx.parkingSession.update({
        where: { id: sessionId },
        data: {
          status: ParkingSessionStatus.OPEN,
          holdReason: null,
          heldById: null,
          heldAt: null,
          version: { increment: 1 },
        },
      });

      await this.vehicles.transition(tx, session.vehicleId, VehicleStatus.PARKED, {
        reason,
        sessionId,
        siteId: session.siteId,
        actorId: actor.id,
        actorType: ActorType.USER,
        tolerateNoop: true,
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: session.organizationId,
          vehicleId: session.vehicleId,
          sessionId,
          siteId: session.siteId,
          type: TimelineEventType.HOLD_LIFTED,
          occurredAt: new Date(),
          actorId: actor.id,
          actorType: ActorType.USER,
          title: 'Hold lifted',
          description: reason.slice(0, 1000),
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.SESSION_HOLD_LIFTED,
        entityType: 'ParkingSession',
        entityId: sessionId,
        organizationId: session.organizationId,
        siteId: session.siteId,
        beforeState: { status: session.status },
        afterState: { status: ParkingSessionStatus.OPEN },
        reason,
      });

      const reloaded = await tx.parkingSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: sessionInclude,
      });
      return toListItem(reloaded);
    });
  }

  /**
   * Closes a stay and frees its bay.
   *
   * Shared by the release workflow and by public-parking exit. Computes and
   * freezes a FINAL charge in the same transaction, so a closed stay always has
   * an immutable amount behind it.
   */
  async closeSession(
    tx: Prisma.TransactionClient,
    input: {
      sessionId: string;
      exitAt: Date;
      exitAnprEventId?: string | null;
      exitGateId?: string | null;
      closureReason: string;
      actorId: string | null;
      requireRate: boolean;
    },
  ): Promise<{ calculationId: string | null }> {
    const session = await tx.parkingSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw notFound('Parking session', input.sessionId);

    if (session.status === ParkingSessionStatus.CLOSED) {
      throw new AppException(
        ErrorCode.SESSION_ALREADY_CLOSED,
        'This stay is already closed.',
        { details: { sessionId: input.sessionId } },
      );
    }
    if (input.exitAt < session.entryAt) {
      throw new AppException(
        ErrorCode.EXIT_BEFORE_ENTRY,
        'The exit time is before the entry time.',
      );
    }

    ParkingSessionStateMachine.assert(session.status, ParkingSessionStatus.CLOSED);

    // The charge is computed BEFORE the row is touched, with the exit instant
    // passed explicitly as `asOf`. An earlier version set `exitAt` in its own
    // UPDATE first, which left the row momentarily as status=OPEN with an exit
    // time set - and that violates the `parking_sessions_open_has_no_exit`
    // CHECK constraint. The constraint is correct; the write order was not.
    // `calculateAndStore` bounds the stay by `asOf` when `exitAt` is still
    // null, so nothing is lost by deferring the write.
    const charge = await this.charges.calculateAndStore(
      tx as never,
      input.sessionId,
      ChargeCalculationType.FINAL,
      input.exitAt,
      { requireRate: input.requireRate, actorId: input.actorId },
    );

    // Status and exit time move together, in one write, so the row is never
    // in a state the constraint forbids.
    const updated = await tx.parkingSession.updateMany({
      where: { id: input.sessionId, version: session.version },
      data: {
        status: ParkingSessionStatus.CLOSED,
        exitAt: input.exitAt,
        exitAnprEventId: input.exitAnprEventId ?? null,
        exitGateId: input.exitGateId ?? null,
        closedById: input.actorId,
        closureReason: input.closureReason.slice(0, 512),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new AppException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'The stay changed while it was being closed. Reload and try again.',
      );
    }

    // Free the bay and close the allocation.
    if (session.spaceId) {
      await tx.parkingSpace.update({
        where: { id: session.spaceId },
        data: { status: ParkingSpaceStatus.AVAILABLE },
      });
    }
    await tx.parkingAllocation.updateMany({
      where: { sessionId: input.sessionId, releasedAt: null },
      data: { releasedAt: input.exitAt },
    });

    await tx.vehicle.update({
      where: { id: session.vehicleId },
      data: { currentSessionId: null, currentSiteId: null, lastSeenAt: input.exitAt },
    });

    await tx.vehicleTimelineEvent.create({
      data: {
        organizationId: session.organizationId,
        vehicleId: session.vehicleId,
        sessionId: input.sessionId,
        siteId: session.siteId,
        type: TimelineEventType.SESSION_CLOSED,
        occurredAt: input.exitAt,
        actorId: input.actorId,
        actorType: input.actorId ? ActorType.USER : ActorType.SYSTEM,
        title: `Stay ${session.sessionNumber} closed`,
        description: input.closureReason.slice(0, 1000),
        payload: { chargeCalculationId: charge.calculationId },
        correlationId: RequestContextStore.correlationId(),
      },
    });

    await this.outbox.record(tx as never, {
      eventType: DomainEventType.SESSION_CLOSED,
      aggregateType: 'ParkingSession',
      aggregateId: input.sessionId,
      payload: {
        sessionId: input.sessionId,
        organizationId: session.organizationId,
        siteId: session.siteId,
        vehicleId: session.vehicleId,
        exitAt: input.exitAt.toISOString(),
        chargeCalculationId: charge.calculationId,
        invoiceId: null,
      },
    });

    await this.audit.record(tx as never, {
      action: AuditAction.SESSION_CLOSED,
      entityType: 'ParkingSession',
      entityId: input.sessionId,
      organizationId: session.organizationId,
      siteId: session.siteId,
      beforeState: { status: session.status, exitAt: null },
      afterState: {
        status: ParkingSessionStatus.CLOSED,
        exitAt: input.exitAt.toISOString(),
        chargeCalculationId: charge.calculationId,
      },
      reason: input.closureReason,
    });

    return { calculationId: charge.calculationId };
  }
}

/* ------------------------------------------------------------------ */

const sessionInclude = {
  vehicle: {
    select: {
      id: true,
      registrationNumber: true,
      normalizedRegistrationNumber: true,
      make: true,
      model: true,
      vehicleClass: true,
      status: true,
    },
  },
  site: { select: { id: true, name: true, code: true, timezone: true, parkingMode: true } },
  financier: { select: { id: true, displayName: true } },
  zone: { select: { id: true, name: true, code: true } },
  space: { select: { id: true, code: true } },
} satisfies Prisma.ParkingSessionInclude;

type SessionRow = Prisma.ParkingSessionGetPayload<{ include: typeof sessionInclude }>;

export interface SessionListItem {
  id: string;
  sessionNumber: string;
  status: string;
  parkingMode: string;
  entryAt: string;
  exitAt: string | null;
  ageingDays: number;
  rateUnresolved: boolean;
  vehicleId: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  vehicleClass: string;
  vehicleStatus: string;
  siteId: string;
  siteName: string;
  financierId: string | null;
  financierName: string | null;
  zoneName: string | null;
  spaceCode: string | null;
}

export interface SessionDetail extends SessionListItem {
  contractCode: string | null;
  contractTitle: string | null;
  ratePlanCode: string | null;
  ratePlanName: string | null;
  billingUnit: string | null;
  admissionMethod: string;
  holdReason: string | null;
  closureReason: string | null;
  currentCharge: {
    subtotal: string;
    taxTotal: string;
    total: string;
    currency: string;
    chargeableUnits: string;
    explanation: string[];
  } | null;
  chargeUnavailableReason: string | null;
  allocations: Array<{
    zoneName: string;
    spaceCode: string | null;
    allocatedAt: string;
    releasedAt: string | null;
    reason: string | null;
  }>;
}

function toListItem(row: SessionRow): SessionListItem {
  return {
    id: row.id,
    sessionNumber: row.sessionNumber,
    status: row.status,
    parkingMode: row.parkingMode,
    entryAt: row.entryAt.toISOString(),
    exitAt: row.exitAt?.toISOString() ?? null,
    ageingDays: ageingDays(row.entryAt, row.exitAt ?? new Date()),
    rateUnresolved: row.rateUnresolved,
    vehicleId: row.vehicleId,
    registrationNumber: row.vehicle.registrationNumber,
    make: row.vehicle.make,
    model: row.vehicle.model,
    vehicleClass: row.vehicle.vehicleClass,
    vehicleStatus: row.vehicle.status,
    siteId: row.siteId,
    siteName: row.site.name,
    financierId: row.financierId,
    financierName: row.financier?.displayName ?? null,
    zoneName: row.zone?.name ?? null,
    spaceCode: row.space?.code ?? null,
  };
}
