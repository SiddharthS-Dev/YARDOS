import {
  ChargeBreakdown,
  ChargeBreakdownLine,
  ChargeLineKind,
  ErrorCode,
} from '@smartpark/contracts';

import { AppException } from '@/common/errors/app-exception';
import {
  Decimal,
  MONEY_SCALE,
  addMoney,
  formatMoney,
  money,
  moneyToString,
  sumExact,
  toDecimal,
  units as toUnits,
  unitsToString,
} from '@/common/money/money';
import { stableHash } from '@/common/util/hash';
import { computeDuration, describeDuration } from './duration';
import type { ChargeInput, RatePlanSnapshot, RateSlabSnapshot } from './rate-plan.types';

/**
 * The charge engine.
 *
 * Requirement S14. Four properties are non-negotiable, and every design choice
 * below serves one of them:
 *
 *   DETERMINISTIC  Same inputs, same output, forever. No `new Date()` inside,
 *                  no database reads, no configuration lookups - everything
 *                  arrives in `ChargeInput`. That is why this is a pure
 *                  function and not a service.
 *
 *   EXPLAINABLE    Never store just a total. Every line records the slab it
 *                  came from, the ladder positions it covered, the units it
 *                  consumed and the rate applied, plus a narrative a finance
 *                  officer can read out to a financier.
 *
 *   AUDITABLE      `inputsHash` is a stable hash of the canonicalised inputs. A
 *                  recalculation producing the same hash and a different total
 *                  is a bug, and a provably detectable one.
 *
 *   EXACT          Decimal throughout. Lines are rounded for display; the
 *                  subtotal is the sum of the UNROUNDED line values, rounded
 *                  once. Rounding each of forty lines and then adding them is
 *                  how invoices end up a rupee out.
 *
 * Bump ENGINE_VERSION on any change that can alter an output for unchanged
 * inputs, so historical calculations remain attributable to the code that
 * produced them.
 */
export const ENGINE_VERSION = '1.0.0';

/** Guard against a malformed open-ended slab producing an unbounded loop. */
const MAX_LADDER_UNITS = 100_000;

