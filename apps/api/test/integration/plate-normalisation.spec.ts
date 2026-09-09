/**
 * Plate normalisation.
 *
 * An ANPR camera, a gate operator typing on a tablet, and a financier pasting
 * from a spreadsheet will all render the same registration differently:
 *
 *   TN09AB1234    TN-09-AB-1234    TN 09 AB 1234    tn09ab1234
 *
 * These must all resolve to ONE vehicle. If they do not, the same physical car
 * accrues charges twice, appears in two places in the yard, and can be
 * released while still on site.
 *
 * The raw text is kept for the audit trail; the normalised form is what
 * matching uses.
 */

import {
  CHENNAI_YARD,
  SEED_USERS,
  Session,
  TestContext,
  anprDevice,
  createTestContext,
  hypothecatedPlate,
  normalisePlate,
  signIn,
  siteByCode,
} from '../setup/harness';

describe('registration number normalisation', () => {
  let ctx: TestContext;
  let yardStaff: Session;
  let deviceCode: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    yardStaff = await signIn(ctx, SEED_USERS.yardChennai);
    const site = await siteByCode(ctx, CHENNAI_YARD);
    deviceCode = (await anprDevice(ctx, site.id)).code;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /* ---------------------------------------------------------------- */

  describe('the normalised key', () => {
    // Formats seen in the wild across Indian registrations, including the
    // older series, BH (Bharat) series and defence plates.
    it.each([
      ['plain', 'TN09AB1234', 'TN09AB1234'],
      ['hyphenated', 'TN-09-AB-1234', 'TN09AB1234'],
      ['spaced', 'TN 09 AB 1234', 'TN09AB1234'],
      ['lower case', 'tn09ab1234', 'TN09AB1234'],
      ['mixed case and spaces', 'Tn 09 Ab 1234', 'TN09AB1234'],
      ['leading and trailing space', '  TN09AB1234  ', 'TN09AB1234'],
      ['single letter series', 'KA05C1234', 'KA05C1234'],
      ['three letter series', 'DL8CAF5030', 'DL8CAF5030'],
      ['BH series', '22 BH 1234 AA', '22BH1234AA'],
      ['dotted', 'TN.09.AB.1234', 'TN09AB1234'],
      ['slashed', 'TN/09/AB/1234', 'TN09AB1234'],
    ])('reduces a %s plate to the same key', (_label, input, expected) => {
      expect(normalisePlate(input)).toBe(expected);
    });
  });

  it('resolves four renderings of one plate to a single vehicle', async () => {
    const canonical = hypothecatedPlate();
    const normalised = normalisePlate(canonical);

    // The four ways the same car arrives in the system.
    const renderings = [
      canonical,
      canonical.replace(/^(..)(..)(..)(.*)$/, '$1-$2-$3-$4'),
      canonical.replace(/^(..)(..)(..)(.*)$/, '$1 $2 $3 $4'),
      canonical.toLowerCase(),
    ];

    const vehicleIds = new Set<string>();

    for (const rendering of renderings) {
      const response = await ctx
        .http()
        .post('/api/v1/anpr/simulate')
        .set(...yardStaff.auth())
        .send({ deviceCode, plateNumber: rendering, direction: 'ENTRY', confidence: 0.95 })
        .expect(202);

      if (response.body.decision?.vehicleId) {
        vehicleIds.add(response.body.decision.vehicleId);
      }
    }

    // One physical car, one row. Anything else means double billing.
    expect(vehicleIds.size).toBe(1);

    const rows = await ctx.prisma.vehicle.findMany({
      where: { normalizedRegistrationNumber: normalised },
    });
    expect(rows).toHaveLength(1);
  });

  it('keeps the raw text as captured, for the audit trail', async () => {
    const canonical = hypothecatedPlate();
    const spaced = canonical.replace(/^(..)(..)(..)(.*)$/, '$1 $2 $3 $4');

    await ctx
      .http()
      .post('/api/v1/anpr/simulate')
      .set(...yardStaff.auth())
      .send({ deviceCode, plateNumber: spaced, direction: 'ENTRY', confidence: 0.94 })
      .expect(202);

    const event = await ctx.prisma.anprEvent.findFirst({
      where: { normalizedPlate: normalisePlate(canonical) },
      orderBy: { receivedAt: 'desc' },
    });

    expect(event).toBeTruthy();
    // What the camera reported is preserved exactly; the normalised form sits
    // beside it rather than replacing it.
    expect(event!.plateNumberRaw).toBe(spaced);
    expect(event!.normalizedPlate).toBe(normalisePlate(canonical));
  });

  it('finds a vehicle by any rendering of its plate', async () => {
    const canonical = hypothecatedPlate();

    await ctx
      .http()
      .post('/api/v1/anpr/simulate')
      .set(...yardStaff.auth())
      .send({ deviceCode, plateNumber: canonical, direction: 'ENTRY', confidence: 0.96 })
      .expect(202);

    for (const query of [
      canonical,
      canonical.toLowerCase(),
      canonical.replace(/^(..)(..)(..)(.*)$/, '$1-$2-$3-$4'),
      canonical.replace(/^(..)(..)(..)(.*)$/, '$1 $2 $3 $4'),
    ]) {
      const response = await ctx
        .http()
        .get(`/api/v1/vehicles/search?q=${encodeURIComponent(query)}`)
        .set(...yardStaff.auth())
        .expect(200);

      const results = Array.isArray(response.body) ? response.body : response.body.items;
      const plates = (results as Array<{ registrationNumber: string }>).map((r) =>
        normalisePlate(r.registrationNumber),
      );

      expect(plates).toContain(normalisePlate(canonical));
    }
  });

  it('does not collapse two genuinely different plates', async () => {
    // Normalisation must remove formatting, not information.
    expect(normalisePlate('TN09AB1234')).not.toBe(normalisePlate('TN09AB1235'));
    expect(normalisePlate('TN09AB1234')).not.toBe(normalisePlate('TN90AB1234'));
    expect(normalisePlate('KA05C1234')).not.toBe(normalisePlate('KA05G1234'));
  });
});
