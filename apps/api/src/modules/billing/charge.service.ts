import { Injectable } from '@nestjs/common';
import {
  ChargeCalculationType,
  ParkingSession,
  ParkingSessionStatus,
  Prisma,
} from '@prisma/client';

import { ChargeBreakdown, ErrorCode, TimelineEventType } from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { RequestContextStore } from '@/common/context/request-context';
import { toPrismaDecimal, unitsToPrismaDecimal } from '@/common/money/money';
import { PrismaExecutor, PrismaService, PrismaTransaction } from '@/infrastructure/prisma/prisma.service';
import { DomainEventType, OutboxService } from '@/infrastructure/outbox';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { RateResolutionService } from '@/modules/contract/rate-resolution.service';
import { ChargeEngine } from './domain/charge-engine';
import { buildRatePlanSnapshot, parseRatePlanSnapshot } from './domain/rate-plan-snapshot';
import type { RatePlanSnapshot } from './domain/rate-plan.types';

export interface ChargeResult {
  calculationId: string | null;
  breakdown: ChargeBreakdown | null;
  /** Set when nothing could be computed - always with a reason, never silently. */
  unavailableReason?: string;
}

/**
 * Charge calculation and persistence.
 *
 * The pure arithmetic lives in `ChargeEngine`; this class supplies its inputs,
 * writes the workings, and decides when a calculation supersedes another.
 *
 * The critical rule is which rate plan is used. A session snapshots its plan at
 * admission, and that snapshot is preferred over the live rows for the life of
 * the stay. Without it, renegotiating a contract would silently re-price every
 * vehicle already in the yard - including stays that have already been
 * invoiced. Requirement S14's "version-aware" and "reproducible" properties
 * depend entirely on this.
 */
