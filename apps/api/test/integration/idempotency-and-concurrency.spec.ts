/**
 * Retry safety and concurrency.
 *
 * Every one of these paths is reached by something that retries: a camera
 * firing several frames at one vehicle, a gateway redelivering a callback, an
 * operator double-tapping a button on a slow connection, two gate lanes
 * processing at the same instant.
 *
 * The rule throughout is that the database decides, not the application: a
 * unique index or a row lock, never a read-then-write that a race can slip
 * between.
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

describe('idempotency and concurrency', () => {
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

  it('admits a vehicle once however many frames the camera fires', async () => {
    const plate = hypothecatedPlate();

    // A camera does not send one clean frame; it sends a burst as the vehicle
    // crosses the loop.
    for (let frame = 0; frame < 4; frame += 1) {
      await ctx
        .http()
        .post('/api/v1/anpr/simulate')
        .set(...yardStaff.auth())
        .send({ deviceCode, plateNumber: plate, direction: 'ENTRY', confidence: 0.93 })
        .expect(202);
    }

    const vehicle = await ctx.prisma.vehicle.findFirstOrThrow({
      where: { normalizedRegistrationNumber: normalisePlate(plate) },
    });

    // One stay, not four. Guarded by the partial unique index
    // `uq_parking_sessions_one_active_per_vehicle`.
    const open = await ctx.prisma.parkingSession.count({
      where: { vehicleId: vehicle.id, status: { in: ['OPEN', 'ON_HOLD'] } },
    });
    expect(open).toBe(1);
  });

  it('admits a vehicle once when frames arrive simultaneously', async () => {
    const plate = hypothecatedPlate();

    // The serial case above is the easy one. This is the race: four captures
    // in flight at the same moment, none of which has seen the others.
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        ctx
          .http()
          .post('/api/v1/anpr/simulate')
          .set(...yardStaff.auth())
          .send({ deviceCode, plateNumber: plate, direction: 'ENTRY', confidence: 0.93 }),
      ),
    );

    // Some may be rejected by the unique index; that is the mechanism working,
    // not a failure. What matters is the state left behind.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const vehicles = await ctx.prisma.vehicle.findMany({
      where: { normalizedRegistrationNumber: normalisePlate(plate) },
    });
    expect(vehicles).toHaveLength(1);

    const open = await ctx.prisma.parkingSession.count({
      where: { vehicleId: vehicles[0]!.id, status: { in: ['OPEN', 'ON_HOLD'] } },
    });
    expect(open).toBe(1);
  });

  it('never allocates one bay to two vehicles', async () => {
    // `uq_parking_allocations_one_open_per_space` is a partial unique index, so
    // this holds under concurrency and not merely under polite sequencing.
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ spaceId: string; n: bigint }>>(`
      SELECT "spaceId", COUNT(*) AS n
      FROM "parking_sessions"
      WHERE "spaceId" IS NOT NULL AND "status" IN ('OPEN', 'ON_HOLD')
      GROUP BY "spaceId"
      HAVING COUNT(*) > 1
    `);

    expect(rows).toHaveLength(0);
  });

  it('never leaves a vehicle with two open stays', async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ vehicleId: string; n: bigint }>>(`
      SELECT "vehicleId", COUNT(*) AS n
      FROM "parking_sessions"
      WHERE "status" IN ('OPEN', 'ON_HOLD')
      GROUP BY "vehicleId"
      HAVING COUNT(*) > 1
    `);

    expect(rows).toHaveLength(0);
  });

  it('refuses a session that is OPEN and already has an exit time', async () => {
    // The CHECK constraint behind the defect found in walkthrough C. A stay
    // cannot be simultaneously in progress and finished.
    const open = await ctx.prisma.parkingSession.findFirst({ where: { status: 'OPEN' } });
    if (!open) return;

    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE "parking_sessions" SET "exitAt" = now() WHERE "id" = $1`,
        open.id,
      ),
    ).rejects.toThrow();
  });

  it('keeps at most one current charge calculation per stay', async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ sessionId: string; n: bigint }>>(`
      SELECT "sessionId", COUNT(*) AS n
      FROM "charge_calculations"
      WHERE "isCurrent" = true
      GROUP BY "sessionId"
      HAVING COUNT(*) > 1
    `);

    expect(rows).toHaveLength(0);
  });

  it('keeps at most one live release per stay', async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ sessionId: string; n: bigint }>>(`
      SELECT "sessionId", COUNT(*) AS n
      FROM "release_requests"
      WHERE "status" IN ('DRAFT', 'SUBMITTED', 'ELIGIBILITY_FAILED',
                         'AWAITING_PAYMENT', 'AWAITING_APPROVAL', 'APPROVED')
      GROUP BY "sessionId"
      HAVING COUNT(*) > 1
    `);

    expect(rows).toHaveLength(0);
  });

  it('keeps at most one current owner record per vehicle', async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ vehicleId: string; n: bigint }>>(`
      SELECT "vehicleId", COUNT(*) AS n
      FROM "vehicle_ownership_records"
      WHERE "isCurrent" = true
      GROUP BY "vehicleId"
      HAVING COUNT(*) > 1
    `);

    expect(rows).toHaveLength(0);
  });

  it('never issues the same invoice number twice', async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ invoiceNumber: string; n: bigint }>>(`
      SELECT "invoiceNumber", COUNT(*) AS n
      FROM "invoices"
      GROUP BY "invoiceNumber"
      HAVING COUNT(*) > 1
    `);

    expect(rows).toHaveLength(0);
  });

  it('never lets an invoice be paid beyond its total', async () => {
    // Balance is derived server-side and can never go negative: an
    // overpayment is refused rather than recorded and reconciled later.
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ id: string }>>(`
      SELECT "id" FROM "invoices" WHERE "balance" < 0
    `);

    expect(rows).toHaveLength(0);
  });

  it('rejects a duplicate payment idempotency key at the database level', async () => {
    // idempotencyKey is non-nullable on payments, so any row will do.
    const payment = await ctx.prisma.payment.findFirst();
    if (!payment) return;

    // Even if the service layer were bypassed entirely, the unique index holds.
    await expect(
      ctx.prisma.$executeRawUnsafe(
        `INSERT INTO "payments" ("id", "organizationId", "invoiceId", "amount", "currency",
           "method", "status", "idempotencyKey", "receivedAt", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 1, 'INR', 'CASH', 'SUCCESS', $3, now(), now(), now())`,
        payment.organizationId,
        payment.invoiceId,
        payment.idempotencyKey,
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate provider event id for a webhook', async () => {
    const event = await ctx.prisma.paymentWebhookEvent.findFirst();
    if (!event) return;

    await expect(
      ctx.prisma.$executeRawUnsafe(
        `INSERT INTO "payment_webhook_events" ("id", "provider", "providerEventId", "payload",
           "signatureValid", "receivedAt")
         VALUES (gen_random_uuid(), $1, $2, '{}'::jsonb, true, now())`,
        event.provider,
        event.providerEventId,
      ),
    ).rejects.toThrow();
  });
});
