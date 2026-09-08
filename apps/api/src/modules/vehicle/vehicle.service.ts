import { Injectable } from '@nestjs/common';
import { ActorType, Prisma, VehicleClass, VehicleStatus } from '@prisma/client';

import {
  ErrorCode,
  Paginated,
  TimelineEventType,
  analyzeRegistrationNumber,
  maskRegistrationNumber,
  normalizeRegistrationNumber,
} from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import { RequestContextStore } from '@/common/context/request-context';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { maskName } from '@/common/logging/redact';
import { PrismaExecutor, PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainEventType, OutboxService } from '@/infrastructure/outbox';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { AccessScope } from '@/modules/identity/guards';
import { VehicleStateMachine } from '@/modules/shared/state-machine';

export interface ResolveVehicleInput {
  organizationId: string;
  registrationNumber: string;
  vehicleClassHint?: VehicleClass | null;
  siteId?: string | null;
  actorType?: ActorType;
  actorId?: string | null;
}

export interface VehicleListFilters {
  search?: string;
  status?: VehicleStatus[];
  siteId?: string;
  financierId?: string;
  vehicleClass?: VehicleClass;
  onSiteOnly?: boolean;
  unmatchedFinancier?: boolean;
}

const SORTABLE = ['lastSeenAt', 'firstSeenAt', 'createdAt', 'registrationNumber', 'status'] as const;

/**
 * The central vehicle repository.
 *
 * Requirement S7/S24: exactly ONE canonical record per registration number per
 * organisation. Every capture at every Sri JP location - yard or public car
 * park - resolves to it. That single-record rule is what makes the financier
 * intelligence service possible; duplicating vehicle rows per site would make
 * "has my financed vehicle been seen anywhere?" unanswerable.
 */
