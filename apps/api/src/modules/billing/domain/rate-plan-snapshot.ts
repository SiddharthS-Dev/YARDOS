import { Prisma } from '@prisma/client';

import { MONEY_SCALE, UNIT_SCALE } from '@/common/money/money';
import type {
  RatePlanSnapshot,
  RateSlabSnapshot,
  TaxProfileSnapshot,
} from './rate-plan.types';

/**
 * Turns live database rows into the frozen snapshot the charge engine consumes.
 *
 * Everything numeric becomes a fixed-scale decimal STRING here. The snapshot is
 * persisted as JSON, and a JSON number is an IEEE-754 double - round-tripping a
 * rate through one would quietly corrupt it. Fixed scale also means two
 * snapshots of the same plan serialise identically, which is what makes
 * `inputsHash` comparisons meaningful.
 */

export type RatePlanWithSlabs = Prisma.RatePlanGetPayload<{
  include: { slabs: true };
}>;

export type TaxProfileWithComponents = Prisma.TaxProfileGetPayload<{
  include: { components: true };
}>;

export function buildRatePlanSnapshot(
  plan: RatePlanWithSlabs,
  taxProfile?: TaxProfileWithComponents | null,
): RatePlanSnapshot {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    scope: plan.scope,
    billingUnit: plan.billingUnit,
    roundingMode: plan.roundingMode,
    freeUnits: units(plan.freeUnits),
    freeUnitPolicy: plan.freeUnitPolicy,
    graceMinutes: plan.graceMinutes,
    minimumChargeAmount: plan.minimumChargeAmount ? money(plan.minimumChargeAmount) : null,
    dailyCapAmount: plan.dailyCapAmount ? money(plan.dailyCapAmount) : null,
    currency: plan.currency,
    slabs: [...plan.slabs]
      .sort((a, b) => a.sequence - b.sequence)
      .map(
        (slab): RateSlabSnapshot => ({
          id: slab.id,
          sequence: slab.sequence,
          fromUnit: units(slab.fromUnit),
          toUnit: slab.toUnit === null ? null : units(slab.toUnit),
          kind: slab.kind,
          amount: money(slab.amount),
          description: slab.description,
        }),
      ),
    taxProfile: taxProfile ? buildTaxProfileSnapshot(taxProfile) : null,
    capturedAt: new Date().toISOString(),
    contractVersionId: plan.contractVersionId,
    siteId: plan.siteId,
  };
}

export function buildTaxProfileSnapshot(profile: TaxProfileWithComponents): TaxProfileSnapshot {
  return {
    code: profile.code,
    name: profile.name,
    components: profile.components
      .filter((component) => component.isActive)
      .sort((a, b) => a.sequence - b.sequence)
      .map((component) => ({
        sequence: component.sequence,
        code: component.code,
        name: component.name,
        kind: component.kind,
        // Six places: a tax fraction such as 0.090000 must not be truncated.
        rate: component.rate.toFixed(6),
        base: component.base,
        hsnSac: component.hsnSac,
      })),
  };
}

/**
 * Reads a snapshot back out of a JSON column.
 *
 * Returns null rather than throwing on a malformed value: the caller falls back
 * to the live plan and flags the session, which is far better than a nightly
 * accrual run aborting on one bad row.
 */
export function parseRatePlanSnapshot(value: Prisma.JsonValue | null): RatePlanSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as unknown as RatePlanSnapshot;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.billingUnit !== 'string' ||
    !Array.isArray(candidate.slabs)
  ) {
    return null;
  }
  return candidate;
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(MONEY_SCALE);
}

function units(value: Prisma.Decimal): string {
  return value.toFixed(UNIT_SCALE);
}
