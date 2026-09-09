/**
 * Freezing a rate plan at admission.
 *
 * This is the mechanism that makes a bill defensible months later: the plan in
 * force when the vehicle arrived is copied into the session, so re-pricing a
 * stay cannot be changed by someone editing the live rate card afterwards.
 *
 * The property that matters most here is that **every number becomes a
 * fixed-scale decimal string**. The snapshot is stored in a JSON column, and a
 * JSON number is an IEEE-754 double - round-tripping a rate through one would
 * quietly corrupt it. Fixed scale additionally means two snapshots of the same
 * plan serialise byte-identically, which is what makes `inputsHash` comparisons
 * mean anything.
 */

import { Prisma } from '@prisma/client';

import {
  RatePlanWithSlabs,
  TaxProfileWithComponents,
  buildRatePlanSnapshot,
  buildTaxProfileSnapshot,
  parseRatePlanSnapshot,
} from './rate-plan-snapshot';

const dec = (value: string | number): Prisma.Decimal => new Prisma.Decimal(value);

function ratePlan(overrides: Partial<RatePlanWithSlabs> = {}): RatePlanWithSlabs {
  return {
    id: 'plan-1',
    organizationId: 'org-1',
    code: 'RP-TEST',
    name: 'Test plan',
    scope: 'CONTRACT',
    billingUnit: 'DAY',
    roundingMode: 'CEIL',
    freeUnits: dec(7),
    freeUnitPolicy: 'SKIP_LADDER',
    graceMinutes: 30,
    minimumChargeAmount: dec('100.5'),
    dailyCapAmount: null,
    currency: 'INR',
    contractVersionId: 'cv-1',
    siteId: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    slabs: [],
    ...overrides,
  } as unknown as RatePlanWithSlabs;
}

function slab(sequence: number, fromUnit: number, toUnit: number | null, amount: string) {
  return {
    id: `slab-${sequence}`,
    ratePlanId: 'plan-1',
    sequence,
    fromUnit: dec(fromUnit),
    toUnit: toUnit === null ? null : dec(toUnit),
    kind: 'PER_UNIT',
    amount: dec(amount),
    description: `Days ${fromUnit}-${toUnit ?? 'onwards'}`,
  } as unknown as RatePlanWithSlabs['slabs'][number];
}

function taxProfile(overrides: Partial<TaxProfileWithComponents> = {}): TaxProfileWithComponents {
  return {
    id: 'tax-1',
    organizationId: 'org-1',
    code: 'GST-18',
    name: 'GST 18%',
    isDefault: true,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    components: [],
    ...overrides,
  } as unknown as TaxProfileWithComponents;
}

function taxComponent(sequence: number, code: string, rate: string, isActive = true) {
  return {
    id: `tc-${sequence}`,
    taxProfileId: 'tax-1',
    sequence,
    code,
    name: code,
    kind: 'PERCENTAGE',
    rate: dec(rate),
    base: 'SUBTOTAL',
    hsnSac: '996749',
    isActive,
  } as unknown as TaxProfileWithComponents['components'][number];
}

/* ------------------------------------------------------------------ */