@Injectable()
export class VehicleService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Vehicle');
  }

  /**
   * Finds or creates the canonical vehicle for a plate.
   *
   * Concurrency: two gates can capture the same vehicle in the same second.
   * Rather than check-then-insert (which races), this attempts the insert and
   * treats a unique-violation as "someone else won" - the database is the
   * arbiter, not application timing.
   *
   * MUST be called inside the caller's transaction so vehicle creation and the
   * session that follows commit together.
   */
  async resolveOrCreate(
    tx: PrismaExecutor,
    input: ResolveVehicleInput,
  ): Promise<{ vehicle: Prisma.VehicleGetPayload<object>; created: boolean }> {
    const analysis = analyzeRegistrationNumber(input.registrationNumber);
    if (!analysis.valid) {
      throw new AppException(
        ErrorCode.INVALID_REGISTRATION_NUMBER,
        `"${input.registrationNumber}" is not a usable registration number: ${analysis.reason}`,
        { details: { supplied: input.registrationNumber, reason: analysis.reason } },
      );
    }

    const normalized = analysis.normalized;
    const now = new Date();

    const existing = await tx.vehicle.findUnique({
      where: {
        organizationId_normalizedRegistrationNumber: {
          organizationId: input.organizationId,
          normalizedRegistrationNumber: normalized,
        },
      },
    });

    if (existing) {
      const updated = await tx.vehicle.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: now,
          ...(input.siteId ? { currentSiteId: input.siteId } : {}),
          // Only fill a class we do not already know; an ANPR hint must never
          // overwrite a class the registry confirmed.
          ...(existing.vehicleClass === VehicleClass.UNKNOWN && input.vehicleClassHint
            ? { vehicleClass: input.vehicleClassHint }
            : {}),
        },
      });
      return { vehicle: updated, created: false };
    }

    try {
      const created = await tx.vehicle.create({
        data: {
          organizationId: input.organizationId,
          registrationNumber: input.registrationNumber.trim().toUpperCase().slice(0, 32),
          normalizedRegistrationNumber: normalized,
          registrationFormat: analysis.format,
          vehicleClass: input.vehicleClassHint ?? VehicleClass.UNKNOWN,
          status: VehicleStatus.CAPTURED,
          currentSiteId: input.siteId ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: input.organizationId,
          vehicleId: created.id,
          siteId: input.siteId ?? null,
          type: TimelineEventType.VEHICLE_CREATED,
          occurredAt: now,
          actorId: input.actorId ?? null,
          actorType: input.actorType ?? ActorType.SYSTEM,
          title: 'Vehicle first seen',
          description: `First capture at a Sri JP location as ${analysis.normalized}.`,
          payload: { registrationFormat: analysis.format },
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.outbox.record(tx, {
        eventType: DomainEventType.VEHICLE_CREATED,
        aggregateType: 'Vehicle',
        aggregateId: created.id,
        payload: {
          vehicleId: created.id,
          organizationId: input.organizationId,
          normalizedRegistrationNumber: normalized,
        },
      });

      return { vehicle: created, created: true };
    } catch (error) {
      // A concurrent capture won the race; re-read its row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await tx.vehicle.findUnique({
          where: {
            organizationId_normalizedRegistrationNumber: {
              organizationId: input.organizationId,
              normalizedRegistrationNumber: normalized,
            },
          },
        });
        if (winner) {
          this.logger.debug('Concurrent vehicle creation resolved to the existing record', {
            normalizedPlate: maskRegistrationNumber(normalized),
          });
          return { vehicle: winner, created: false };
        }
      }
      throw error;
    }
  }

  /**
   * Advances the vehicle lifecycle.
   *
   * The ONLY route by which `vehicles.status` changes. The transition is
   * validated, the previous value is checked optimistically, and an immutable
   * timeline event is written - all in the caller's transaction.
   *
   * @throws AppException INVALID_VEHICLE_STATE_TRANSITION, CONCURRENT_MODIFICATION
   */
  async transition(
    tx: PrismaExecutor,
    vehicleId: string,
    to: VehicleStatus,
    context: {
      reason: string;
      sessionId?: string | null;
      siteId?: string | null;
      actorId?: string | null;
      actorType?: ActorType;
      /** Skips the write when already in the target state. */
      tolerateNoop?: boolean;
    },
  ): Promise<Prisma.VehicleGetPayload<object>> {
    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw notFound('Vehicle', vehicleId);

    if (vehicle.status === to && context.tolerateNoop) return vehicle;

    VehicleStateMachine.assert(vehicle.status, to);

    const result = await tx.vehicle.updateMany({
      where: { id: vehicleId, version: vehicle.version },
      data: { status: to, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new AppException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'The vehicle was changed by another operation. Reload and try again.',
        { details: { vehicleId } },
      );
    }

    await tx.vehicleTimelineEvent.create({
      data: {
        organizationId: vehicle.organizationId,
        vehicleId,
        sessionId: context.sessionId ?? null,
        siteId: context.siteId ?? vehicle.currentSiteId,
        type: TimelineEventType.VEHICLE_STATUS_CHANGED,
        occurredAt: new Date(),
        actorId: context.actorId ?? null,
        actorType: context.actorType ?? ActorType.SYSTEM,
        title: `Status: ${vehicle.status} to ${to}`,
        description: context.reason.slice(0, 1000),
        payload: { from: vehicle.status, to },
        correlationId: RequestContextStore.correlationId(),
      },
    });

    await this.outbox.record(tx, {
      eventType: DomainEventType.VEHICLE_STATUS_CHANGED,
      aggregateType: 'Vehicle',
      aggregateId: vehicleId,
      payload: {
        vehicleId,
        organizationId: vehicle.organizationId,
        from: vehicle.status,
        to,
        reason: context.reason,
      },
    });

    await this.audit.record(tx, {
      action: AuditAction.VEHICLE_STATUS_CHANGED,
      entityType: 'Vehicle',
      entityId: vehicleId,
      organizationId: vehicle.organizationId,
      siteId: context.siteId ?? vehicle.currentSiteId,
      beforeState: { status: vehicle.status },
      afterState: { status: to },
      reason: context.reason,
    });

    return { ...vehicle, status: to, version: vehicle.version + 1 };
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
    filters: VehicleListFilters,
  ): Promise<Paginated<VehicleListItem>> {
    const where = this.buildWhere(actor, filters);

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        include: vehicleListInclude,
        orderBy: query.orderBy(SORTABLE, 'lastSeenAt'),
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    const canSeePii = AccessScope.canSeePii(actor);
    return paginate(rows.map((row) => toListItem(row, canSeePii)), totalItems, query);
  }

  async findById(actor: AuthenticatedUser, vehicleId: string): Promise<VehicleDetail> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        organizationId: actor.organizationId,
        // A financier user can only open their own financier's vehicles. This
        // is a WHERE clause, not a post-load check: an out-of-scope vehicle
        // reads as "not found", which also avoids confirming it exists.
        ...(actor.financierId ? { currentFinancierId: actor.financierId } : {}),
      },
      include: {
        currentFinancier: { select: { id: true, displayName: true, code: true } },
        currentSite: { select: { id: true, name: true, code: true, siteType: true } },
        ownershipRecords: { where: { isCurrent: true }, take: 1 },
        sessions: {
          orderBy: { entryAt: 'desc' },
          take: 1,
          include: {
            site: { select: { id: true, name: true, code: true } },
            zone: { select: { id: true, name: true, code: true } },
            space: { select: { id: true, code: true } },
          },
        },
      },
    });

    if (!vehicle) throw notFound('Vehicle', vehicleId);

    const canSeePii = AccessScope.canSeePii(actor);
    const ownership = vehicle.ownershipRecords[0];
    const activeSession = vehicle.sessions[0];

    return {
      ...toListItem(vehicle, canSeePii),
      variant: vehicle.variant,
      color: vehicle.color,
      fuelType: vehicle.fuelType,
      manufacturingYear: vehicle.manufacturingYear,
      chassisNumberLast4: canSeePii ? vehicle.chassisNumberLast4 : null,
      engineNumberLast4: canSeePii ? vehicle.engineNumberLast4 : null,
      registeredOwnerAddress: canSeePii ? vehicle.registeredOwnerAddress : null,
      hypothecationStatus: vehicle.hypothecationStatus,
      vahanVerifiedAt: vehicle.vahanVerifiedAt?.toISOString() ?? null,
      financierMatchMethod: vehicle.financierMatchMethod,
      financierMatchConfidence: vehicle.financierMatchConfidence?.toFixed(4) ?? null,
      ownershipSource: ownership?.source ?? null,
      ownershipRetrievedAt: ownership?.retrievedAt.toISOString() ?? null,
      /** True when the current ownership data came from the simulator. */
      ownershipIsSimulated: ownership?.source === 'MOCK',
      activeSession: activeSession
        ? {
            id: activeSession.id,
            sessionNumber: activeSession.sessionNumber,
            status: activeSession.status,
            entryAt: activeSession.entryAt.toISOString(),
            exitAt: activeSession.exitAt?.toISOString() ?? null,
            siteName: activeSession.site.name,
            zoneName: activeSession.zone?.name ?? null,
            spaceCode: activeSession.space?.code ?? null,
            rateUnresolved: activeSession.rateUnresolved,
          }
        : null,
      totalVisits: vehicle.totalVisits,
      notes: vehicle.notes,
    };
  }

  /**
   * The immutable vehicle timeline (requirement S25).
   *
   * Reconstructed from persisted events, never from current-state columns, so
   * history survives a later status change.
   */
  async timeline(
    actor: AuthenticatedUser,
    vehicleId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<TimelineItem>> {
    // Re-checks scope; throws NOT_FOUND for an out-of-scope vehicle.
    await this.findById(actor, vehicleId);

    const where: Prisma.VehicleTimelineEventWhereInput = { vehicleId };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.vehicleTimelineEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: { site: { select: { name: true, code: true } } },
      }),
      this.prisma.vehicleTimelineEvent.count({ where }),
    ]);

    return paginate(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        occurredAt: row.occurredAt.toISOString(),
        title: row.title,
        description: row.description,
        siteName: row.site?.name ?? null,
        actorType: row.actorType,
        actorLabel: row.actorLabel,
        payload: (row.payload ?? null) as Record<string, unknown> | null,
        correlationId: row.correlationId,
      })),
      totalItems,
      query,
    );
  }

  /**
   * Global search entry point (requirement S31).
   *
   * Normalises the term before matching, so `TN 01 AB 1234`, `TN-01-AB-1234`
   * and `tn01ab1234` all find the same vehicle.
   */
  async search(
    actor: AuthenticatedUser,
    term: string,
    limit = 10,
  ): Promise<VehicleListItem[]> {
    const trimmed = term.trim();
    if (trimmed.length < 2) return [];

    const normalized = normalizeRegistrationNumber(trimmed);
    const canSeePii = AccessScope.canSeePii(actor);

    const rows = await this.prisma.vehicle.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(actor.financierId ? { currentFinancierId: actor.financierId } : {}),
        OR: [
          ...(normalized.length >= 2
            ? [{ normalizedRegistrationNumber: { contains: normalized } }]
            : []),
          { make: { contains: trimmed, mode: 'insensitive' as const } },
          { model: { contains: trimmed, mode: 'insensitive' as const } },
        ],
      },
      include: vehicleListInclude,
      orderBy: { lastSeenAt: 'desc' },
      take: Math.min(limit, 50),
    });

    return rows.map((row) => toListItem(row, canSeePii));
  }

  private buildWhere(
    actor: AuthenticatedUser,
    filters: VehicleListFilters,
  ): Prisma.VehicleWhereInput {
    const siteFilter = AccessScope.siteFilter(actor);

    const where: Prisma.VehicleWhereInput = {
      organizationId: actor.organizationId,
      // Financier isolation is a mandatory predicate, not an afterthought.
      ...(actor.financierId ? { currentFinancierId: actor.financierId } : {}),
      ...(filters.financierId ? { currentFinancierId: filters.financierId } : {}),
      ...(filters.vehicleClass ? { vehicleClass: filters.vehicleClass } : {}),
      ...(filters.status && filters.status.length > 0 ? { status: { in: filters.status } } : {}),
      ...(filters.unmatchedFinancier ? { currentFinancierId: null } : {}),
    };

    if (filters.siteId) {
      where.currentSiteId = filters.siteId;
    } else if (siteFilter) {
      // Users without all-site access see only vehicles at their sites, plus
      // vehicles not currently at any site (historic records they may search).
      where.OR = [{ currentSiteId: siteFilter }, { currentSiteId: null }];
    }

    if (filters.onSiteOnly) {
      where.currentSiteId = filters.siteId ?? { not: null };
    }

    if (filters.search) {
      const normalized = normalizeRegistrationNumber(filters.search);
      const searchClauses: Prisma.VehicleWhereInput[] = [
        { make: { contains: filters.search, mode: 'insensitive' } },
        { model: { contains: filters.search, mode: 'insensitive' } },
      ];
      if (normalized.length >= 2) {
        searchClauses.unshift({ normalizedRegistrationNumber: { contains: normalized } });
      }
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: searchClauses }];
    }

    return where;
  }
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

