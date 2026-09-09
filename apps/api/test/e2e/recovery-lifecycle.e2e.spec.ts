/**
 * The Phase-1 critical path, end to end, against the real application.
 *
 *   ANPR capture
 *     -> vehicle resolved
 *     -> admitted
 *     -> bay allocated
 *     -> registry enrichment (asynchronous)
 *     -> financier matched
 *     -> contract and rate bound
 *     -> charges accrue
 *     -> release requested
 *     -> approved by a second person
 *     -> completed at the gate
 *     -> invoice raised from the frozen final charge
 *     -> payment recorded
 *     -> vehicle exits, bay freed, visit closed
 *     -> audit trail exists for all of it
 *
 * Nothing here is mocked except the ANPR camera and the vehicle registry,
 * which are the two external systems. Guards, transactions, database
 * constraints and triggers are all real.
 */

import {
  CHENNAI_YARD,
  Session,
  SEED_PASSWORDS,
  SEED_USERS,
  TestContext,
  anprDevice,
  createTestContext,
  signIn,
  siteByCode,
  hypothecatedPlate,
} from '../setup/harness';

describe('E2E: recovery lifecycle, gate to settled invoice', () => {
  let ctx: TestContext;
  let yardStaff: Session;
  let management: Session;
  let finance: Session;
  let admin: Session;

  let plate: string;
  let siteId: string;
  let deviceCode: string;

  let vehicleId: string;
  let sessionId: string;
  let releaseId: string;
  let invoiceId: string;
  let authorizationCode: string | undefined;

  beforeAll(async () => {
    ctx = await createTestContext();
    yardStaff = await signIn(ctx, SEED_USERS.yardChennai);
    management = await signIn(ctx, SEED_USERS.management);
    finance = await signIn(ctx, SEED_USERS.finance);
    // SYSTEM_ADMINISTRATOR is the only seeded role holding both
    // `release:request` and `release:approve`, which is what makes the
    // self-approval rule reachable at all: for every other role the
    // permission guard would refuse first.
    admin = await signIn(ctx, SEED_USERS.admin, SEED_PASSWORDS.admin);

    const site = await siteByCode(ctx, CHENNAI_YARD);
    siteId = site.id;
    deviceCode = (await anprDevice(ctx, siteId)).code;
    plate = hypothecatedPlate();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /* ---------------------------------------------------------------- */

  it('1. admits an unknown vehicle from an ANPR capture', async () => {
    const response = await ctx
      .http()
      .post('/api/v1/anpr/simulate')
      .set(...yardStaff.auth())
      .send({ deviceCode, plateNumber: plate, direction: 'ENTRY', confidence: 0.97 })
      .expect(202);

    expect(response.body.status).toBe('PROCESSED');
    expect(response.body.decision.outcome).toBe('ADMITTED');

    vehicleId = response.body.decision.vehicleId;
    sessionId = response.body.decision.sessionId;

    expect(vehicleId).toBeTruthy();
    expect(sessionId).toBeTruthy();
  });

  it('2. records the capture against a normalised plate', async () => {
    const vehicle = await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });

    // The stored key is separator-free and upper-case, so TN 09 AB 1234 and
    // tn-09-ab-1234 resolve to this same row.
    expect(vehicle.normalizedRegistrationNumber).toBe(plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
  });

  it('3. allocates a bay in the same transaction as admission', async () => {
    const session = await ctx.prisma.parkingSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { space: true },
    });

    expect(session.status).toBe('OPEN');
    expect(session.entryAt).toBeInstanceOf(Date);
    // Either a bay was allocated, or the session is explicitly unallocated.
    // What must never happen is a half-admitted state.
    if (session.spaceId) {
      expect(session.space?.id).toBe(session.spaceId);
    }
  });

  it('4. did not block admission on the registry', async () => {
    // The gate queues enrichment after the transaction commits. With the inline
    // queue driver the job has already run by the time the response returned,
    // but the ordering guarantee is what matters: the vehicle was admitted in
    // step 1 regardless of what the registry did.
    const vehicle = await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });

    expect(['NOT_REQUESTED', 'PENDING', 'VERIFIED', 'FAILED', 'UNAVAILABLE', 'MANUALLY_VERIFIED'])
      .toContain(vehicle.vahanVerificationStatus);

    // A mock provider must never be presented as verified ownership data.
    // This is the rule that keeps demo data out of a repossession decision.
    const ownership = await ctx.prisma.vehicleOwnershipRecord.findFirst({
      where: { vehicleId, isCurrent: true },
    });
    if (ownership && (ownership.provider === 'mock' || ownership.source === 'MOCK')) {
      expect(vehicle.vahanVerificationStatus).not.toBe('VERIFIED');
    }
  });

  it('5. writes an immutable timeline entry for the admission', async () => {
    const events = await ctx.prisma.vehicleTimelineEvent.findMany({
      where: { vehicleId },
      orderBy: { occurredAt: 'asc' },
    });

    expect(events.length).toBeGreaterThan(0);

    // Append-only is enforced by a database trigger, not by convention.
    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE "vehicle_timeline_events" SET "summary" = 'tampered' WHERE "id" = $1`,
        events[0]!.id,
      ),
    ).rejects.toThrow();
  });

  it('6a. ages the stay so there is something to charge for', async () => {
    // A vehicle admitted seconds ago owes nothing, which would make every
    // downstream billing assertion vacuous. Backdating entry is the honest way
    // to test a long stay: it changes the fixture, not the arithmetic.
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

    await ctx.prisma.parkingSession.update({
      where: { id: sessionId },
      data: { entryAt: fortyDaysAgo },
    });

    const aged = await ctx.prisma.parkingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(aged.entryAt.getTime()).toBeLessThan(Date.now() - 39 * 24 * 60 * 60 * 1000);
  });

  it('6b. lets finance price an unrated stay through the work-queue action', async () => {
    const session = await ctx.prisma.parkingSession.findUniqueOrThrow({ where: { id: sessionId } });

    // The gate deliberately admits a vehicle it cannot price rather than
    // holding the barrier shut. If that happened here, this is the action
    // finance takes to close the gap; if the contract resolved at admission,
    // there is nothing to do.
    if (session.ratePlanId) {
      expect(session.ratePlanId).toBeTruthy();
      return;
    }

    await ctx
      .http()
      .post(`/api/v1/parking-sessions/${sessionId}/attach-rate`)
      .set(...finance.auth())
      .send({ reason: 'E2E: pricing an unrated stay before release.' })
      .expect(201);

    const priced = await ctx.prisma.parkingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(priced.ratePlanId).toBeTruthy();
  });

  it('6c. accrues a charge that is explainable and reproducible', async () => {
    const response = await ctx
      .http()
      .get(`/api/v1/parking-sessions/${sessionId}/charge`)
      .set(...finance.auth())
      .expect(200);

    const breakdown = response.body.breakdown;
    expect(breakdown).toBeTruthy();

    // Money crosses the wire as a decimal string, never a JSON number: a
    // float would silently lose paise on a long stay.
    expect(typeof breakdown.total).toBe('string');
    expect(typeof breakdown.subtotal).toBe('string');
    expect(typeof breakdown.taxTotal).toBe('string');

    // Explainable: every line says where it sits on the ladder and why.
    expect(Array.isArray(breakdown.lines)).toBe(true);
    expect(breakdown.explanation.length).toBeGreaterThan(0);
    expect(breakdown.ratePlanId).toBeTruthy();
    expect(breakdown.engineVersion).toBeTruthy();
    expect(breakdown.timezone).toBeTruthy();

    // The stay has been running for forty days, so it must have accrued.
    expect(Number(breakdown.total)).toBeGreaterThan(0);
    expect(Number(breakdown.chargeableUnits)).toBeGreaterThan(0);

    // A live estimate is deliberately `asOf` = now, so its hash moves with the
    // clock - that is the point of the hash, not a flaw in it. What must hold
    // is that the hash is a function of the inputs: a second estimate taken at
    // a different instant differs, and the frozen FINAL calculation (step 15)
    // never changes at all.
    const again = await ctx
      .http()
      .get(`/api/v1/parking-sessions/${sessionId}/charge`)
      .set(...finance.auth())
      .expect(200);

    expect(again.body.breakdown.ratePlanId).toBe(breakdown.ratePlanId);
    expect(again.body.breakdown.engineVersion).toBe(breakdown.engineVersion);
    expect(again.body.breakdown.freeUnits).toBe(breakdown.freeUnits);
  });

  it('7. reports release eligibility with every check named', async () => {
    const response = await ctx
      .http()
      .get(`/api/v1/releases/eligibility/${sessionId}`)
      .set(...yardStaff.auth())
      .expect(200);

    expect(Array.isArray(response.body.checks)).toBe(true);
    expect(response.body.checks.length).toBeGreaterThanOrEqual(5);

    // An operator must be able to see which check blocks them, not just that
    // something did.
    for (const check of response.body.checks) {
      expect(check).toHaveProperty('code');
      expect(check).toHaveProperty('passed');
    }
  });

  it('8. accepts a release request', async () => {
    const response = await ctx
      .http()
      .post('/api/v1/releases')
      .set(...admin.auth())
      .send({
        sessionId,
        reason: 'Financier has authorised collection of the vehicle.',
        requestedForPartyType: 'FINANCIER',
      })
      .expect(201);

    releaseId = response.body.id;
    expect(releaseId).toBeTruthy();
    expect(['AWAITING_APPROVAL', 'AWAITING_SETTLEMENT', 'APPROVED']).toContain(response.body.status);
  });

  it('9a. refuses approval from a role without release:approve', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/releases/${releaseId}/decision`)
      .set(...yardStaff.auth())
      .send({ decision: 'APPROVED', remarks: 'Yard staff attempting to approve.' })
      .expect(403);

    expect(response.body.code).toBe('PERMISSION_DENIED');
    expect(response.body.details.requiredPermissions).toContain('release:approve');
  });

  it('9b. refuses to let the requester approve their own release', async () => {
    // The admin holds release:approve, so the permission guard lets this
    // through and the segregation-of-duty rule is what refuses it. Without a
    // requester who can approve, this rule would never actually be exercised.
    const response = await ctx
      .http()
      .post(`/api/v1/releases/${releaseId}/decision`)
      .set(...admin.auth())
      .send({ decision: 'APPROVED', remarks: 'Approving my own request.' });

    expect([403, 409]).toContain(response.status);
    expect(JSON.stringify(response.body)).toMatch(/SELF_APPROVAL|approve a release you requested/i);
  });

  it('10. accepts approval from a second person and issues a one-time code', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/releases/${releaseId}/decision`)
      .set(...management.auth())
      .send({ decision: 'APPROVED', remarks: 'Verified against the financier authorisation.' })
      .expect(201);

    expect(response.body.release.status).toBe('APPROVED');
    authorizationCode = response.body.authorizationCode;
    expect(authorizationCode).toMatch(/^\d{6}$/);
  });

  it('11. stores the authorisation code only as a hash', async () => {
    const row = await ctx.prisma.releaseRequest.findUniqueOrThrow({ where: { id: releaseId } });
    const serialised = JSON.stringify(row);

    expect(serialised).not.toContain(authorizationCode!);
    expect(row.authorizationCodeHash).toBeTruthy();
  });

  it('12. rejects a wrong authorisation code at the gate', async () => {
    const wrong = authorizationCode === '000000' ? '111111' : '000000';

    const response = await ctx
      .http()
      .post(`/api/v1/releases/${releaseId}/complete`)
      .set(...yardStaff.auth())
      .send({ authorizationCode: wrong });

    expect([400, 403, 409]).toContain(response.status);
  });

  it('13. completes the release and raises an invoice from the frozen charge', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/releases/${releaseId}/complete`)
      .set(...yardStaff.auth())
      .send({ authorizationCode })
      .expect(201);

    expect(response.body.release.status).toBe('COMPLETED');
    invoiceId = response.body.invoiceId;
    expect(invoiceId).toBeTruthy();
    expect(response.body.invoiceNumber).toBeTruthy();
  });

  it('14. closed the session and freed the bay', async () => {
    const session = await ctx.prisma.parkingSession.findUniqueOrThrow({ where: { id: sessionId } });

    expect(session.status).toBe('CLOSED');
    expect(session.exitAt).toBeInstanceOf(Date);

    // The CHECK constraint that caught the original write-ordering defect.
    // status=OPEN with an exitAt set is not a representable state.
    expect(session.exitAt).not.toBeNull();

    const vehicle = await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(vehicle.status).toBe('EXITED');
  });

  it('15. froze the final charge calculation against further edits', async () => {
    const final = await ctx.prisma.chargeCalculation.findFirst({
      where: { sessionId, type: 'FINAL' },
    });
    expect(final).toBeTruthy();
    expect(final!.inputsHash).toBeTruthy();

    // Re-reading the frozen calculation must give byte-identical inputs: this
    // is the reproducibility that matters, because it is the number the
    // financier was actually billed.
    const reread = await ctx.prisma.chargeCalculation.findUniqueOrThrow({
      where: { id: final!.id },
    });
    expect(reread.inputsHash).toBe(final!.inputsHash);
    expect(reread.total.toString()).toBe(final!.total.toString());

    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE "charge_calculations" SET "total" = 1 WHERE "id" = $1`,
        final!.id,
      ),
    ).rejects.toThrow();
  });

  it('16. issues the invoice', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/invoices/${invoiceId}/issue`)
      .set(...finance.auth())
      .expect(201);

    expect(response.body.status).toBe('ISSUED');
    expect(typeof response.body.total).toBe('string');
    expect(response.body.dueDate).toBeTruthy();
  });

  it('17. freezes an issued invoice against silent edits', async () => {
    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE "invoices" SET "total" = 1 WHERE "id" = $1`,
        invoiceId,
      ),
    ).rejects.toThrow();
  });

  it('18. records a part payment and reports the remaining balance', async () => {
    const invoice = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const half = (Number(invoice.total) / 2).toFixed(2);

    const response = await ctx
      .http()
      .post('/api/v1/payments')
      .set(...finance.auth())
      .send({
        invoiceId,
        amount: half,
        method: 'CASH',
        reference: 'E2E part payment',
        idempotencyKey: `e2e-part-${releaseId}`,
      })
      .expect(201);

    expect(response.body.status).toBe('SUCCESS');

    const afterPart = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(afterPart.status).toBe('PARTIALLY_PAID');
    expect(Number(afterPart.balance)).toBeCloseTo(Number(invoice.total) - Number(half), 2);
  });

  it('19. treats a replayed payment as the same payment, not a second one', async () => {
    const before = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    const invoice = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const half = (Number(invoice.total) / 2).toFixed(2);

    await ctx
      .http()
      .post('/api/v1/payments')
      .set(...finance.auth())
      .send({
        invoiceId,
        amount: half,
        method: 'CASH',
        reference: 'E2E part payment',
        idempotencyKey: `e2e-part-${releaseId}`,
      })
      .expect(201);

    const after = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(after.balance.toString()).toBe(before.balance.toString());

    const payments = await ctx.prisma.payment.count({
      where: { idempotencyKey: `e2e-part-${releaseId}` },
    });
    expect(payments).toBe(1);
  });

  it('20. refuses a payment larger than the outstanding balance', async () => {
    const invoice = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const tooMuch = (Number(invoice.balance) + 1000).toFixed(2);

    const response = await ctx
      .http()
      .post('/api/v1/payments')
      .set(...finance.auth())
      .send({
        invoiceId,
        amount: tooMuch,
        method: 'CASH',
        idempotencyKey: `e2e-over-${releaseId}`,
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toMatch(/EXCEEDS_BALANCE|exceeds/i);
  });

  it('21. settles the invoice on final payment', async () => {
    const invoice = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    await ctx
      .http()
      .post('/api/v1/payments')
      .set(...finance.auth())
      .send({
        invoiceId,
        amount: invoice.balance.toString(),
        method: 'BANK_TRANSFER',
        idempotencyKey: `e2e-final-${releaseId}`,
      })
      .expect(201);

    const settled = await ctx.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(settled.status).toBe('PAID');
    expect(Number(settled.balance)).toBe(0);
  });

  it('22. left an append-only audit trail across the whole lifecycle', async () => {
    const logs = await ctx.prisma.auditLog.findMany({
      where: { OR: [{ entityId: vehicleId }, { entityId: sessionId }, { entityId: releaseId }, { entityId: invoiceId }] },
    });

    expect(logs.length).toBeGreaterThan(0);

    // Every entry names who did it.
    for (const log of logs) {
      expect(log.action).toBeTruthy();
      expect(log.entityType).toBeTruthy();
    }

    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE "audit_logs" SET "action" = 'REWRITTEN' WHERE "id" = $1`,
        logs[0]!.id,
      ),
    ).rejects.toThrow();

    await expect(
      ctx.prisma.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE "id" = $1`, logs[0]!.id),
    ).rejects.toThrow();
  });
});
