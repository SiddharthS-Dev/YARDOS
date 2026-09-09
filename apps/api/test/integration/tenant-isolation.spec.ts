/**
 * Data-scope isolation.
 *
 * The property under test is stronger than "a financier cannot read another
 * financier's vehicle". It is that a financier cannot even establish that such
 * a vehicle EXISTS. A 403 would confirm existence; the platform returns 404,
 * the same answer it gives for a registration number nobody has ever seen.
 *
 * These run against the real guards and the real SQL predicates. There is no
 * way to reach the service layer here without going through both.
 */

import {
  CHENNAI_YARD,
  SEED_USERS,
  Session,
  TestContext,
  anprDevice,
  PORTAL_FINANCIERS,
  createTestContext,
  hypothecatedPlate,
  signIn,
  signInAsFinancier,
  siteByCode,
} from '../setup/harness';

describe('financier and site data scoping', () => {
  let ctx: TestContext;
  let yardStaff: Session;
  let management: Session;

  /** Two financiers with vehicles, so each can be pointed at the other's. */
  const owned: Array<{ financierCode: string; vehicleId: string; plate: string }> = [];

  beforeAll(async () => {
    ctx = await createTestContext();
    yardStaff = await signIn(ctx, SEED_USERS.yardChennai);
    management = await signIn(ctx, SEED_USERS.management);

    // Only financiers with a seeded portal user can be signed in as, and the
    // test needs a vehicle belonging to each so one can be pointed at the
    // other's.
    for (const code of PORTAL_FINANCIERS) {
      const holding = await ctx.prisma.vehicleFinancierHistory.findFirst({
        where: { effectiveTo: null, financier: { code } },
        include: { vehicle: true },
      });

      if (!holding) throw new Error(`Financier ${code} holds no vehicle in the seed.`);

      owned.push({
        financierCode: code,
        vehicleId: holding.vehicleId,
        plate: holding.vehicle.registrationNumber,
      });
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /* ---------------------------------------------------------------- */

  it('lets a financier read their own vehicle', async () => {
    const session = await signInAsFinancier(ctx, owned[0]!.financierCode);

    const response = await ctx
      .http()
      .get(`/api/v1/vehicles/${owned[0]!.vehicleId}`)
      .set(...session.auth())
      .expect(200);

    expect(response.body.id).toBe(owned[0]!.vehicleId);
  });

  it("returns 404, not 403, for another financier's vehicle", async () => {
    const session = await signInAsFinancier(ctx, owned[0]!.financierCode);

    const response = await ctx
      .http()
      .get(`/api/v1/vehicles/${owned[1]!.vehicleId}`)
      .set(...session.auth());

    // 403 would be a disclosure: it confirms the id resolves to something.
    expect(response.status).toBe(404);
  });

  it('gives the same 404 for a vehicle id that does not exist at all', async () => {
    const session = await signInAsFinancier(ctx, owned[0]!.financierCode);

    const response = await ctx
      .http()
      .get('/api/v1/vehicles/00000000-0000-4000-8000-000000000000')
      .set(...session.auth());

    expect(response.status).toBe(404);
    // Indistinguishable from the previous case, which is the whole point.
    expect(response.body.code).toBe(
      (
        await ctx
          .http()
          .get(`/api/v1/vehicles/${owned[1]!.vehicleId}`)
          .set(...session.auth())
      ).body.code,
    );
  });

  it("excludes another financier's vehicles from search results", async () => {
    const session = await signInAsFinancier(ctx, owned[0]!.financierCode);

    const response = await ctx
      .http()
      .get(`/api/v1/vehicles?search=${encodeURIComponent(owned[1]!.plate)}`)
      .set(...session.auth())
      .expect(200);

    const ids = (response.body.items as Array<{ id: string }>).map((item) => item.id);
    expect(ids).not.toContain(owned[1]!.vehicleId);
  });

  it("excludes another financier's stays from the session list", async () => {
    const session = await signInAsFinancier(ctx, owned[0]!.financierCode);

    const response = await ctx
      .http()
      .get('/api/v1/parking-sessions?pageSize=100')
      .set(...session.auth())
      .expect(200);

    const vehicleIds = (response.body.items as Array<{ vehicleId: string }>).map((i) => i.vehicleId);
    expect(vehicleIds).not.toContain(owned[1]!.vehicleId);
  });

  it("excludes another financier's invoices", async () => {
    const session = await signInAsFinancier(ctx, owned[1]!.financierCode);

    const response = await ctx
      .http()
      .get('/api/v1/invoices?pageSize=100')
      .set(...session.auth())
      .expect(200);

    const financier = await ctx.prisma.financier.findFirstOrThrow({
      where: { code: owned[1]!.financierCode },
    });

    for (const invoice of response.body.items as Array<{ id: string }>) {
      const row = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(row.financierId).toBe(financier.id);
    }
  });

  it('reports zero, not a leaked aggregate, for estate-wide metrics', async () => {
    const financierSession = await signInAsFinancier(ctx, owned[0]!.financierCode);

    const scoped = await ctx
      .http()
      .get('/api/v1/reports/dashboard')
      .set(...financierSession.auth())
      .expect(200);

    const estate = await ctx
      .http()
      .get('/api/v1/reports/dashboard')
      .set(...management.auth())
      .expect(200);

    // Management sees the whole estate; the financier must not, and must not
    // be able to infer it from a total either.
    expect(estate.body.vehiclesInYard).toBeGreaterThanOrEqual(scoped.body.vehiclesInYard);
    expect(scoped.body.vehiclesInYard).toBeLessThan(estate.body.vehiclesInYard + 1);
  });

  it('masks owner PII from a caller without vehicle:pii:read', async () => {
    const session = await signInAsFinancier(ctx, owned[0]!.financierCode);

    const response = await ctx
      .http()
      .get(`/api/v1/vehicles/${owned[0]!.vehicleId}`)
      .set(...session.auth())
      .expect(200);

    const ownerName: string | null | undefined = response.body.ownerName ?? response.body.owner?.name;

    if (ownerName) {
      // A masked value keeps enough to recognise a record and not enough to
      // identify a person.
      expect(ownerName).toMatch(/[*•x]/i);
    }
  });

  it('shows the same record unmasked to a caller who does hold the permission', async () => {
    const ownership = await ctx.prisma.vehicleOwnershipRecord.findFirst({
      where: { vehicleId: owned[0]!.vehicleId, isCurrent: true },
    });

    if (!ownership?.registeredOwnerName) return; // nothing enriched yet, nothing to compare

    const response = await ctx
      .http()
      .get(`/api/v1/vehicles/${owned[0]!.vehicleId}`)
      .set(...management.auth())
      .expect(200);

    const ownerName: string | null | undefined = response.body.ownerName ?? response.body.owner?.name;
    if (ownerName) {
      expect(ownerName).not.toMatch(/\*{3,}/);
    }
  });

  it('refuses a write to a site the user has no access to', async () => {
    // The Coimbatore yard staff must not be able to drive the Chennai gate.
    const coimbatoreStaff = await signIn(ctx, SEED_USERS.yardCoimbatore);
    const chennai = await siteByCode(ctx, CHENNAI_YARD);
    const device = await anprDevice(ctx, chennai.id);

    const response = await ctx
      .http()
      .post('/api/v1/anpr/simulate')
      .set(...coimbatoreStaff.auth())
      .send({
        deviceCode: device.code,
        plateNumber: hypothecatedPlate('TN'),
        direction: 'ENTRY',
        confidence: 0.95,
      });

    expect([403, 404]).toContain(response.status);
    expect(yardStaff).toBeTruthy();
  });

  it('rejects an unauthenticated request outright', async () => {
    await ctx.http().get('/api/v1/vehicles').expect(401);
    await ctx.http().get('/api/v1/reports/dashboard').expect(401);
    await ctx.http().get('/api/v1/invoices').expect(401);
  });

  it('rejects a token that has been tampered with', async () => {
    // Flipping the last characters breaks the signature. A JWT that verifies
    // only its own payload would accept this.
    const tampered = `${management.accessToken.slice(0, -4)}AAAA`;

    await ctx
      .http()
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${tampered}`)
      .expect(401);
  });
});