const vehicleListInclude = {
  currentFinancier: { select: { id: true, displayName: true, code: true } },
  currentSite: { select: { id: true, name: true, code: true, siteType: true } },
} satisfies Prisma.VehicleInclude;

type VehicleRow = Prisma.VehicleGetPayload<{ include: typeof vehicleListInclude }>;

export interface VehicleListItem {
  id: string;
  registrationNumber: string;
  normalizedRegistrationNumber: string;
  vehicleClass: string;
  make: string | null;
  model: string | null;
  status: string;
  vahanVerificationStatus: string;
  registeredOwnerName: string | null;
  financierId: string | null;
  financierName: string | null;
  siteId: string | null;
  siteName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface VehicleDetail extends VehicleListItem {
  variant: string | null;
  color: string | null;
  fuelType: string | null;
  manufacturingYear: number | null;
  chassisNumberLast4: string | null;
  engineNumberLast4: string | null;
  registeredOwnerAddress: string | null;
  hypothecationStatus: string;
  vahanVerifiedAt: string | null;
  financierMatchMethod: string;
  financierMatchConfidence: string | null;
  ownershipSource: string | null;
  ownershipRetrievedAt: string | null;
  ownershipIsSimulated: boolean;
  activeSession: {
    id: string;
    sessionNumber: string;
    status: string;
    entryAt: string;
    exitAt: string | null;
    siteName: string;
    zoneName: string | null;
    spaceCode: string | null;
    rateUnresolved: boolean;
  } | null;
  totalVisits: number;
  notes: string | null;
}

export interface TimelineItem {
  id: string;
  type: string;
  occurredAt: string;
  title: string;
  description: string | null;
  siteName: string | null;
  actorType: string;
  actorLabel: string | null;
  payload: Record<string, unknown> | null;
  correlationId: string | null;
}

/**
 * Projects a vehicle row.
 *
 * `canSeePii` decides whether the registered owner's name is returned in full
 * or masked (requirement S36: ownership data is not visible merely because it
 * exists).
 */
function toListItem(row: VehicleRow, canSeePii: boolean): VehicleListItem {
  return {
    id: row.id,
    registrationNumber: row.registrationNumber,
    normalizedRegistrationNumber: row.normalizedRegistrationNumber,
    vehicleClass: row.vehicleClass,
    make: row.make,
    model: row.model,
    status: row.status,
    vahanVerificationStatus: row.vahanVerificationStatus,
    registeredOwnerName: row.registeredOwnerName
      ? canSeePii
        ? row.registeredOwnerName
        : maskName(row.registeredOwnerName)
      : null,
    financierId: row.currentFinancierId,
    financierName: row.currentFinancier?.displayName ?? null,
    siteId: row.currentSiteId,
    siteName: row.currentSite?.name ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}