@Injectable()
export class ChargeService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RateResolutionService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Charge');
  }

  /**
   * Computes what a stay costs as at `asOf`, without persisting anything.
   *
   * Used by the console to show a live figure and by the release workflow to
   * quote a settlement amount before anything is committed.
   */
  async estimate(sessionId: string, asOf: Date = new Date()): Promise<ChargeResult> {
    const session = await this.prisma.parkingSession.findUnique({
      where: { id: sessionId },
      include: { site: { select: { timezone: true } } },
    });
    if (!session) throw notFound('Parking session', sessionId);

    const snapshot = await this.resolveSnapshot(this.prisma, session);
    if (!snapshot) {
      return {
        calculationId: null,
        breakdown: null,
        unavailableReason:
          'No rate plan is attached to this stay, so no charge can be computed yet.',
      };
    }

    const effectiveAsOf = session.exitAt && session.exitAt < asOf ? session.exitAt : asOf;

    return {
      calculationId: null,
      breakdown: ChargeEngine.calculate({
        entryAt: session.entryAt,
        asOf: effectiveAsOf,
        timezone: session.site.timezone,
        ratePlan: snapshot,
      }),
    };
  }

  /**
   * Computes and persists a calculation.
   *
   * ACCRUAL and ESTIMATE rows supersede the previous "current" one; FINAL rows
   * are immutable and are what an invoice is raised against.
   *
   * @throws AppException NO_APPLICABLE_RATE_PLAN when `requireRate` is set and
   *         no plan applies. FINAL calculations always require one - issuing an
   *         invoice for an unpriced stay is worse than failing loudly.
   */
  async calculateAndStore(
    tx: PrismaTransaction,
    sessionId: string,
    type: ChargeCalculationType,
    asOf: Date,
    options: { requireRate?: boolean; actorId?: string | null } = {},
  ): Promise<ChargeResult> {
    const session = await tx.parkingSession.findUnique({
      where: { id: sessionId },
      include: { site: { select: { timezone: true, organizationId: true } } },
    });
    if (!session) throw notFound('Parking session', sessionId);

    const snapshot = await this.resolveSnapshot(tx, session);

    if (!snapshot) {
      const reason =
        'No rate plan applies to this stay. Attach a contract rate before invoicing.';
      if (options.requireRate ?? type === ChargeCalculationType.FINAL) {
        throw new AppException(ErrorCode.NO_APPLICABLE_RATE_PLAN, reason, {
          details: { sessionId, sessionNumber: session.sessionNumber },
        });
      }
      return { calculationId: null, breakdown: null, unavailableReason: reason };
    }

    // A stay never accrues beyond its exit: a nightly job running after a
    // vehicle left must not keep charging for it.
    const effectiveAsOf = session.exitAt && session.exitAt < asOf ? session.exitAt : asOf;

    const breakdown = ChargeEngine.calculate({
      entryAt: session.entryAt,
      asOf: effectiveAsOf,
      timezone: session.site.timezone,
      ratePlan: snapshot,
    });

    // Nothing changed since the last accrual, so writing another identical row
    // would just add noise to the audit trail.
    if (type === ChargeCalculationType.ACCRUAL) {
      const current = await tx.chargeCalculation.findFirst({
        where: { sessionId, isCurrent: true },
        select: { id: true, inputsHash: true },
      });
      if (current?.inputsHash === breakdown.inputsHash) {
        return { calculationId: current.id, breakdown };
      }
    }

    // Only one row per session may be "current".
    await tx.chargeCalculation.updateMany({
      where: { sessionId, isCurrent: true },
      data: { isCurrent: false },
    });

    const calculation = await tx.chargeCalculation.create({
      data: {
        organizationId: session.organizationId,
        sessionId,
        type,
        asOf: effectiveAsOf,
        engineVersion: breakdown.engineVersion,
        ratePlanId: session.ratePlanId,
        ratePlanSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        timezone: breakdown.timezone,
        billingUnit: snapshot.billingUnit,
        roundingMode: snapshot.roundingMode,
        freeUnitPolicy: snapshot.freeUnitPolicy,
        rawDurationMinutes: breakdown.rawDurationMinutes,
        graceMinutes: breakdown.graceMinutes,
        totalUnits: unitsToPrismaDecimal(breakdown.totalUnits),
        freeUnits: unitsToPrismaDecimal(breakdown.freeUnits),
        chargeableUnits: unitsToPrismaDecimal(breakdown.chargeableUnits),
        subtotal: toPrismaDecimal(breakdown.subtotal),
        taxTotal: toPrismaDecimal(breakdown.taxTotal),
        total: toPrismaDecimal(breakdown.total),
        currency: breakdown.currency,
        inputsHash: breakdown.inputsHash,
        explanation: breakdown.explanation as unknown as Prisma.InputJsonValue,
        isCurrent: true,
        calculatedById: options.actorId ?? null,
        lines: {
          create: [...breakdown.lines, ...breakdown.taxLines].map((line) => ({
            lineNo: line.lineNo,
            kind: line.kind as Prisma.ChargeLineCreateWithoutCalculationInput['kind'],
            description: line.description,
            fromUnit: line.fromUnit === null ? null : unitsToPrismaDecimal(line.fromUnit),
            toUnit: line.toUnit === null ? null : unitsToPrismaDecimal(line.toUnit),
            units: unitsToPrismaDecimal(line.units),
            unitAmount: toPrismaDecimal(line.unitAmount),
            amount: toPrismaDecimal(line.amount),
          })),
        },
      },
    });

    if (type === ChargeCalculationType.ACCRUAL) {
      await this.outbox.record(tx, {
        eventType: DomainEventType.CHARGE_ACCRUED,
        aggregateType: 'ParkingSession',
        aggregateId: sessionId,
        payload: {
          sessionId,
          calculationId: calculation.id,
          organizationId: session.organizationId,
          total: breakdown.total,
          currency: breakdown.currency,
          chargeableUnits: breakdown.chargeableUnits,
          asOf: effectiveAsOf.toISOString(),
        },
      });
    }

    if (type === ChargeCalculationType.FINAL) {
      await this.outbox.record(tx, {
        eventType: DomainEventType.CHARGE_FINALISED,
        aggregateType: 'ParkingSession',
        aggregateId: sessionId,
        payload: {
          sessionId,
          calculationId: calculation.id,
          organizationId: session.organizationId,
          total: breakdown.total,
          currency: breakdown.currency,
          chargeableUnits: breakdown.chargeableUnits,
          asOf: effectiveAsOf.toISOString(),
        },
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: session.organizationId,
          vehicleId: session.vehicleId,
          sessionId,
          siteId: session.siteId,
          type: TimelineEventType.CHARGE_ACCRUED,
          occurredAt: new Date(),
          actorId: options.actorId ?? null,
          actorType: options.actorId ? 'USER' : 'SYSTEM',
          title: `Final charge ${breakdown.currency} ${breakdown.total}`,
          description: breakdown.explanation.join(' '),
          payload: {
            calculationId: calculation.id,
            chargeableUnits: breakdown.chargeableUnits,
            inputsHash: breakdown.inputsHash,
          },
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.CHARGE_CALCULATED,
        entityType: 'ChargeCalculation',
        entityId: calculation.id,
        organizationId: session.organizationId,
        siteId: session.siteId,
        afterState: {
          sessionId,
          type,
          total: breakdown.total,
          currency: breakdown.currency,
          engineVersion: breakdown.engineVersion,
          inputsHash: breakdown.inputsHash,
        },
      });
    }

    return { calculationId: calculation.id, breakdown };
  }

  /**
   * Nightly accrual across every open stay (requirement S14: charges accrue
   * automatically day by day).
   *
   * Processed in batches, each in its own transaction, so one unpriced stay
   * cannot abort the run for the entire estate. Idempotent by construction: an
   * unchanged `inputsHash` produces no new row, so running it twice in a night
   * is harmless.
   */
  async runAccrual(
    organizationId: string,
    asOf: Date = new Date(),
    batchSize = 200,
  ): Promise<{ processed: number; skipped: number; failed: number }> {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | undefined;

    for (;;) {
      const sessions = await this.prisma.parkingSession.findMany({
        where: {
          organizationId,
          status: { in: [ParkingSessionStatus.OPEN, ParkingSessionStatus.ON_HOLD] },
        },
        select: { id: true, sessionNumber: true },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (sessions.length === 0) break;
      cursor = sessions[sessions.length - 1]?.id;

      for (const session of sessions) {
        try {
          const result = await this.prisma.transaction((tx) =>
            this.calculateAndStore(tx, session.id, ChargeCalculationType.ACCRUAL, asOf, {
              requireRate: false,
            }),
          );
          if (result.calculationId) processed++;
          else skipped++;
        } catch (error) {
          failed++;
          this.logger.error('Accrual failed for one stay; continuing', error, {
            sessionId: session.id,
            sessionNumber: session.sessionNumber,
          });
        }
      }

      if (sessions.length < batchSize) break;
    }

    this.logger.info('Charge accrual complete', { processed, skipped, failed, asOf });
    return { processed, skipped, failed };
  }

  /** The persisted current calculation, with its lines, for the console. */
  async currentCalculation(sessionId: string) {
    return this.prisma.chargeCalculation.findFirst({
      where: { sessionId, isCurrent: true },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
  }

  /** Every calculation for a stay, newest first. The audit view. */
  async history(sessionId: string) {
    return this.prisma.chargeCalculation.findMany({
      where: { sessionId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Attaches a rate plan to a stay that was admitted without one.
   *
   * The finance work-queue action for the deliberate gap left by the gate's
   * never-block rule. Re-resolves from live configuration, snapshots it, and
   * recomputes the accrual.
   */
  async attachRatePlan(
    sessionId: string,
    actorId: string,
    reason: string,
  ): Promise<ChargeResult> {
    return this.prisma.transaction(async (tx) => {
      const session = await tx.parkingSession.findUnique({
        where: { id: sessionId },
        include: { vehicle: { select: { vehicleClass: true, currentFinancierId: true } }, site: true },
      });
      if (!session) throw notFound('Parking session', sessionId);

      if (session.status === ParkingSessionStatus.CLOSED) {
        throw new AppException(
          ErrorCode.SESSION_ALREADY_CLOSED,
          'This stay is closed; its charge cannot be re-rated.',
        );
      }

      const resolution = await this.rates.resolve(tx, {
        organizationId: session.organizationId,
        siteId: session.siteId,
        parkingMode: session.parkingMode,
        financierId: session.financierId ?? session.vehicle.currentFinancierId,
        vehicleClass: session.vehicle.vehicleClass,
        effectiveAt: session.entryAt,
      });

      if (!resolution.resolved || !resolution.snapshot) {
        throw new AppException(
          ErrorCode.NO_APPLICABLE_RATE_PLAN,
          resolution.unresolvedReason ?? 'No rate plan could be resolved for this stay.',
          { details: { trace: resolution.trace } },
        );
      }

      await tx.parkingSession.update({
        where: { id: sessionId },
        data: {
          ratePlanId: resolution.ratePlan?.id ?? null,
          contractVersionId: resolution.contractVersionId,
          ratePlanSnapshot: resolution.snapshot as unknown as Prisma.InputJsonValue,
          rateUnresolved: false,
          financierId: session.financierId ?? session.vehicle.currentFinancierId,
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.CHARGE_RECALCULATED,
        entityType: 'ParkingSession',
        entityId: sessionId,
        organizationId: session.organizationId,
        siteId: session.siteId,
        beforeState: { rateUnresolved: true, ratePlanId: session.ratePlanId },
        afterState: { rateUnresolved: false, ratePlanId: resolution.ratePlan?.id ?? null },
        reason,
      });

      return this.calculateAndStore(
        tx,
        sessionId,
        ChargeCalculationType.ACCRUAL,
        new Date(),
        { actorId },
      );
    });
  }

  /* ---------------------------------------------------------------- */

  /**
   * Gets the rate plan to price with.
   *
   * Order matters and is the whole reproducibility guarantee:
   *   1. The snapshot taken at admission - authoritative, frozen.
   *   2. The live plan, ONLY when no snapshot exists (a stay admitted before a
   *      rate was attached). Snapshotting it is then the caller's job.
   */
  private async resolveSnapshot(
    tx: PrismaExecutor,
    session: ParkingSession,
  ): Promise<RatePlanSnapshot | null> {
    const snapshot = parseRatePlanSnapshot(session.ratePlanSnapshot);
    if (snapshot) return snapshot;

    if (!session.ratePlanId) return null;

    this.logger.warn('Stay has a rate plan but no snapshot; falling back to the live plan', {
      sessionId: session.id,
      ratePlanId: session.ratePlanId,
    });

    const plan = await tx.ratePlan.findUnique({
      where: { id: session.ratePlanId },
      include: { slabs: true },
    });
    if (!plan) return null;

    const taxProfile = session.contractVersionId
      ? await tx.contractVersion
          .findUnique({
            where: { id: session.contractVersionId },
            include: { taxProfile: { include: { components: true } } },
          })
          .then((version) => version?.taxProfile ?? null)
      : await tx.site
          .findUnique({
            where: { id: session.siteId },
            include: { taxProfile: { include: { components: true } } },
          })
          .then((site) => site?.taxProfile ?? null);

    return buildRatePlanSnapshot(plan, taxProfile);
  }
}
