import { Injectable } from '@nestjs/common';
import {
  ActorType,
  AdmissionMethod,
  AnprEvent,
  AnprEventStatus,
  ParkingMode,
  ParkingSessionStatus,
  ParkingSpaceStatus,
  Prisma,
  ReleaseRequestStatus,
  Site,
  TravelDirection,
  VehicleClass,
  VehicleStatus,
} from '@prisma/client';

import { ErrorCode, TimelineEventType } from '@smartpark/contracts';
import { AppException } from '@/common/errors/app-exception';
import { RequestContextStore } from '@/common/context/request-context';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { generateSessionNumber } from '@/common/util/ids';
import { PrismaService, PrismaTransaction } from '@/infrastructure/prisma/prisma.service';
import { DomainEventType, OutboxService } from '@/infrastructure/outbox';
import { JobName, QueueService } from '@/infrastructure/queue/queue.service';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { RateResolutionService } from '@/modules/contract/rate-resolution.service';
import { VehicleService } from '@/modules/vehicle/vehicle.service';

/** What the gate decided, and why. Rendered directly on the gate screen. */
export interface GateDecision {
  outcome:
    | 'ADMITTED'
    | 'EXIT_AUTHORISED'
    | 'EXIT_PENDING_SETTLEMENT'
    | 'EXIT_BLOCKED'
    | 'ALREADY_ON_SITE'
    | 'NOT_ON_SITE'
    | 'REVIEW_REQUIRED';
  vehicleId: string | null;
  sessionId: string | null;
  registrationNumber: string;
  /** Operator-facing sentence. Never a stack trace or an error code. */
  message: string;
  /** Anything the operator must act on before the barrier opens. */
  blockers: string[];
  /** Ordered account of what the system did. Shown in the gate log. */
  trace: string[];
  rateResolved: boolean;
  financierName: string | null;
  contractCode: string | null;
}

/**
 * The gate.
 *
 * This is the workflow in requirement S9, and its governing constraint is that
 * a vehicle must never be left waiting at a barrier for an external system.
 * Everything on the synchronous path is local database work - resolve the
 * vehicle, resolve the contract and rate, allocate a space, open the session -
 * which is fast and predictable. The only external dependency, the vehicle
 * registry, is queued and enriches the record afterwards.
 *
 * The consequences of that choice are handled explicitly rather than ignored:
 *   - A vehicle can be admitted before its financier is known. The session is
 *     opened with `rateUnresolved` and appears in a finance work queue.
 *   - Enrichment arriving later updates the vehicle but never re-prices a stay,
 *     because the rate plan was snapshotted at admission.
 *
 * Exit is deliberately asymmetric between the two business lines:
 *   - REPOSSESSION_YARD: an ANPR exit capture does NOT release a vehicle. These
 *     are repossessed assets; they leave only against an approved release. An
 *     unauthorised exit capture is recorded and raised as an alert.
 *   - PUBLIC_PARKING: exit computes the charge and settles at the barrier.
 */
