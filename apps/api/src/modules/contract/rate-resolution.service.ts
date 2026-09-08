import { Injectable } from '@nestjs/common';
import { ContractVersionStatus, ParkingMode, Prisma, RatePlanStatus, VehicleClass } from '@prisma/client';

import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { PrismaExecutor } from '@/infrastructure/prisma/prisma.service';
import {
  RatePlanWithSlabs,
  buildRatePlanSnapshot,
} from '@/modules/billing/domain/rate-plan-snapshot';
import type { RatePlanSnapshot } from '@/modules/billing/domain/rate-plan.types';

export interface RateResolutionRequest {
  organizationId: string;
  siteId: string;
  parkingMode: ParkingMode;
  /** Null for public parking, or when no financier could be matched. */
  financierId: string | null;
  vehicleClass: VehicleClass;
  /** The instant the plan must be effective at - normally the entry time. */
  effectiveAt: Date;
}

export interface RateResolution {
  ratePlan: RatePlanWithSlabs | null;
  snapshot: RatePlanSnapshot | null;
  contractVersionId: string | null;
  /** Ordered account of what was tried. Surfaced in the console and audited. */
  trace: string[];
  resolved: boolean;
  /** Why nothing matched, when `resolved` is false. */
  unresolvedReason?: string;
}

/**
 * Chooses which rate plan prices a stay.
 *
 * Two paths, one algorithm:
 *
 *   REPOSSESSION_YARD  financier -> active contract -> active contract version
 *                      effective at the entry instant -> its rate plans
 *   PUBLIC_PARKING     site -> site tariff plans
 *
 * Among candidates, selection is:
 *   1. A plan naming this vehicle class beats a catch-all (NULL class).
 *   2. Then highest `priority`.
 *   3. Then the most recently effective plan.
 *
 * This never throws when nothing matches. Requirement S9 is explicit that the
 * gate must not block, so an unrated vehicle is still admitted; the session is
 * flagged `rateUnresolved` and appears in a work queue for finance to fix. A
 * vehicle stuck outside the gate is a worse outcome than a stay that needs its
 * rate attached later.
 */
@Injectable()
export class RateResolutionService {
  private readonly logger: ScopedLogger;

  constructor(logger: AppLogger) {
    this.logger = logger.forContext('RateResolution');
  }

  async resolve(tx: PrismaExecutor, request: RateResolutionRequest): Promise<RateResolution> {
    const trace: string[] = [];

    if (request.parkingMode === ParkingMode.PUBLIC_PARKING) {
      return this.resolveSiteTariff(tx, request, trace);
    }
    return this.resolveContractRate(tx, request, trace);
  }

  /* ---------------------------------------------------------------- */
  /* Repossession yard: contract-derived rates                         */
  /* ---------------------------------------------------------------- */

  private async resolveContractRate(
    tx: PrismaExecutor,
    request: RateResolutionRequest,
    trace: string[],
  ): Promise<RateResolution> {
    if (!request.financierId) {
      trace.push('No financier matched for this vehicle, so no contract could be selected.');
      return unresolved(
        trace,
        'The vehicle has no matched financier, so no contract rate applies.',
      );
    }

    const contractVersion = await tx.contractVersion.findFirst({
      where: {
        status: ContractVersionStatus.ACTIVE,
        effectiveFrom: { lte: request.effectiveAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: request.effectiveAt } }],
        contract: {
          financierId: request.financierId,
          organizationId: request.organizationId,
          status: 'ACTIVE',
        },
      },
      include: {
        contract: { select: { code: true, title: true } },
        taxProfile: { include: { components: true } },
      },
      // A newer version always wins if two are somehow both active; the unique
      // partial index makes that impossible, but ordering costs nothing.
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!contractVersion) {
      trace.push(
        `No active contract version for financier ${request.financierId} ` +
          `effective at ${request.effectiveAt.toISOString()}.`,
      );
      return unresolved(trace, 'The financier has no active contract covering this date.');
    }

    trace.push(
      `Matched contract ${contractVersion.contract.code} version ${contractVersion.versionNo} ` +
        `(effective from ${contractVersion.effectiveFrom.toISOString()}).`,
    );

