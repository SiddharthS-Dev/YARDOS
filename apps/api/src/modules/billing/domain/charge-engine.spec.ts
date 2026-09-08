import { AppException } from '@/common/errors/app-exception';
import { ChargeEngine, ENGINE_VERSION, computeInputsHash, validateRatePlan } from './charge-engine';
import type { RatePlanSnapshot, RateSlabSnapshot } from './rate-plan.types';

/**
 * Charge engine specification.
 *
 * These tests are the executable statement of how Sri JP's money is computed.
 * The amounts used are ARBITRARY TEST VALUES chosen to make arithmetic errors
 * obvious - they are not Sri JP commercial rates, which have not been supplied
 * (see docs/open-items.md OI-05).
 */

const IST = 'Asia/Kolkata';

function slab(
  sequence: number,
  fromUnit: number,
  toUnit: number | null,
  amount: string,
  kind: 'PER_UNIT' | 'FLAT' = 'PER_UNIT',
): RateSlabSnapshot {
  return {
    id: `slab-${sequence}`,
    sequence,
    fromUnit: String(fromUnit),
    toUnit: toUnit === null ? null : String(toUnit),
    kind,
    amount,
  };
}

function plan(overrides: Partial<RatePlanSnapshot> = {}): RatePlanSnapshot {
  return {
    id: 'plan-1',
    code: 'TEST-PLAN',
    name: 'Test plan',
    scope: 'CONTRACT',
    billingUnit: 'DAY',
    roundingMode: 'CEIL',
    freeUnits: '0',
    freeUnitPolicy: 'SKIP_LADDER',
    graceMinutes: 0,
    currency: 'INR',
    slabs: [slab(1, 1, null, '100.0000')],
    capturedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Adds whole days to an instant. */
function daysAfter(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

const ENTRY = new Date('2025-08-12T08:43:00.000Z');

describe('ChargeEngine', () => {
  describe('flat daily rate', () => {
    it('charges one day per elapsed day', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 5),
        timezone: IST,
        ratePlan: plan(),
      });

      expect(result.totalUnits).toBe('5.000000');
      expect(result.chargeableUnits).toBe('5.000000');
      expect(result.subtotal).toBe('500.0000');
      expect(result.taxTotal).toBe('0.0000');
      expect(result.total).toBe('500.0000');
    });

    it('rounds a part day up under CEIL', () => {
      // 5 days and 1 hour must bill as 6 days.
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(daysAfter(ENTRY, 5).getTime() + 3_600_000),
        timezone: IST,
        ratePlan: plan(),
      });
      expect(result.totalUnits).toBe('6.000000');
      expect(result.total).toBe('600.0000');
    });

    it('discards a part day under FLOOR', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(daysAfter(ENTRY, 5).getTime() + 3_600_000),
        timezone: IST,
        ratePlan: plan({ roundingMode: 'FLOOR' }),
      });
      expect(result.totalUnits).toBe('5.000000');
      expect(result.total).toBe('500.0000');
    });

    it('rounds to the closer day under NEAREST', () => {
      const thirteenHours = 13 * 3_600_000;
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(daysAfter(ENTRY, 5).getTime() + thirteenHours),
        timezone: IST,
        ratePlan: plan({ roundingMode: 'NEAREST' }),
      });
      expect(result.totalUnits).toBe('6.000000');
    });
  });

  describe('slab ladder', () => {
    // Days 1-30 at 100, days 31-40 at 60, day 41 onwards at 40.
    const laddered = () =>
      plan({
        slabs: [
          slab(1, 1, 30, '100.0000'),
          slab(2, 31, 40, '60.0000'),
          slab(3, 41, null, '40.0000'),
        ],
      });

    it('prices a stay that spans every slab', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 47),
        timezone: IST,
        ratePlan: laddered(),
      });

      // 30 x 100 + 10 x 60 + 7 x 40 = 3000 + 600 + 280
      expect(result.subtotal).toBe('3880.0000');
      const slabLines = result.lines.filter((l) => l.kind === 'SLAB');
      expect(slabLines).toHaveLength(3);
      expect(slabLines[0]).toMatchObject({ fromUnit: 1, toUnit: 30, amount: '3000.0000' });
      expect(slabLines[1]).toMatchObject({ fromUnit: 31, toUnit: 40, amount: '600.0000' });
      expect(slabLines[2]).toMatchObject({ fromUnit: 41, toUnit: 47, amount: '280.0000' });
    });

    it('stops at the slab that contains the final unit', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 35),
        timezone: IST,
        ratePlan: laddered(),
      });
      // 30 x 100 + 5 x 60
      expect(result.subtotal).toBe('3300.0000');
      expect(result.lines.filter((l) => l.kind === 'SLAB')).toHaveLength(2);
    });

    it('applies a FLAT slab once regardless of units inside it', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 20),
        timezone: IST,
        ratePlan: plan({
          slabs: [slab(1, 1, 7, '500.0000', 'FLAT'), slab(2, 8, null, '80.0000')],
        }),
      });
      // 500 once + 13 x 80
      expect(result.subtotal).toBe('1540.0000');
    });
  });

  describe('free allowance', () => {
    const laddered = () =>
      plan({
        freeUnits: '7',
        slabs: [
          slab(1, 1, 30, '100.0000'),
          slab(2, 31, 40, '60.0000'),
          slab(3, 41, null, '40.0000'),
        ],
      });

    it('SKIP_LADDER reprices the chargeable days from position 1', () => {
      // The worked example in the requirements: 47 days, 7 free, 40 chargeable,
      // billed as days 1-30 then 31-40 of the CHARGEABLE range.
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 47),
        timezone: IST,
        ratePlan: laddered(),
      });

      expect(result.totalUnits).toBe('47.000000');
      expect(result.freeUnits).toBe('7.000000');
      expect(result.chargeableUnits).toBe('40.000000');

      // 30 x 100 + 10 x 60 = 3600
      expect(result.subtotal).toBe('3600.0000');

      const slabLines = result.lines.filter((l) => l.kind === 'SLAB');
      expect(slabLines).toHaveLength(2);
      expect(slabLines[0]).toMatchObject({ fromUnit: 1, toUnit: 30 });
      expect(slabLines[1]).toMatchObject({ fromUnit: 31, toUnit: 40 });

      // The waiver is stated explicitly rather than being invisible.
      const freeLine = result.lines.find((l) => l.kind === 'FREE_ALLOWANCE');
      expect(freeLine).toMatchObject({ units: '7.000000', amount: '0.0000' });
    });

    it('CONSUME_LADDER keeps the day counter running from entry', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 47),
        timezone: IST,
        ratePlan: { ...laddered(), freeUnitPolicy: 'CONSUME_LADDER' },
      });

      // Charges ladder positions 8..47: 23 x 100 + 10 x 60 + 7 x 40 = 3180
      expect(result.chargeableUnits).toBe('40.000000');
      expect(result.subtotal).toBe('3180.0000');

      const slabLines = result.lines.filter((l) => l.kind === 'SLAB');
      expect(slabLines[0]).toMatchObject({ fromUnit: 8, toUnit: 30 });
      expect(slabLines[2]).toMatchObject({ fromUnit: 41, toUnit: 47 });
    });

    it('charges nothing when the stay is inside the free allowance', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 5),
        timezone: IST,
        ratePlan: laddered(),
      });
      expect(result.chargeableUnits).toBe('0.000000');
      expect(result.total).toBe('0.0000');
      expect(result.lines.some((l) => l.kind === 'FREE_ALLOWANCE')).toBe(true);
    });

    it('never grants more free units than the stay length', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 3),
        timezone: IST,
        ratePlan: laddered(),
      });
      expect(result.freeUnits).toBe('3.000000');
    });
  });

  describe('grace period', () => {
    it('charges nothing inside the grace window', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(ENTRY.getTime() + 10 * 60_000),
        timezone: IST,
        ratePlan: plan({ billingUnit: 'HOUR', graceMinutes: 15, slabs: [slab(1, 1, null, '30')] }),
      });
      expect(result.total).toBe('0.0000');
      expect(result.lines[0]?.kind).toBe('GRACE');
    });

    it('charges the full stay once the grace window is exceeded', () => {
      // Grace is all-or-nothing: 16 minutes bills as a whole hour, not 1 minute.
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(ENTRY.getTime() + 16 * 60_000),
        timezone: IST,
        ratePlan: plan({ billingUnit: 'HOUR', graceMinutes: 15, slabs: [slab(1, 1, null, '30')] }),
      });
      expect(result.total).toBe('30.0000');
    });
  });

  describe('public parking tariffs', () => {
    // First hour 40, next hours 20, capped at 200 per day.
    const tariff = () =>
      plan({
        scope: 'SITE_TARIFF',
        billingUnit: 'HOUR',
        graceMinutes: 10,
        dailyCapAmount: '200.0000',
        slabs: [slab(1, 1, 1, '40.0000'), slab(2, 2, null, '20.0000')],
      });

    it('prices a short stay off the ladder', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(ENTRY.getTime() + 3 * 3_600_000),
        timezone: IST,
        ratePlan: tariff(),
      });
      // 1 x 40 + 2 x 20
      expect(result.total).toBe('80.0000');
    });

    it('applies the daily cap to a long stay', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(ENTRY.getTime() + 20 * 3_600_000),
        timezone: IST,
        ratePlan: tariff(),
      });
      // Uncapped: 40 + 19 x 20 = 420. One calendar day of cap = 200.
      expect(result.subtotal).toBe('200.0000');
      expect(result.lines.some((l) => l.kind === 'DAILY_CAP_ADJUSTMENT')).toBe(true);
    });

    it('scales the cap across multiple days', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(ENTRY.getTime() + 50 * 3_600_000),
        timezone: IST,
        ratePlan: tariff(),
      });
      // 50 hours spans 3 started days -> cap 600. Uncapped: 40 + 49 x 20 = 1020.
      expect(result.subtotal).toBe('600.0000');
    });
  });

  describe('minimum charge', () => {
    it('tops a small charge up to the floor', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(ENTRY.getTime() + 3_600_000),
        timezone: IST,
        ratePlan: plan({
          billingUnit: 'HOUR',
          minimumChargeAmount: '50.0000',
          slabs: [slab(1, 1, null, '20.0000')],
        }),
      });
      expect(result.subtotal).toBe('50.0000');
      expect(result.lines.some((l) => l.kind === 'MINIMUM_CHARGE')).toBe(true);
    });

    it('leaves a charge above the floor untouched', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: new Date(ENTRY.getTime() + 5 * 3_600_000),
        timezone: IST,
        ratePlan: plan({
          billingUnit: 'HOUR',
          minimumChargeAmount: '50.0000',
          slabs: [slab(1, 1, null, '20.0000')],
        }),
      });
      expect(result.subtotal).toBe('100.0000');
      expect(result.lines.some((l) => l.kind === 'MINIMUM_CHARGE')).toBe(false);
    });
  });

  describe('tax', () => {
    it('applies no tax when no profile is configured', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 2),
        timezone: IST,
        ratePlan: plan(),
      });
      expect(result.taxTotal).toBe('0.0000');
      expect(result.taxLines).toHaveLength(0);
      expect(result.explanation.join(' ')).toContain('No tax profile');
    });

    it('applies split percentage components on the subtotal', () => {
      // Two 9% components, as CGST/SGST would be configured. The RATES ARE TEST
      // VALUES: real GST configuration is an unresolved business item.
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 10),
        timezone: IST,
        ratePlan: plan({
          taxProfile: {
            code: 'TEST-SPLIT',
            name: 'Test split tax',
            components: [
              { sequence: 1, code: 'A', name: 'Component A', kind: 'PERCENTAGE', rate: '0.090000', base: 'SUBTOTAL' },
              { sequence: 2, code: 'B', name: 'Component B', kind: 'PERCENTAGE', rate: '0.090000', base: 'SUBTOTAL' },
            ],
          },
        }),
      });

      expect(result.subtotal).toBe('1000.0000');
      expect(result.taxTotal).toBe('180.0000');
      expect(result.total).toBe('1180.0000');
      expect(result.taxLines).toHaveLength(2);
    });

    it('compounds a RUNNING_TOTAL component on preceding tax', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 10),
        timezone: IST,
        ratePlan: plan({
          taxProfile: {
            code: 'TEST-CESS',
            name: 'Test compounding',
            components: [
              { sequence: 1, code: 'A', name: 'Base tax', kind: 'PERCENTAGE', rate: '0.100000', base: 'SUBTOTAL' },
              { sequence: 2, code: 'B', name: 'Cess', kind: 'PERCENTAGE', rate: '0.020000', base: 'RUNNING_TOTAL' },
            ],
          },
        }),
      });
      // 1000 + 100 = 1100; cess 2% of 1100 = 22
      expect(result.taxTotal).toBe('122.0000');
      expect(result.total).toBe('1122.0000');
    });

    it('supports a fixed-amount component', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 1),
        timezone: IST,
        ratePlan: plan({
          taxProfile: {
            code: 'TEST-FIXED',
            name: 'Fixed levy',
            components: [
              { sequence: 1, code: 'L', name: 'Levy', kind: 'FIXED', rate: '25.0000', base: 'SUBTOTAL' },
            ],
          },
        }),
      });
      expect(result.taxTotal).toBe('25.0000');
    });
  });

  describe('calendar-day billing', () => {
    it('counts the entry date as day one', () => {
      // 11:30 IST to 12:00 IST on the same date.
      const result = ChargeEngine.calculate({
        entryAt: new Date('2025-08-12T06:00:00.000Z'),
        asOf: new Date('2025-08-12T06:30:00.000Z'),
        timezone: IST,
        ratePlan: plan({ billingUnit: 'CALENDAR_DAY' }),
      });
      expect(result.totalUnits).toBe('1.000000');
      expect(result.total).toBe('100.0000');
    });

    it('counts a date boundary crossing as two days even for a short stay', () => {
      // 23:45 IST to 00:15 IST is 30 minutes but two calendar dates.
      const result = ChargeEngine.calculate({
        entryAt: new Date('2025-08-12T18:15:00.000Z'),
        asOf: new Date('2025-08-12T18:45:00.000Z'),
        timezone: IST,
        ratePlan: plan({ billingUnit: 'CALENDAR_DAY' }),
      });
      expect(result.totalUnits).toBe('2.000000');
      expect(result.total).toBe('200.0000');
    });

    it('uses the site timezone, not the server timezone', () => {
      // The same instants land on one UTC date but two IST dates.
      const entry = new Date('2025-08-12T17:00:00.000Z');
      const exit = new Date('2025-08-12T20:00:00.000Z');

      const ist = ChargeEngine.calculate({
        entryAt: entry, asOf: exit, timezone: IST,
        ratePlan: plan({ billingUnit: 'CALENDAR_DAY' }),
      });
      const utc = ChargeEngine.calculate({
        entryAt: entry, asOf: exit, timezone: 'UTC',
        ratePlan: plan({ billingUnit: 'CALENDAR_DAY' }),
      });

      expect(ist.totalUnits).toBe('2.000000');
      expect(utc.totalUnits).toBe('1.000000');
    });
  });

  describe('determinism and precision', () => {
    it('produces an identical result for identical inputs', () => {
      const input = {
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 33),
        timezone: IST,
        ratePlan: plan({ freeUnits: '7', slabs: [slab(1, 1, 30, '99.9900'), slab(2, 31, null, '49.5000')] }),
      };
      const a = ChargeEngine.calculate(input);
      const b = ChargeEngine.calculate(input);

      expect(a.total).toBe(b.total);
      expect(a.inputsHash).toBe(b.inputsHash);
      expect(a.engineVersion).toBe(ENGINE_VERSION);
    });

    it('hashes identically when only the snapshot capture time differs', () => {
      const base = plan();
      const later = { ...plan(), capturedAt: '2030-01-01T00:00:00.000Z' };
      const args = { entryAt: ENTRY, asOf: daysAfter(ENTRY, 2), timezone: IST };

      expect(computeInputsHash({ ...args, ratePlan: base })).toBe(
        computeInputsHash({ ...args, ratePlan: later }),
      );
    });

    it('hashes differently when a rate changes', () => {
      const args = { entryAt: ENTRY, asOf: daysAfter(ENTRY, 2), timezone: IST };
      const cheaper = plan({ slabs: [slab(1, 1, null, '100.0000')] });
      const dearer = plan({ slabs: [slab(1, 1, null, '101.0000')] });

      expect(computeInputsHash({ ...args, ratePlan: cheaper })).not.toBe(
        computeInputsHash({ ...args, ratePlan: dearer }),
      );
    });

    it('keeps fractional rates exact across a long ladder', () => {
      // 0.1 + 0.2 !== 0.3 in binary floating point. 3650 x 0.10 must be exactly
      // 365, not 364.99999999999994.
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 3650),
        timezone: IST,
        ratePlan: plan({ slabs: [slab(1, 1, null, '0.1000')] }),
      });
      expect(result.subtotal).toBe('365.0000');
    });

    it('sums unrounded line values so the total matches the ladder exactly', () => {
      // Each of 3 days at 33.3333 rounds to 33.3333; the total must be
      // 99.9999, and must not drift.
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 3),
        timezone: IST,
        ratePlan: plan({ slabs: [slab(1, 1, null, '33.3333')] }),
      });
      expect(result.subtotal).toBe('99.9999');
    });
  });

  describe('input validation', () => {
    it('rejects an exit before the entry', () => {
      expect(() =>
        ChargeEngine.calculate({
          entryAt: ENTRY,
          asOf: new Date(ENTRY.getTime() - 1000),
          timezone: IST,
          ratePlan: plan(),
        }),
      ).toThrow(AppException);
    });

    it('treats a zero-length stay as zero units', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: ENTRY,
        timezone: IST,
        ratePlan: plan(),
      });
      expect(result.totalUnits).toBe('0.000000');
      expect(result.total).toBe('0.0000');
    });
  });

  describe('validateRatePlan', () => {
    it('accepts a contiguous ladder', () => {
      expect(() =>
        validateRatePlan(plan({ slabs: [slab(1, 1, 10, '10'), slab(2, 11, null, '5')] })),
      ).not.toThrow();
    });

    it('rejects an empty ladder', () => {
      expect(() => validateRatePlan(plan({ slabs: [] }))).toThrow(/no rate slabs/i);
    });

    it('rejects a ladder that does not start at unit 1', () => {
      expect(() => validateRatePlan(plan({ slabs: [slab(1, 2, null, '10')] }))).toThrow(
        /must start at unit 1/i,
      );
    });

    it('rejects a gap between slabs', () => {
      expect(() =>
        validateRatePlan(plan({ slabs: [slab(1, 1, 10, '10'), slab(2, 12, null, '5')] })),
      ).toThrow(/gap between slabs/i);
    });

    it('rejects overlapping slabs', () => {
      expect(() =>
        validateRatePlan(plan({ slabs: [slab(1, 1, 10, '10'), slab(2, 9, null, '5')] })),
      ).toThrow(/overlap/i);
    });

    it('rejects an open-ended slab that is not last', () => {
      expect(() =>
        validateRatePlan(plan({ slabs: [slab(1, 1, null, '10'), slab(2, 11, 20, '5')] })),
      ).toThrow(/open-ended but is not the last/i);
    });

    it('rejects a negative amount', () => {
      expect(() => validateRatePlan(plan({ slabs: [slab(1, 1, null, '-5')] }))).toThrow(
        /negative amount/i,
      );
    });

    it('rejects a slab that ends before it starts', () => {
      expect(() =>
        validateRatePlan(plan({ slabs: [slab(1, 1, 10, '10'), slab(2, 11, 5, '5')] })),
      ).toThrow(/ends .* before it starts/i);
    });
  });

  describe('explainability', () => {
    it('records a narrative and a line for every step', () => {
      const result = ChargeEngine.calculate({
        entryAt: ENTRY,
        asOf: daysAfter(ENTRY, 47),
        timezone: IST,
        ratePlan: plan({
          freeUnits: '7',
          slabs: [slab(1, 1, 30, '100.0000'), slab(2, 31, null, '60.0000')],
          taxProfile: {
            code: 'T',
            name: 'Tax',
            components: [
              { sequence: 1, code: 'A', name: 'Tax A', kind: 'PERCENTAGE', rate: '0.090000', base: 'SUBTOTAL' },
            ],
          },
        }),
      });

      const narrative = result.explanation.join('\n');
      expect(narrative).toContain('Stay:');
      expect(narrative).toContain('Free allowance');
      expect(narrative).toContain('Subtotal');
      expect(narrative).toContain('Tax A');

      // Every line carries the workings, not just an amount.
      for (const line of result.lines) {
        expect(line.description.length).toBeGreaterThan(0);
        expect(line.amount).toMatch(/^-?\d+\.\d{4}$/);
      }
      // The stated total is exactly subtotal + tax.
      expect(Number(result.total)).toBeCloseTo(
        Number(result.subtotal) + Number(result.taxTotal),
        4,
      );
    });
  });
});