@Injectable()
export class GateService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehicleService,
    private readonly rates: RateResolutionService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Gate');
  }

  /**
   * Handles a resolved capture.
   *
   * Runs in one transaction: the vehicle, the session, the allocation, the
   * timeline events and the outbox messages all commit together, or none do.
   * Requirement S55 - a vehicle can never be created without its session.
   */
  async processCapture(input: {
    anprEvent: AnprEvent;
    site: Site;
    direction: TravelDirection;
    plateNumber: string;
    vehicleClassHint?: VehicleClass | null;
    admissionMethod: AdmissionMethod;
    actorId?: string | null;
    actorType?: ActorType;
  }): Promise<GateDecision> {
    const trace: string[] = [
      `Capture at ${input.site.name} (${input.site.code}), direction ${input.direction}.`,
    ];

    const decision = await this.prisma.transaction(
      async (tx) =>
        input.direction === TravelDirection.EXIT
          ? this.handleExit(tx, input, trace)
          : this.handleEntry(tx, input, trace),
      { timeoutMs: 20_000 },
    );

    // Queued AFTER the transaction commits, so enrichment can never run
    // against a vehicle whose creation was rolled back.
    if (decision.outcome === 'ADMITTED' && decision.vehicleId) {
      await this.queue.enqueue(
        JobName.REGISTRY_ENRICHMENT,
        {
          vehicleId: decision.vehicleId,
          organizationId: input.site.organizationId,
          normalizedRegistrationNumber: decision.registrationNumber,
          triggeredBy: 'ANPR_ADMISSION',
        },
        // One enrichment per vehicle per minute, however many frames fire.
        { jobId: `registry:${decision.vehicleId}:${Math.floor(Date.now() / 60_000)}` },
      );
    }

    return decision;
  }

  /* ---------------------------------------------------------------- */
  /* Entry                                                             */
  /* ---------------------------------------------------------------- */

  private async handleEntry(
    tx: PrismaTransaction,
    input: {
      anprEvent: AnprEvent;
      site: Site;
      plateNumber: string;
      vehicleClassHint?: VehicleClass | null;
      admissionMethod: AdmissionMethod;
      actorId?: string | null;
      actorType?: ActorType;
    },
    trace: string[],
  ): Promise<GateDecision> {
    const { vehicle, created } = await this.vehicles.resolveOrCreate(tx, {
      organizationId: input.site.organizationId,
      registrationNumber: input.plateNumber,
      vehicleClassHint: input.vehicleClassHint ?? null,
      siteId: input.site.id,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? ActorType.SYSTEM,
    });

    trace.push(
      created
        ? `New vehicle record created for ${vehicle.normalizedRegistrationNumber}.`
        : `Matched existing vehicle ${vehicle.normalizedRegistrationNumber} ` +
          `(seen ${vehicle.totalVisits} time(s) before).`,
    );

    /* --- Already inside? ------------------------------------------ */
    // The partial unique index guarantees at most one live session, but
    // checking here produces a helpful operator message rather than a
    // constraint violation.
    const activeSession = await tx.parkingSession.findFirst({
      where: {
        vehicleId: vehicle.id,
        status: {
          in: [ParkingSessionStatus.OPEN, ParkingSessionStatus.ON_HOLD, ParkingSessionStatus.PENDING_EXIT],
        },
      },
      include: { site: { select: { name: true, code: true } } },
    });

    if (activeSession) {
      const sameSite = activeSession.siteId === input.site.id;
      trace.push(
        `Vehicle already has an open stay (${activeSession.sessionNumber}) at ` +
          `${activeSession.site.name}.`,
      );
      return {
        outcome: 'ALREADY_ON_SITE',
        vehicleId: vehicle.id,
        sessionId: activeSession.id,
        registrationNumber: vehicle.normalizedRegistrationNumber,
        message: sameSite
          ? `This vehicle is already inside on stay ${activeSession.sessionNumber}. ` +
            'It was probably captured twice - no action needed.'
          : `This vehicle is recorded as inside ${activeSession.site.name}. ` +
            'Close that stay before admitting it here.',
        blockers: sameSite ? [] : [`Open stay at ${activeSession.site.name}.`],
        trace,
        rateResolved: !activeSession.rateUnresolved,
        financierName: null,
        contractCode: null,
      };
    }

    /* --- Rate resolution ------------------------------------------ */
    const entryAt = input.anprEvent.capturedAt;
    const resolution = await this.rates.resolve(tx, {
      organizationId: input.site.organizationId,
      siteId: input.site.id,
      parkingMode: input.site.parkingMode,
      financierId: vehicle.currentFinancierId,
      vehicleClass: vehicle.vehicleClass,
      effectiveAt: entryAt,
    });
    trace.push(...resolution.trace);

    /* --- Space allocation ----------------------------------------- */
    const allocation = await this.allocateSpace(tx, input.site.id, vehicle.vehicleClass);
    if (allocation.zoneId) {
      trace.push(
        `Allocated ${allocation.zoneName}${allocation.spaceCode ? ` / ${allocation.spaceCode}` : ''}.`,
      );
    } else {
      // Deliberately not a blocker. Refusing entry because the allocator could
      // not pick a bay would strand a vehicle at the barrier; a supervisor can
      // place it and record the zone afterwards.
      trace.push(`No space could be allocated automatically: ${allocation.reason}`);
    }

    /* --- Open the session ------------------------------------------ */
    const session = await tx.parkingSession.create({
      data: {
        organizationId: input.site.organizationId,
        siteId: input.site.id,
        vehicleId: vehicle.id,
        sessionNumber: generateSessionNumber(entryAt),
        parkingMode: input.site.parkingMode,
        status: ParkingSessionStatus.OPEN,
        entryAt,
        entryGateId: input.anprEvent.gateId,
        entryLaneId: input.anprEvent.laneId,
        entryAnprEventId: input.anprEvent.id,
        financierId: vehicle.currentFinancierId,
        contractVersionId: resolution.contractVersionId,
        ratePlanId: resolution.ratePlan?.id ?? null,
        ratePlanSnapshot: (resolution.snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
        rateUnresolved: !resolution.resolved,
        zoneId: allocation.zoneId,
        spaceId: allocation.spaceId,
        admissionMethod: input.admissionMethod,
        admittedById: input.actorId ?? null,
        correlationId: RequestContextStore.correlationId(),
      },
      include: {
        financier: { select: { displayName: true } },
        contractVersion: { include: { contract: { select: { code: true } } } },
      },
    });

    if (allocation.zoneId) {
      await tx.parkingAllocation.create({
        data: {
          sessionId: session.id,
          zoneId: allocation.zoneId,
          spaceId: allocation.spaceId,
          allocatedById: input.actorId ?? null,
          reason: 'Automatic allocation at admission.',
        },
      });
      if (allocation.spaceId) {
        await tx.parkingSpace.update({
          where: { id: allocation.spaceId },
          data: { status: ParkingSpaceStatus.OCCUPIED },
        });
      }
    }

    /* --- Advance the vehicle lifecycle ----------------------------- */
    // The path depends on how much is already known: a vehicle whose financier
    // is matched goes straight through, one that is not still gets admitted.
    await this.advanceToParked(tx, vehicle.id, vehicle.status, {
      sessionId: session.id,
      siteId: input.site.id,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? ActorType.SYSTEM,
    });

    await tx.vehicle.update({
      where: { id: vehicle.id },
      data: { currentSessionId: session.id, currentSiteId: input.site.id, totalVisits: { increment: 1 } },
    });

    await tx.anprEvent.update({
      where: { id: input.anprEvent.id },
      data: {
        status: AnprEventStatus.PROCESSED,
        vehicleId: vehicle.id,
        parkingSessionId: session.id,
        processedAt: new Date(),
      },
    });

    await tx.vehicleTimelineEvent.createMany({
      data: [
        {
          organizationId: input.site.organizationId,
          vehicleId: vehicle.id,
          sessionId: session.id,
          siteId: input.site.id,
          type: TimelineEventType.SESSION_OPENED,
          occurredAt: entryAt,
          actorId: input.actorId ?? null,
          actorType: input.actorType ?? ActorType.SYSTEM,
          title: `Entered ${input.site.name}`,
          description: `Stay ${session.sessionNumber} opened via ${input.admissionMethod}.`,
          payload: {
            sessionNumber: session.sessionNumber,
            rateResolved: resolution.resolved,
            ratePlanCode: resolution.ratePlan?.code ?? null,
          },
          correlationId: RequestContextStore.correlationId(),
        },
        ...(allocation.zoneId
          ? [
              {
                organizationId: input.site.organizationId,
                vehicleId: vehicle.id,
                sessionId: session.id,
                siteId: input.site.id,
                type: TimelineEventType.SPACE_ALLOCATED,
                occurredAt: new Date(),
                actorType: ActorType.SYSTEM,
                title: `Allocated ${allocation.zoneName}${allocation.spaceCode ? ` / ${allocation.spaceCode}` : ''}`,
                correlationId: RequestContextStore.correlationId(),
              },
            ]
          : []),
      ],
    });

    await this.outbox.record(tx, {
      eventType: DomainEventType.SESSION_OPENED,
      aggregateType: 'ParkingSession',
      aggregateId: session.id,
      payload: {
        sessionId: session.id,
        organizationId: input.site.organizationId,
        siteId: input.site.id,
        vehicleId: vehicle.id,
        financierId: vehicle.currentFinancierId,
        ratePlanId: resolution.ratePlan?.id ?? null,
        parkingMode: input.site.parkingMode,
        entryAt: entryAt.toISOString(),
      },
    });

    if (!resolution.resolved) {
      await this.outbox.record(tx, {
        eventType: DomainEventType.SESSION_RATE_UNRESOLVED,
        aggregateType: 'ParkingSession',
        aggregateId: session.id,
        payload: {
          sessionId: session.id,
          organizationId: input.site.organizationId,
          siteId: input.site.id,
          vehicleId: vehicle.id,
          reason: resolution.unresolvedReason ?? 'unknown',
        },
      });
    }

    await this.audit.record(tx, {
      action: AuditAction.SESSION_OPENED,
      entityType: 'ParkingSession',
      entityId: session.id,
      organizationId: input.site.organizationId,
      siteId: input.site.id,
      afterState: {
        sessionNumber: session.sessionNumber,
        vehicleId: vehicle.id,
        entryAt: entryAt.toISOString(),
        ratePlanId: resolution.ratePlan?.id ?? null,
        rateUnresolved: !resolution.resolved,
        admissionMethod: input.admissionMethod,
      },
    });

    const blockers = resolution.resolved
      ? []
      : ['No rate plan applies yet, so charges will not accrue until finance attaches one.'];

    return {
      outcome: 'ADMITTED',
      vehicleId: vehicle.id,
      sessionId: session.id,
      registrationNumber: vehicle.normalizedRegistrationNumber,
      message: `Admitted on stay ${session.sessionNumber}.`,
      blockers,
      trace,
      rateResolved: resolution.resolved,
      financierName: session.financier?.displayName ?? null,
      contractCode: session.contractVersion?.contract.code ?? null,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Exit                                                              */
  /* ---------------------------------------------------------------- */

  private async handleExit(
    tx: PrismaTransaction,
    input: {
      anprEvent: AnprEvent;
      site: Site;
      plateNumber: string;
      actorId?: string | null;
      actorType?: ActorType;
    },
    trace: string[],
  ): Promise<GateDecision> {
    const { vehicle } = await this.vehicles.resolveOrCreate(tx, {
      organizationId: input.site.organizationId,
      registrationNumber: input.plateNumber,
      actorId: input.actorId ?? null,
    });

    const session = await tx.parkingSession.findFirst({
      where: {
        vehicleId: vehicle.id,
        siteId: input.site.id,
        status: {
          in: [ParkingSessionStatus.OPEN, ParkingSessionStatus.ON_HOLD, ParkingSessionStatus.PENDING_EXIT],
        },
      },
    });

    if (!session) {
      trace.push('No open stay at this site for the captured vehicle.');
      await tx.anprEvent.update({
        where: { id: input.anprEvent.id },
        data: {
          status: AnprEventStatus.PROCESSED,
          vehicleId: vehicle.id,
          processedAt: new Date(),
          processingError: 'Exit captured but the vehicle has no open stay here.',
        },
      });
      return {
        outcome: 'NOT_ON_SITE',
        vehicleId: vehicle.id,
        sessionId: null,
        registrationNumber: vehicle.normalizedRegistrationNumber,
        message: 'This vehicle has no open stay at this site. Do not open the barrier.',
        blockers: ['No open stay found.'],
        trace,
        rateResolved: false,
        financierName: null,
        contractCode: null,
      };
    }

    /* --- Repossession yard: release authority required ------------- */
    if (session.parkingMode === ParkingMode.REPOSSESSION_YARD) {
      const approvedRelease = await tx.releaseRequest.findFirst({
        where: { sessionId: session.id, status: ReleaseRequestStatus.APPROVED },
      });

      if (!approvedRelease) {
        // A repossessed asset leaving without authorisation is a serious event,
        // so it is recorded, audited and surfaced - not silently ignored.
        trace.push('No approved release exists for this stay. Exit refused.');

        await tx.anprEvent.update({
          where: { id: input.anprEvent.id },
          data: {
            status: AnprEventStatus.PROCESSED,
            vehicleId: vehicle.id,
            parkingSessionId: session.id,
            processedAt: new Date(),
            processingError: 'Unauthorised exit attempt: no approved release.',
          },
        });

        await tx.vehicleTimelineEvent.create({
          data: {
            organizationId: input.site.organizationId,
            vehicleId: vehicle.id,
            sessionId: session.id,
            siteId: input.site.id,
            type: TimelineEventType.ANPR_CAPTURED,
            occurredAt: input.anprEvent.capturedAt,
            actorType: ActorType.SYSTEM,
            title: 'Unauthorised exit attempt',
            description:
              'The vehicle was captured at an exit lane with no approved release request.',
            correlationId: RequestContextStore.correlationId(),
          },
        });

        await this.audit.record(tx, {
          action: AuditAction.SESSION_CLOSED,
          entityType: 'ParkingSession',
          entityId: session.id,
          organizationId: input.site.organizationId,
          siteId: input.site.id,
          outcome: 'FAILURE',
          errorCode: ErrorCode.RELEASE_NOT_APPROVED,
          reason: 'Exit captured without an approved release request.',
        });

        return {
          outcome: 'EXIT_BLOCKED',
          vehicleId: vehicle.id,
          sessionId: session.id,
          registrationNumber: vehicle.normalizedRegistrationNumber,
          message:
            'DO NOT RELEASE. This vehicle has no approved release request. ' +
            'Escalate to the yard supervisor.',
          blockers: ['No approved release request for this stay.'],
          trace,
          rateResolved: !session.rateUnresolved,
          financierName: null,
          contractCode: null,
        };
      }

      trace.push(`Approved release ${approvedRelease.requestNumber} found.`);

      // Authorisation confirmed. The actual close is performed by
      // ReleaseService.completeRelease, which owns the invoice and settlement
      // side; the gate only reports that the barrier may open.
      await tx.anprEvent.update({
        where: { id: input.anprEvent.id },
        data: {
          status: AnprEventStatus.PROCESSED,
          vehicleId: vehicle.id,
          parkingSessionId: session.id,
          processedAt: new Date(),
        },
      });

      return {
        outcome: 'EXIT_AUTHORISED',
        vehicleId: vehicle.id,
        sessionId: session.id,
        registrationNumber: vehicle.normalizedRegistrationNumber,
        message: `Release ${approvedRelease.requestNumber} is approved. Open the barrier and confirm the exit.`,
        blockers: [],
        trace,
        rateResolved: !session.rateUnresolved,
        financierName: null,
        contractCode: null,
      };
    }

    /* --- Public parking: settle at the barrier (Phase 2) ------------ */
    trace.push('Public parking exit: charge must be settled before the barrier opens.');

    await tx.parkingSession.update({
      where: { id: session.id },
      data: {
        status: ParkingSessionStatus.PENDING_EXIT,
        exitGateId: input.anprEvent.gateId,
        exitLaneId: input.anprEvent.laneId,
        exitAnprEventId: input.anprEvent.id,
        version: { increment: 1 },
      },
    });

    await tx.anprEvent.update({
      where: { id: input.anprEvent.id },
      data: {
        status: AnprEventStatus.PROCESSED,
        vehicleId: vehicle.id,
        parkingSessionId: session.id,
        processedAt: new Date(),
      },
    });

    return {
      outcome: 'EXIT_PENDING_SETTLEMENT',
      vehicleId: vehicle.id,
      sessionId: session.id,
      registrationNumber: vehicle.normalizedRegistrationNumber,
      message: 'Parking charge is due. Collect payment, then confirm the exit.',
      blockers: ['Parking charge not yet settled.'],
      trace,
      rateResolved: !session.rateUnresolved,
      financierName: null,
      contractCode: null,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Walks the vehicle from wherever it is to PARKED.
   *
   * The route varies: a brand-new vehicle goes CAPTURED to IDENTIFIED to
   * YARD_ADMITTED to PARKED, while a returning vehicle already carrying its
   * financier goes FINANCIER_MATCHED to YARD_ADMITTED to PARKED. Each hop is
   * validated by the state machine, so no path can skip a state.
   */
  private async advanceToParked(
    tx: PrismaTransaction,
    vehicleId: string,
    from: VehicleStatus,
    context: {
      sessionId: string;
      siteId: string;
      actorId: string | null;
      actorType: ActorType;
    },
  ): Promise<void> {
    const path = entryPathTo(from);
    for (const step of path) {
      await this.vehicles.transition(tx, vehicleId, step, {
        reason: 'Gate admission.',
        sessionId: context.sessionId,
        siteId: context.siteId,
        actorId: context.actorId,
        actorType: context.actorType,
        tolerateNoop: true,
      });
    }
  }

  /**
   * Picks a zone and, where the site models individual bays, a specific space.
   *
   * `FOR UPDATE SKIP LOCKED` on the space is what makes concurrent admissions
   * safe: two gates allocating at once take different bays instead of
   * deadlocking or double-booking one.
   */
  private async allocateSpace(
    tx: PrismaTransaction,
    siteId: string,
    vehicleClass: VehicleClass,
  ): Promise<{
    zoneId: string | null;
    zoneName: string | null;
    spaceId: string | null;
    spaceCode: string | null;
    reason: string;
  }> {
    const zones = await tx.parkingZone.findMany({
      where: { siteId, isActive: true },
      include: { _count: { select: { sessions: { where: { status: { in: ['OPEN', 'ON_HOLD', 'PENDING_EXIT'] } } } } } },
      orderBy: { code: 'asc' },
    });

    // A zone with an empty allow-list accepts anything. An UNKNOWN class also
    // matches every zone: the registry has not told us what the vehicle is yet,
    // and refusing to place it would strand a real vehicle at the barrier over
    // a data gap. The operator can move it once the class is known.
    const accepts = (zone: { allowedClasses: VehicleClass[] }): boolean =>
      zone.allowedClasses.length === 0 ||
      vehicleClass === VehicleClass.UNKNOWN ||
      zone.allowedClasses.includes(vehicleClass);

    const accepting = zones.filter(accepts);
    const eligible = accepting.filter((zone) => zone._count.sessions < zone.capacity);

    if (eligible.length === 0) {
      // Distinguishing these matters: "no zone takes this class" is a
      // configuration problem, "all full" is an operational one.
      let reason: string;
      if (zones.length === 0) {
        reason = 'This site has no parking zones configured.';
      } else if (accepting.length === 0) {
        reason = `No zone at this site accepts a ${vehicleClass} vehicle.`;
      } else {
        reason = 'Every zone that accepts this vehicle class is at capacity.';
      }
      return { zoneId: null, zoneName: null, spaceId: null, spaceCode: null, reason };
    }

    // Fill the emptiest eligible zone, which keeps the yard balanced.
    const zone = eligible.reduce((best, candidate) =>
      candidate._count.sessions / candidate.capacity < best._count.sessions / best.capacity
        ? candidate
        : best,
    );

    const spaces = await tx.$queryRaw<Array<{ id: string; code: string }>>`
      SELECT "id", "code" FROM "parking_spaces"
      WHERE "zoneId" = ${zone.id}::uuid AND "status" = 'AVAILABLE'
      ORDER BY "code" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const space = spaces[0];
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      spaceId: space?.id ?? null,
      spaceCode: space?.code ?? null,
      // A zone with capacity but no individually modelled bays is normal for a
      // yard; the zone allocation alone is enough.
      reason: space ? 'Allocated.' : 'Zone allocated; no individual bay is modelled or free.',
    };
  }
}

/**
 * The lifecycle hops needed to reach PARKED from a given state.
 *
 * Kept as an explicit table rather than a search, so the admission path is
 * reviewable and cannot silently change when the transition graph is edited.
 */
function entryPathTo(from: VehicleStatus): VehicleStatus[] {
  switch (from) {
    case VehicleStatus.CAPTURED:
      return [VehicleStatus.IDENTIFIED, VehicleStatus.YARD_ADMITTED, VehicleStatus.PARKED];
    case VehicleStatus.IDENTIFIED:
    case VehicleStatus.VAHAN_PENDING:
    case VehicleStatus.VAHAN_VERIFIED:
    case VehicleStatus.VAHAN_FAILED:
    case VehicleStatus.FINANCIER_MATCHED:
      return [VehicleStatus.YARD_ADMITTED, VehicleStatus.PARKED];
    case VehicleStatus.YARD_ADMITTED:
      return [VehicleStatus.PARKED];
    case VehicleStatus.EXITED:
      // A returning vehicle starts a fresh visit on the SAME canonical record.
      return [
        VehicleStatus.CAPTURED,
        VehicleStatus.IDENTIFIED,
        VehicleStatus.YARD_ADMITTED,
        VehicleStatus.PARKED,
      ];
    case VehicleStatus.PARKED:
      return [];
    default:
      throw new AppException(
        ErrorCode.INVALID_VEHICLE_STATE_TRANSITION,
        `A vehicle in state ${from} cannot be admitted through a gate.`,
        { details: { currentStatus: from } },
      );
  }
}
