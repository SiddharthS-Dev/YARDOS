/**
 * The disposal path: the alternative outcome for a vehicle nobody collects.
 *
 *   IN_YARD
 *     -> auction created and published
 *     -> bidder registered (KYC + deposit)
 *     -> bidding opens
 *     -> bids placed, ladder built
 *     -> auction closed
 *     -> winner selected
 *     -> sale settlement raised
 *     -> receipt recorded
 *     -> vehicle transferred
 *
 * The properties under test are the ones that make an auction defensible if it
 * is ever disputed: bids are immutable, the ladder is never rewritten, a bid
 * below reserve or below the minimum increment is refused, and a replayed bid
 * is the same bid rather than a second one.
 */

import {
  CHENNAI_YARD,
  SEED_PASSWORDS,
  SEED_USERS,
  Session,
  TestContext,
  anprDevice,
  createTestContext,
  hypothecatedPlate,
  signIn,
  siteByCode,
} from '../setup/harness';

describe('E2E: auction disposal, listing to settlement', () => {
  let ctx: TestContext;
  let yardStaff: Session;
  let auctioneer: Session;
  let admin: Session;

  let siteId: string;
  let vehicleId: string;
  let auctionId: string;
  let lotId: string;
  let settlementId: string;

  const bidders: Array<{ id: string; name: string }> = [];
  const RESERVE = '80000.00';
  const MIN_INCREMENT = '5000.00';
  const DEPOSIT = '25000.00';

  beforeAll(async () => {
    ctx = await createTestContext();
    yardStaff = await signIn(ctx, SEED_USERS.yardChennai);
    auctioneer = await signIn(ctx, SEED_USERS.auctions);
    admin = await signIn(ctx, SEED_USERS.admin, SEED_PASSWORDS.admin);

    const site = await siteByCode(ctx, CHENNAI_YARD);
    siteId = site.id;

    // A vehicle in the yard, which is the only kind that can be auctioned.
    const device = await anprDevice(ctx, siteId);
    const admission = await ctx
      .http()
      .post('/api/v1/anpr/simulate')
      .set(...yardStaff.auth())
      .send({
        deviceCode: device.code,
        plateNumber: hypothecatedPlate('KA'),
        direction: 'ENTRY',
        confidence: 0.96,
      })
      .expect(202);

    vehicleId = admission.body.decision.vehicleId;
    expect(vehicleId).toBeTruthy();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /* ---------------------------------------------------------------- */

  it('1. creates an auction in DRAFT', async () => {
    const now = Date.now();

    const response = await ctx
      .http()
      .post('/api/v1/auctions')
      .set(...auctioneer.auth())
      .send({
        title: 'E2E disposal sale',
        siteId,
        scheduledStartAt: new Date(now + 60_000).toISOString(),
        scheduledEndAt: new Date(now + 3_600_000).toISOString(),
        defaultMinIncrement: MIN_INCREMENT,
        registrationDeposit: DEPOSIT,
      })
      .expect(201);

    auctionId = response.body.id;
    expect(response.body.status).toBe('DRAFT');
  });

  it('2. adds the vehicle as a lot with a reserve price', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/${auctionId}/lots`)
      .set(...auctioneer.auth())
      .send({ vehicleId, reservePrice: RESERVE, minIncrement: MIN_INCREMENT })
      .expect(201);

    lotId = response.body.id;
    expect(response.body.lotNumber).toBeGreaterThan(0);
    expect(response.body.reservePrice).toBe('80000.0000');
  });

  it('3. refuses to list the same vehicle in a second live lot', async () => {
    // Guarded by a partial unique index, so it holds even under a race.
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/${auctionId}/lots`)
      .set(...auctioneer.auth())
      .send({ vehicleId, reservePrice: RESERVE });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('4. registers two bidders and approves their KYC', async () => {
    for (const name of ['E2E First Bidder', 'E2E Second Bidder']) {
      const created = await ctx
        .http()
        .post('/api/v1/auctions/bidders')
        .set(...auctioneer.auth())
        .send({
          legalName: `${name} Private Limited`,
          displayName: name,
          contactName: name,
          phone: '+919000000000',
          email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.invalid`,
        })
        .expect(201);

      await ctx
        .http()
        .post(`/api/v1/auctions/bidders/${created.body.id}/approve`)
        .set(...auctioneer.auth())
        .send({})
        .expect(201);

      bidders.push({ id: created.body.id, name });
    }

    expect(bidders).toHaveLength(2);
  });

  it('5. refuses a bid before the auction opens', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/bids`)
      .set(...auctioneer.auth())
      .send({
        bidderId: bidders[0]!.id,
        amount: '90000.00',
        idempotencyKey: `e2e-early-${lotId}`,
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toMatch(/NOT_OPEN|not open|not registered|deposit/i);
  });

  it('6. publishes and opens the auction', async () => {
    await ctx
      .http()
      .post(`/api/v1/auctions/${auctionId}/publish`)
      .set(...auctioneer.auth())
      .send({})
      .expect(201);

    for (const bidder of bidders) {
      await ctx
        .http()
        .post(`/api/v1/auctions/${auctionId}/registrations`)
        .set(...auctioneer.auth())
        .send({ bidderId: bidder.id, depositPaid: DEPOSIT, depositReference: 'E2E deposit' })
        .expect(201);
    }

    const opened = await ctx
      .http()
      .post(`/api/v1/auctions/${auctionId}/open`)
      .set(...auctioneer.auth())
      .send({})
      .expect(201);

    expect(['OPEN', 'BIDDING', 'IN_PROGRESS']).toContain(opened.body.status);
  });

  it('7. refuses a bid below the reserve price', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/bids`)
      .set(...auctioneer.auth())
      .send({
        bidderId: bidders[0]!.id,
        amount: '50000.00',
        idempotencyKey: `e2e-low-${lotId}`,
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toMatch(/RESERVE|reserve/i);
  });

  it('8. accepts the opening bid at the reserve', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/bids`)
      .set(...auctioneer.auth())
      .send({
        bidderId: bidders[0]!.id,
        amount: '85000.00',
        idempotencyKey: `e2e-bid1-${lotId}`,
      })
      .expect(201);

    expect(response.body.sequenceNo).toBe(1);
    expect(response.body.duplicate).toBeFalsy();
  });

  it('9. refuses a bid that does not clear the minimum increment', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/bids`)
      .set(...auctioneer.auth())
      .send({
        bidderId: bidders[1]!.id,
        amount: '86000.00', // only +1000 against a 5000 increment
        idempotencyKey: `e2e-small-${lotId}`,
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toMatch(/INCREMENT|increment/i);
  });

  it('10. accepts a clearing bid from the second bidder', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/bids`)
      .set(...auctioneer.auth())
      .send({
        bidderId: bidders[1]!.id,
        amount: '90000.00',
        idempotencyKey: `e2e-bid2-${lotId}`,
      })
      .expect(201);

    expect(response.body.sequenceNo).toBe(2);
  });

  it('11. treats a replayed bid as the same bid', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/bids`)
      .set(...auctioneer.auth())
      .send({
        bidderId: bidders[1]!.id,
        amount: '90000.00',
        idempotencyKey: `e2e-bid2-${lotId}`,
      })
      .expect(201);

    expect(response.body.duplicate).toBe(true);
    expect(response.body.sequenceNo).toBe(2);

    const count = await ctx.prisma.bid.count({ where: { lotId } });
    expect(count).toBe(2);
  });

  it('12. refuses to rewrite or delete a bid, at the database level', async () => {
    const bid = await ctx.prisma.bid.findFirstOrThrow({ where: { lotId }, orderBy: { sequenceNo: 'asc' } });

    // The ladder is the auction's evidence. A trigger refuses both.
    await expect(
      ctx.prisma.$executeRawUnsafe(`UPDATE "bids" SET "amount" = 1 WHERE "id" = $1`, bid.id),
    ).rejects.toThrow();

    await expect(
      ctx.prisma.$executeRawUnsafe(`DELETE FROM "bids" WHERE "id" = $1`, bid.id),
    ).rejects.toThrow();
  });

  it('13. closes the auction and selects the highest bidder', async () => {
    await ctx
      .http()
      .post(`/api/v1/auctions/${auctionId}/close`)
      .set(...auctioneer.auth())
      .send({})
      .expect(201);

    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/select-winner`)
      .set(...auctioneer.auth())
      .send({})
      .expect(201);

    expect(response.body.winningBidAmount ?? response.body.highestBidAmount).toMatch(/^90000/);
  });

  it('14. keeps the losing bid on the ladder rather than deleting it', async () => {
    const ladder = await ctx.prisma.bid.findMany({
      where: { lotId },
      orderBy: { sequenceNo: 'asc' },
    });

    expect(ladder).toHaveLength(2);
    expect(ladder[0]!.status).toBe('LOST');
    expect(ladder[1]!.status).toBe('WON');
  });

  it('15. refuses to select a winner twice', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/select-winner`)
      .set(...auctioneer.auth())
      .send({});

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toMatch(/ALREADY|already/i);
  });

  it('16. raises a settlement for the hammer price plus fees', async () => {
    const response = await ctx
      .http()
      .post(`/api/v1/auctions/lots/${lotId}/settlement`)
      .set(...auctioneer.auth())
      .send({ feesAmount: '1800.00', notes: 'E2E buyer premium' })
      .expect(201);

    settlementId = response.body.id;
    // 90000 hammer + 1800 fees. Computed server-side; the client never sends a total.
    expect(Number(response.body.totalPayable ?? response.body.total)).toBeCloseTo(91800, 2);
  });

  it('17. records receipts until the settlement is met', async () => {
    await ctx
      .http()
      .post(`/api/v1/auctions/settlements/${settlementId}/receipts`)
      .set(...auctioneer.auth())
      .send({ amount: '40000.00', reference: 'E2E part 1' })
      .expect(201);

    const partial = await ctx
      .http()
      .get(`/api/v1/auctions/settlements/${settlementId}`)
      .set(...auctioneer.auth())
      .expect(200);

    expect(partial.body.status).not.toBe('RECEIVED');

    await ctx
      .http()
      .post(`/api/v1/auctions/settlements/${settlementId}/receipts`)
      .set(...auctioneer.auth())
      .send({ amount: '51800.00', reference: 'E2E part 2' })
      .expect(201);

    const settled = await ctx
      .http()
      .get(`/api/v1/auctions/settlements/${settlementId}`)
      .set(...auctioneer.auth())
      .expect(200);

    expect(settled.body.status).toBe('RECEIVED');
  });

  it('18. marks the lot settled and the vehicle sold', async () => {
    const lot = await ctx.prisma.auctionLot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.status).toBe('SETTLED');

    const vehicle = await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(vehicle.status).toBe('SOLD');
  });

  it('19. left an append-only record of every bid event', async () => {
    const events = await ctx.prisma.bidEvent.findMany({ where: { bid: { lotId } } });
    expect(events.length).toBeGreaterThan(0);

    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE "bid_events" SET "notes" = 'rewritten' WHERE "id" = $1`,
        events[0]!.id,
      ),
    ).rejects.toThrow();

    await expect(
      ctx.prisma.$executeRawUnsafe(`DELETE FROM "bid_events" WHERE "id" = $1`, events[0]!.id),
    ).rejects.toThrow();
  });

  it('20. refuses auction administration to a role without the permission', async () => {
    const response = await ctx
      .http()
      .post('/api/v1/auctions')
      .set(...yardStaff.auth())
      .send({
        title: 'Yard staff should not be able to run a sale',
        scheduledStartAt: new Date(Date.now() + 60_000).toISOString(),
        scheduledEndAt: new Date(Date.now() + 3_600_000).toISOString(),
        defaultMinIncrement: '1000.00',
      })
      .expect(403);

    expect(response.body.code).toBe('PERMISSION_DENIED');
    expect(admin).toBeTruthy();
  });
});