    const candidates = await tx.ratePlan.findMany({
      where: {
        contractVersionId: contractVersion.id,
        status: RatePlanStatus.ACTIVE,
        effectiveFrom: { lte: request.effectiveAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: request.effectiveAt } }],
        // A plan may be site-specific or apply to every site.
        AND: [{ OR: [{ siteId: null }, { siteId: request.siteId }] }],
        ...vehicleClauseFor(request.vehicleClass),
      },
      include: { slabs: true },
    });

    const chosen = this.pick(candidates, request, trace);
    if (!chosen) {
      return unresolved(
        trace,
        'The contract has no active rate plan for this site and vehicle class.',
      );
    }

    return {
      ratePlan: chosen,
      snapshot: buildRatePlanSnapshot(chosen, contractVersion.taxProfile),
      contractVersionId: contractVersion.id,
      trace,
      resolved: true,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Public parking: site tariffs (Phase 2)                            */
  /* ---------------------------------------------------------------- */

  private async resolveSiteTariff(
    tx: PrismaExecutor,
    request: RateResolutionRequest,
    trace: string[],
  ): Promise<RateResolution> {
    const site = await tx.site.findUnique({
      where: { id: request.siteId },
      include: { taxProfile: { include: { components: true } } },
    });

    const candidates = await tx.ratePlan.findMany({
      where: {
        scope: 'SITE_TARIFF',
        siteId: request.siteId,
        status: RatePlanStatus.ACTIVE,
        effectiveFrom: { lte: request.effectiveAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: request.effectiveAt } }],
        ...vehicleClauseFor(request.vehicleClass),
      },
      include: { slabs: true },
    });

    trace.push(`Found ${candidates.length} active tariff plan(s) for this site.`);

    const chosen = this.pick(candidates, request, trace);
    if (!chosen) {
      return unresolved(trace, 'This public parking site has no published tariff.');
    }

    return {
      ratePlan: chosen,
      snapshot: buildRatePlanSnapshot(chosen, site?.taxProfile ?? null),
      contractVersionId: null,
      trace,
      resolved: true,
    };
  }

  /* ---------------------------------------------------------------- */

  /** Applies the specificity, priority and recency ordering. */
  private pick(
    candidates: RatePlanWithSlabs[],
    request: RateResolutionRequest,
    trace: string[],
  ): RatePlanWithSlabs | null {
    if (candidates.length === 0) {
      trace.push('No rate plan matched the site, vehicle class and effective date.');
      return null;
    }

    const ranked = [...candidates].sort((a, b) => {
      // A plan naming the class beats a catch-all.
      const classSpecificity =
        Number(b.vehicleClass === request.vehicleClass) -
        Number(a.vehicleClass === request.vehicleClass);
      if (classSpecificity !== 0) return classSpecificity;

      // A site-specific plan beats an all-sites plan.
      const siteSpecificity =
        Number(b.siteId === request.siteId) - Number(a.siteId === request.siteId);
      if (siteSpecificity !== 0) return siteSpecificity;

      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    });

    const chosen = ranked[0] as RatePlanWithSlabs;
    trace.push(
      `Selected rate plan ${chosen.code} ("${chosen.name}", priority ${chosen.priority}, ` +
        `class ${chosen.vehicleClass ?? 'ANY'}) from ${candidates.length} candidate(s).`,
    );

    if (candidates.length > 1) {
      this.logger.debug('Multiple rate plans matched; highest-ranked selected', {
        chosen: chosen.code,
        candidates: candidates.map((c) => c.code),
      });
    }
    return chosen;
  }
}

/* ------------------------------------------------------------------ */

/** Matches a plan naming this class, or a catch-all plan. */
function vehicleClauseFor(vehicleClass: VehicleClass): Prisma.RatePlanWhereInput {
  return { OR: [{ vehicleClass: null }, { vehicleClass }] };
}

function unresolved(trace: string[], reason: string): RateResolution {
  return {
    ratePlan: null,
    snapshot: null,
    contractVersionId: null,
    trace: [...trace, `UNRESOLVED: ${reason}`],
    resolved: false,
    unresolvedReason: reason,
  };
}