describe('buildRatePlanSnapshot', () => {
  it('copies the plan identity and terms', () => {
    const snapshot = buildRatePlanSnapshot(ratePlan());

    expect(snapshot.id).toBe('plan-1');
    expect(snapshot.code).toBe('RP-TEST');
    expect(snapshot.billingUnit).toBe('DAY');
    expect(snapshot.roundingMode).toBe('CEIL');
    expect(snapshot.freeUnitPolicy).toBe('SKIP_LADDER');
    expect(snapshot.graceMinutes).toBe(30);
    expect(snapshot.currency).toBe('INR');
    expect(snapshot.contractVersionId).toBe('cv-1');
  });

  describe('every amount is a fixed-scale string, never a number', () => {
    it('renders money at the money scale', () => {
      const snapshot = buildRatePlanSnapshot(
        ratePlan({ minimumChargeAmount: dec('100.5'), dailyCapAmount: dec('2000') }),
      );

      expect(typeof snapshot.minimumChargeAmount).toBe('string');
      expect(snapshot.minimumChargeAmount).toBe('100.5000');
      expect(snapshot.dailyCapAmount).toBe('2000.0000');
    });

    it('renders units at the unit scale', () => {
      const snapshot = buildRatePlanSnapshot(ratePlan({ freeUnits: dec(7) }));

      expect(typeof snapshot.freeUnits).toBe('string');
      expect(snapshot.freeUnits).toMatch(/^7\.0+$/);
    });

    it('renders slab amounts and boundaries as strings', () => {
      const snapshot = buildRatePlanSnapshot(
        ratePlan({ slabs: [slab(1, 1, 30, '100'), slab(2, 31, null, '60.25')] }),
      );

      for (const line of snapshot.slabs) {
        expect(typeof line.amount).toBe('string');
        expect(typeof line.fromUnit).toBe('string');
      }
      expect(snapshot.slabs[0]!.amount).toBe('100.0000');
      expect(snapshot.slabs[1]!.amount).toBe('60.2500');
    });

    it('contains no JSON numbers anywhere a money value could hide', () => {
      // The whole point: serialise the snapshot and confirm nothing monetary
      // survived as a double.
      const snapshot = buildRatePlanSnapshot(
        ratePlan({ slabs: [slab(1, 1, 30, '100'), slab(2, 31, null, '0.1')] }),
        taxProfile({ components: [taxComponent(1, 'CGST', '0.09')] }),
      );

      const roundTripped = JSON.parse(JSON.stringify(snapshot));

      expect(typeof roundTripped.minimumChargeAmount).toBe('string');
      expect(typeof roundTripped.freeUnits).toBe('string');
      for (const line of roundTripped.slabs) {
        expect(typeof line.amount).toBe('string');
        expect(typeof line.fromUnit).toBe('string');
      }
      for (const component of roundTripped.taxProfile.components) {
        expect(typeof component.rate).toBe('string');
      }
    });

    it('does not lose precision on a value a double would mangle', () => {
      // 0.1 + 0.2 famously is not 0.3 in binary floating point. A rate stored
      // as a string cannot suffer that on the way back out.
      const snapshot = buildRatePlanSnapshot(ratePlan({ slabs: [slab(1, 1, null, '0.1')] }));
      expect(snapshot.slabs[0]!.amount).toBe('0.1000');
    });
  });

  describe('slab ordering', () => {
    it('sorts slabs by sequence regardless of the order the rows arrive in', () => {
      // Row order from the database is not guaranteed without an ORDER BY, and
      // a ladder evaluated out of order prices the wrong band first.
      const snapshot = buildRatePlanSnapshot(
        ratePlan({ slabs: [slab(3, 61, null, '40'), slab(1, 1, 30, '100'), slab(2, 31, 60, '60')] }),
      );

      expect(snapshot.slabs.map((s) => s.sequence)).toEqual([1, 2, 3]);
      expect(snapshot.slabs.map((s) => s.amount)).toEqual(['100.0000', '60.0000', '40.0000']);
    });

    it('does not mutate the caller’s array while sorting', () => {
      const slabs = [slab(3, 61, null, '40'), slab(1, 1, 30, '100')];
      const original = slabs.map((s) => s.sequence);

      buildRatePlanSnapshot(ratePlan({ slabs }));

      expect(slabs.map((s) => s.sequence)).toEqual(original);
    });

    it('preserves an open-ended final slab', () => {
      const snapshot = buildRatePlanSnapshot(ratePlan({ slabs: [slab(1, 31, null, '40')] }));
      expect(snapshot.slabs[0]!.toUnit).toBeNull();
    });

    it('handles a plan with no slabs', () => {
      expect(buildRatePlanSnapshot(ratePlan({ slabs: [] })).slabs).toEqual([]);
    });
  });

  describe('optional values', () => {
    it('keeps a null minimum charge null rather than coercing to zero', () => {
      // "No minimum" and "a minimum of zero" are different contract terms.
      const snapshot = buildRatePlanSnapshot(ratePlan({ minimumChargeAmount: null }));
      expect(snapshot.minimumChargeAmount).toBeNull();
    });

    it('keeps a null daily cap null', () => {
      expect(buildRatePlanSnapshot(ratePlan({ dailyCapAmount: null })).dailyCapAmount).toBeNull();
    });

    it('renders a genuine zero minimum as a zero string, not null', () => {
      // The guard in the builder is `value ? money(value) : null`. A
      // Prisma.Decimal is an object, so Decimal(0) is truthy and survives as
      // "0.0000" - which is what we want, because "a minimum of zero" and "no
      // minimum" are different contract terms and must stay distinguishable.
      // Had the field been a plain JS number, 0 would be falsy and this would
      // silently collapse to null.
      const snapshot = buildRatePlanSnapshot(ratePlan({ minimumChargeAmount: dec(0) }));

      expect(snapshot.minimumChargeAmount).toBe('0.0000');
      expect(snapshot.minimumChargeAmount).not.toBeNull();
    });

    it('records no tax profile when none applies', () => {
      expect(buildRatePlanSnapshot(ratePlan()).taxProfile).toBeNull();
      expect(buildRatePlanSnapshot(ratePlan(), null).taxProfile).toBeNull();
    });
  });

  it('stamps the capture time so the snapshot can be dated', () => {
    const before = Date.now();
    const snapshot = buildRatePlanSnapshot(ratePlan());
    const capturedAt = Date.parse(snapshot.capturedAt);

    expect(Number.isNaN(capturedAt)).toBe(false);
    expect(capturedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(snapshot.capturedAt).toMatch(/Z$/); // UTC, not local
  });
});

describe('buildTaxProfileSnapshot', () => {
  it('renders rates at six decimal places', () => {
    // A 9% component is 0.090000. Truncating to two places would make it 0.09
    // of a rupee rather than 9 percent on every invoice.
    const snapshot = buildTaxProfileSnapshot(
      taxProfile({ components: [taxComponent(1, 'CGST', '0.09')] }),
    );

    expect(snapshot.components[0]!.rate).toBe('0.090000');
  });

  it('excludes inactive components', () => {
    // A repealed cess must stop appearing on new invoices without being
    // deleted from history.
    const snapshot = buildTaxProfileSnapshot(
      taxProfile({
        components: [
          taxComponent(1, 'CGST', '0.09'),
          taxComponent(2, 'OLD_CESS', '0.01', false),
          taxComponent(3, 'SGST', '0.09'),
        ],
      }),
    );

    expect(snapshot.components.map((c) => c.code)).toEqual(['CGST', 'SGST']);
  });

  it('sorts components by sequence', () => {
    const snapshot = buildTaxProfileSnapshot(
      taxProfile({
        components: [taxComponent(2, 'SGST', '0.09'), taxComponent(1, 'CGST', '0.09')],
      }),
    );

    expect(snapshot.components.map((c) => c.code)).toEqual(['CGST', 'SGST']);
  });

  it('carries the HSN/SAC code through for the invoice', () => {
    const snapshot = buildTaxProfileSnapshot(
      taxProfile({ components: [taxComponent(1, 'CGST', '0.09')] }),
    );
    expect(snapshot.components[0]!.hsnSac).toBe('996749');
  });

  it('handles a profile with no active components', () => {
    const snapshot = buildTaxProfileSnapshot(
      taxProfile({ components: [taxComponent(1, 'OLD', '0.05', false)] }),
    );
    expect(snapshot.components).toEqual([]);
  });
});

describe('parseRatePlanSnapshot', () => {
  const valid = () =>
    JSON.parse(
      JSON.stringify(buildRatePlanSnapshot(ratePlan({ slabs: [slab(1, 1, 30, '100')] }))),
    ) as Prisma.JsonValue;

  it('round-trips a snapshot it built', () => {
    const parsed = parseRatePlanSnapshot(valid());

    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe('plan-1');
    expect(parsed!.slabs).toHaveLength(1);
    expect(parsed!.slabs[0]!.amount).toBe('100.0000');
  });

  describe('returns null rather than throwing on anything malformed', () => {
    // The caller falls back to the live plan and flags the session. A nightly
    // accrual run must not abort on one bad row.
    it.each<[string, Prisma.JsonValue]>([
      ['null', null],
      ['a string', 'not a snapshot' as Prisma.JsonValue],
      ['a number', 42 as Prisma.JsonValue],
      ['a boolean', true as Prisma.JsonValue],
      ['an array', [] as unknown as Prisma.JsonValue],
      ['an empty object', {} as Prisma.JsonValue],
      ['a missing id', { billingUnit: 'DAY', slabs: [] } as unknown as Prisma.JsonValue],
      ['a missing billingUnit', { id: 'x', slabs: [] } as unknown as Prisma.JsonValue],
      ['missing slabs', { id: 'x', billingUnit: 'DAY' } as unknown as Prisma.JsonValue],
      [
        'slabs that are not an array',
        { id: 'x', billingUnit: 'DAY', slabs: 'nope' } as unknown as Prisma.JsonValue,
      ],
      [
        'a non-string id',
        { id: 7, billingUnit: 'DAY', slabs: [] } as unknown as Prisma.JsonValue,
      ],
    ])('rejects %s', (_label, value) => {
      expect(parseRatePlanSnapshot(value)).toBeNull();
    });
  });
});

describe('snapshot stability', () => {
  it('serialises two snapshots of the same plan identically, apart from the timestamp', () => {
    // This is what makes inputsHash comparisons meaningful: the same plan must
    // not produce two different byte sequences.
    const plan = ratePlan({ slabs: [slab(2, 31, null, '60'), slab(1, 1, 30, '100')] });
    const profile = taxProfile({ components: [taxComponent(1, 'CGST', '0.09')] });

    const first = buildRatePlanSnapshot(plan, profile);
    const second = buildRatePlanSnapshot(plan, profile);

    const strip = (s: ReturnType<typeof buildRatePlanSnapshot>) =>
      JSON.stringify({ ...s, capturedAt: 'FIXED' });

    expect(strip(first)).toBe(strip(second));
  });

  it('produces a different serialisation when a rate actually changes', () => {
    const strip = (s: ReturnType<typeof buildRatePlanSnapshot>) =>
      JSON.stringify({ ...s, capturedAt: 'FIXED' });

    const before = buildRatePlanSnapshot(ratePlan({ slabs: [slab(1, 1, null, '100')] }));
    const after = buildRatePlanSnapshot(ratePlan({ slabs: [slab(1, 1, null, '110')] }));

    expect(strip(before)).not.toBe(strip(after));
  });
});