export class ChargeEngine {
  /**
   * Prices a stay.
   *
   * @throws AppException EXIT_BEFORE_ENTRY, RATE_PLAN_INVALID
   */
  static calculate(input: ChargeInput): ChargeBreakdown {
    const { entryAt, asOf, timezone, ratePlan } = input;

    validateRatePlan(ratePlan);

    if (asOf.getTime() < entryAt.getTime()) {
      throw new AppException(
        ErrorCode.EXIT_BEFORE_ENTRY,
        'The exit time is before the entry time.',
        { details: { entryAt: entryAt.toISOString(), asOf: asOf.toISOString() } },
      );
    }

    const explanation: string[] = [];
    const lines: ChargeBreakdownLine[] = [];

    const duration = computeDuration(
      entryAt,
      asOf,
      ratePlan.billingUnit,
      ratePlan.roundingMode,
      timezone,
    );

    const unitLabel = unitNoun(ratePlan.billingUnit);
    explanation.push(
      `Stay: ${describeDuration(duration.rawMinutes)} ` +
        `(${entryAt.toISOString()} to ${asOf.toISOString()}, ${timezone}).`,
    );

    /* --- 1. Grace period ------------------------------------------ */
    // A grace period is all-or-nothing: inside it, nothing is charged at all.
    if (ratePlan.graceMinutes > 0 && duration.rawMinutes <= ratePlan.graceMinutes) {
      explanation.push(
        `Within the ${ratePlan.graceMinutes}-minute grace period, so no charge applies.`,
      );
      lines.push({
        lineNo: 1,
        kind: ChargeLineKind.GRACE,
        description: `Grace period (${ratePlan.graceMinutes} minutes) - no charge`,
        fromUnit: null,
        toUnit: null,
        units: unitsToString(0),
        unitAmount: moneyToString(0),
        amount: moneyToString(0),
      });
      return buildResult({
        input,
        duration,
        totalUnits: toUnits(0),
        freeUnits: toUnits(0),
        chargeableUnits: toUnits(0),
        lines,
        taxLines: [],
        subtotal: money(0),
        taxTotal: money(0),
        explanation,
      });
    }

    const totalUnits = duration.roundedUnits;
    explanation.push(
      `Billable duration: ${unitsToString(totalUnits)} ${unitLabel} ` +
        `(${ratePlan.billingUnit}, rounded ${ratePlan.roundingMode}).`,
    );

    /* --- 2. Free allowance ---------------------------------------- */
    const planFreeUnits = toUnits(ratePlan.freeUnits);
    const freeUnits = planFreeUnits.greaterThan(totalUnits) ? totalUnits : planFreeUnits;
    const chargeableUnits = toUnits(totalUnits.minus(freeUnits));

    let lineNo = 1;
    if (freeUnits.greaterThan(0)) {
      explanation.push(
        `Free allowance: ${unitsToString(freeUnits)} ${unitLabel} at no charge ` +
          `(policy ${ratePlan.freeUnitPolicy}).`,
      );
      lines.push({
        lineNo: lineNo++,
        kind: ChargeLineKind.FREE_ALLOWANCE,
        description: `Free allowance - ${unitsToString(freeUnits)} ${unitLabel}`,
        fromUnit: 1,
        toUnit: freeUnits.toNumber(),
        units: unitsToString(freeUnits),
        unitAmount: moneyToString(0),
        amount: moneyToString(0),
      });
    }

    if (chargeableUnits.lessThanOrEqualTo(0)) {
      explanation.push('Entire stay is covered by the free allowance. Nothing to charge.');
      return buildResult({
        input,
        duration,
        totalUnits,
        freeUnits,
        chargeableUnits: toUnits(0),
        lines,
        taxLines: [],
        subtotal: money(0),
        taxTotal: money(0),
        explanation,
      });
    }

    /* --- 3. Ladder walk ------------------------------------------- */
    // Where the charged range sits on the slab ladder is a contract term.
    //
    //   CONSUME_LADDER: free units occupy positions 1..F, so with 7 free days a
    //     40-day stay is charged for positions 8..40 and day 8 is priced at
    //     whatever slab covers position 8.
    //   SKIP_LADDER: free units vanish, so the same stay is charged for
    //     positions 1..33 and the first chargeable day is priced at the day-1
    //     slab.
    //
    // Neither is universal; both exist in real yard contracts.
    const consumesLadder = ratePlan.freeUnitPolicy === 'CONSUME_LADDER';
    const rangeStart = consumesLadder ? freeUnits.plus(1) : toDecimal(1);
    const rangeEnd = consumesLadder ? totalUnits : chargeableUnits;

    explanation.push(
      `Charging ladder positions ${unitsToString(rangeStart)} to ${unitsToString(rangeEnd)}.`,
    );

    const rawLineAmounts: Decimal[] = [];
    const orderedSlabs = [...ratePlan.slabs].sort((a, b) => a.sequence - b.sequence);

    for (const slab of orderedSlabs) {
      const slabFrom = toUnits(slab.fromUnit);
      const slabTo =
        slab.toUnit === null || slab.toUnit === undefined
          ? toUnits(MAX_LADDER_UNITS)
          : toUnits(slab.toUnit);

      // Intersect [rangeStart, rangeEnd] with [slabFrom, slabTo].
      const overlapStart = Decimal.max(rangeStart, slabFrom);
      const overlapEnd = Decimal.min(rangeEnd, slabTo);
      if (overlapEnd.lessThan(overlapStart)) continue;

      // Positions are inclusive on both ends: 8..10 is three units.
      const overlapUnits = toUnits(overlapEnd.minus(overlapStart).plus(1));
      if (overlapUnits.lessThanOrEqualTo(0)) continue;

      const slabAmount = toDecimal(slab.amount);

      if (slab.kind === 'FLAT') {
        // A flat slab charges once, however many units fall inside it.
        rawLineAmounts.push(slabAmount);
        lines.push({
          lineNo: lineNo++,
          kind: ChargeLineKind.SLAB,
          description:
            slab.description ??
            `${describeSlabRange(slab, unitLabel)} - flat charge`,
          fromUnit: overlapStart.toNumber(),
          toUnit: overlapEnd.toNumber(),
          units: unitsToString(overlapUnits),
          unitAmount: moneyToString(slabAmount),
          amount: moneyToString(slabAmount),
        });
        explanation.push(
          `${describeSlabRange(slab, unitLabel)}: flat ${formatMoney(slabAmount, ratePlan.currency)}.`,
        );
      } else {
        const raw = slabAmount.times(overlapUnits);
        rawLineAmounts.push(raw);
        lines.push({
          lineNo: lineNo++,
          kind: ChargeLineKind.SLAB,
          description:
            slab.description ??
            `${describeSlabRange(slab, unitLabel)} at ${formatMoney(slabAmount, ratePlan.currency)} per ${unitLabel.replace(/s$/, '')}`,
          fromUnit: overlapStart.toNumber(),
          toUnit: overlapEnd.toNumber(),
          units: unitsToString(overlapUnits),
          unitAmount: moneyToString(slabAmount),
          amount: moneyToString(raw),
        });
        explanation.push(
          `${unitsToString(overlapUnits)} ${unitLabel} at ` +
            `${formatMoney(slabAmount, ratePlan.currency)} = ${formatMoney(raw, ratePlan.currency)}.`,
        );
      }
    }

    if (lines.filter((l) => l.kind === ChargeLineKind.SLAB).length === 0) {
      // Validation guarantees a ladder covering position 1 upward, so reaching
      // here means the plan does not cover the length of this stay.
      throw new AppException(
        ErrorCode.RATE_PLAN_INVALID,
        `Rate plan "${ratePlan.code}" has no slab covering this stay length.`,
        {
          details: {
            ratePlanCode: ratePlan.code,
            chargeableUnits: unitsToString(chargeableUnits),
            ladderRange: [unitsToString(rangeStart), unitsToString(rangeEnd)],
          },
        },
      );
    }

    // Sum the UNROUNDED values, then round once.
    let subtotal = money(sumExact(rawLineAmounts));

    /* --- 4. Daily cap --------------------------------------------- */
    // Chiefly for hourly public-parking tariffs: "₹20/hour, ₹200 per day max".
    if (ratePlan.dailyCapAmount) {
      const capPerDay = toDecimal(ratePlan.dailyCapAmount);
      const cappedDays = Math.max(1, Math.ceil(duration.rawMinutes / 1440));
      const cap = money(capPerDay.times(cappedDays));
      if (subtotal.greaterThan(cap)) {
        const adjustment = money(cap.minus(subtotal));
        lines.push({
          lineNo: lineNo++,
          kind: ChargeLineKind.DAILY_CAP_ADJUSTMENT,
          description:
            `Daily cap applied - ${formatMoney(capPerDay, ratePlan.currency)} x ${cappedDays} day(s)`,
          fromUnit: null,
          toUnit: null,
          units: unitsToString(cappedDays),
          unitAmount: moneyToString(capPerDay),
          amount: moneyToString(adjustment),
        });
        explanation.push(
          `Daily cap reduces ${formatMoney(subtotal, ratePlan.currency)} to ` +
            `${formatMoney(cap, ratePlan.currency)}.`,
        );
        subtotal = cap;
      }
    }

    /* --- 5. Minimum charge ---------------------------------------- */
    if (ratePlan.minimumChargeAmount) {
      const minimum = money(ratePlan.minimumChargeAmount);
      if (subtotal.lessThan(minimum)) {
        const uplift = money(minimum.minus(subtotal));
        lines.push({
          lineNo: lineNo++,
          kind: ChargeLineKind.MINIMUM_CHARGE,
          description: `Minimum charge top-up to ${formatMoney(minimum, ratePlan.currency)}`,
          fromUnit: null,
          toUnit: null,
          units: unitsToString(0),
          unitAmount: moneyToString(uplift),
          amount: moneyToString(uplift),
        });
        explanation.push(
          `Minimum charge of ${formatMoney(minimum, ratePlan.currency)} applies ` +
            `(computed ${formatMoney(subtotal, ratePlan.currency)}).`,
        );
        subtotal = minimum;
      }
    }

    explanation.push(`Subtotal: ${formatMoney(subtotal, ratePlan.currency)}.`);

    /* --- 6. Tax ---------------------------------------------------- */
    const { taxLines, taxTotal } = applyTaxes(subtotal, ratePlan, explanation, lineNo);

    return buildResult({
      input,
      duration,
      totalUnits,
      freeUnits,
      chargeableUnits,
      lines,
      taxLines,
      subtotal,
      taxTotal,
      explanation,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Tax                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Applies the configured tax components.
 *
 * No rate is hardcoded anywhere: GST treatment is a business decision Sri JP
 * has not supplied (open item OI-06), so a plan with no tax profile simply
 * produces no tax lines rather than the engine guessing 18%.
 */
function applyTaxes(
  subtotal: Decimal,
  ratePlan: RatePlanSnapshot,
  explanation: string[],
  startLineNo: number,
): { taxLines: ChargeBreakdownLine[]; taxTotal: Decimal } {
  const profile = ratePlan.taxProfile;
  if (!profile || profile.components.length === 0) {
    explanation.push('No tax profile is configured for this rate plan, so no tax is applied.');
    return { taxLines: [], taxTotal: money(0) };
  }

  const taxLines: ChargeBreakdownLine[] = [];
  const rawAmounts: Decimal[] = [];
  let runningTotal = subtotal;
  let lineNo = startLineNo;

  for (const component of [...profile.components].sort((a, b) => a.sequence - b.sequence)) {
    const base = component.base === 'RUNNING_TOTAL' ? runningTotal : subtotal;
    const rate = toDecimal(component.rate);

    const raw = component.kind === 'PERCENTAGE' ? base.times(rate) : rate;
    rawAmounts.push(raw);
    runningTotal = runningTotal.plus(raw);

    taxLines.push({
      lineNo: lineNo++,
      kind: ChargeLineKind.TAX,
      description:
        component.kind === 'PERCENTAGE'
          ? `${component.name} @ ${rate.times(100).toFixed(2)}%`
          : `${component.name} (fixed)`,
      fromUnit: null,
      toUnit: null,
      units: unitsToString(1),
      unitAmount: moneyToString(rate),
      amount: moneyToString(raw),
    });

    explanation.push(
      `${component.name}: ${formatMoney(raw, ratePlan.currency)} ` +
        `on ${formatMoney(base, ratePlan.currency)}.`,
    );
  }

  return { taxLines, taxTotal: money(sumExact(rawAmounts)) };
}

/* ------------------------------------------------------------------ */
/* Result assembly                                                     */
/* ------------------------------------------------------------------ */

function buildResult(args: {
  input: ChargeInput;
  duration: { rawMinutes: number };
  totalUnits: Decimal;
  freeUnits: Decimal;
  chargeableUnits: Decimal;
  lines: ChargeBreakdownLine[];
  taxLines: ChargeBreakdownLine[];
  subtotal: Decimal;
  taxTotal: Decimal;
  explanation: string[];
}): ChargeBreakdown {
  const { input, duration, lines, taxLines, subtotal, taxTotal, explanation } = args;
  const total = addMoney(subtotal, taxTotal);

  if (taxTotal.greaterThan(0)) {
    explanation.push(`Total: ${formatMoney(total, input.ratePlan.currency)}.`);
  }

  return {
    engineVersion: ENGINE_VERSION,
    currency: input.ratePlan.currency,
    billingUnit: input.ratePlan.billingUnit,
    roundingMode: input.ratePlan.roundingMode,
    freeUnitPolicy: input.ratePlan.freeUnitPolicy,

    entryAt: input.entryAt.toISOString(),
    asOf: input.asOf.toISOString(),
    timezone: input.timezone,

    rawDurationMinutes: duration.rawMinutes,
    graceMinutes: input.ratePlan.graceMinutes,
    totalUnits: unitsToString(args.totalUnits),
    freeUnits: unitsToString(args.freeUnits),
    chargeableUnits: unitsToString(args.chargeableUnits),

    lines,
    taxLines,

    subtotal: subtotal.toFixed(MONEY_SCALE),
    taxTotal: taxTotal.toFixed(MONEY_SCALE),
    total: total.toFixed(MONEY_SCALE),

    explanation,
    inputsHash: computeInputsHash(input),
    ratePlanId: input.ratePlan.id,
    ratePlanName: input.ratePlan.name,
  };
}

/**
 * Stable hash of everything that can affect the output.
 *
 * `capturedAt` is deliberately excluded: two snapshots of the same plan taken a
 * second apart must hash identically, or reproducibility checks would produce
 * false alarms.
 */
export function computeInputsHash(input: ChargeInput): string {
  const plan = input.ratePlan;
  return stableHash({
    engineVersion: ENGINE_VERSION,
    entryAt: input.entryAt.toISOString(),
    asOf: input.asOf.toISOString(),
    timezone: input.timezone,
    plan: {
      id: plan.id,
      billingUnit: plan.billingUnit,
      roundingMode: plan.roundingMode,
      freeUnits: plan.freeUnits,
      freeUnitPolicy: plan.freeUnitPolicy,
      graceMinutes: plan.graceMinutes,
      minimumChargeAmount: plan.minimumChargeAmount ?? null,
      dailyCapAmount: plan.dailyCapAmount ?? null,
      currency: plan.currency,
      slabs: [...plan.slabs]
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => ({
          sequence: s.sequence,
          fromUnit: s.fromUnit,
          toUnit: s.toUnit ?? null,
          kind: s.kind,
          amount: s.amount,
        })),
      tax: plan.taxProfile
        ? {
            code: plan.taxProfile.code,
            components: [...plan.taxProfile.components]
              .sort((a, b) => a.sequence - b.sequence)
              .map((c) => ({
                sequence: c.sequence,
                code: c.code,
                kind: c.kind,
                rate: c.rate,
                base: c.base,
              })),
          }
        : null,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Rejects a rate plan that cannot price a stay correctly.
 *
 * Run at plan-authoring time too (see RatePlanService), so a broken ladder is
 * caught by the person editing it rather than at midnight during accrual.
 *
 * @throws AppException RATE_PLAN_INVALID, RATE_SLABS_NOT_CONTIGUOUS,
 *         RATE_SLABS_OVERLAP
 */
export function validateRatePlan(plan: RatePlanSnapshot): void {
  if (!plan.slabs || plan.slabs.length === 0) {
    throw new AppException(
      ErrorCode.RATE_PLAN_INVALID,
      `Rate plan "${plan.code}" has no rate slabs.`,
      { details: { ratePlanCode: plan.code } },
    );
  }

  const slabs = [...plan.slabs].sort((a, b) => a.sequence - b.sequence);

  const first = slabs[0] as RateSlabSnapshot;
  if (!toDecimal(first.fromUnit).equals(1)) {
    throw new AppException(
      ErrorCode.RATE_SLABS_NOT_CONTIGUOUS,
      `Rate plan "${plan.code}" must start at unit 1 (starts at ${first.fromUnit}).`,
      { details: { ratePlanCode: plan.code, firstFromUnit: first.fromUnit } },
    );
  }

  for (let i = 0; i < slabs.length; i++) {
    const slab = slabs[i] as RateSlabSnapshot;
    const from = toDecimal(slab.fromUnit);
    const to = slab.toUnit === null || slab.toUnit === undefined ? null : toDecimal(slab.toUnit);

    if (to !== null && to.lessThan(from)) {
      throw new AppException(
        ErrorCode.RATE_PLAN_INVALID,
        `Slab ${slab.sequence} of "${plan.code}" ends (${slab.toUnit}) before it starts (${slab.fromUnit}).`,
        { details: { ratePlanCode: plan.code, sequence: slab.sequence } },
      );
    }
    if (toDecimal(slab.amount).isNegative()) {
      throw new AppException(
        ErrorCode.RATE_PLAN_INVALID,
        `Slab ${slab.sequence} of "${plan.code}" has a negative amount.`,
        { details: { ratePlanCode: plan.code, sequence: slab.sequence } },
      );
    }

    const next = slabs[i + 1];
    if (!next) {
      // Only the final slab may be open-ended. Any other unbounded slab would
      // swallow the rest of the ladder and make later slabs unreachable.
      continue;
    }
    if (to === null) {
      throw new AppException(
        ErrorCode.RATE_PLAN_INVALID,
        `Slab ${slab.sequence} of "${plan.code}" is open-ended but is not the last slab.`,
        { details: { ratePlanCode: plan.code, sequence: slab.sequence } },
      );
    }

    const nextFrom = toDecimal(next.fromUnit);
    if (nextFrom.lessThanOrEqualTo(to)) {
      throw new AppException(
        ErrorCode.RATE_SLABS_OVERLAP,
        `Slabs ${slab.sequence} and ${next.sequence} of "${plan.code}" overlap.`,
        {
          details: {
            ratePlanCode: plan.code,
            slab: { sequence: slab.sequence, toUnit: slab.toUnit },
            next: { sequence: next.sequence, fromUnit: next.fromUnit },
          },
        },
      );
    }
    if (!nextFrom.equals(to.plus(1))) {
      throw new AppException(
        ErrorCode.RATE_SLABS_NOT_CONTIGUOUS,
        `Gap between slabs ${slab.sequence} and ${next.sequence} of "${plan.code}": ` +
          `${slab.toUnit} then ${next.fromUnit}.`,
        {
          details: {
            ratePlanCode: plan.code,
            gapAfterUnit: slab.toUnit,
            resumesAtUnit: next.fromUnit,
          },
        },
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

function unitNoun(billingUnit: string): string {
  switch (billingUnit) {
    case 'MINUTE': return 'minutes';
    case 'HOUR': return 'hours';
    case 'DAY': return 'days';
    case 'CALENDAR_DAY': return 'calendar days';
    case 'WEEK': return 'weeks';
    case 'MONTH': return 'months';
    default: return 'units';
  }
}

function describeSlabRange(slab: RateSlabSnapshot, unitLabel: string): string {
  const capitalised = unitLabel.charAt(0).toUpperCase() + unitLabel.slice(1);
  const from = toDecimal(slab.fromUnit).toNumber();
  if (slab.toUnit === null || slab.toUnit === undefined) {
    return `${capitalised} ${from} onwards`;
  }
  const to = toDecimal(slab.toUnit).toNumber();
  return from === to ? `${capitalised} ${from}` : `${capitalised} ${from}-${to}`;
}
