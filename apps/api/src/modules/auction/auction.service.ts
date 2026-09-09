import { Injectable } from '@nestjs/common';
import {
  ActorType,
  AuctionLotStatus,
  AuctionRegistrationStatus,
  AuctionStatus,
  BidChannel,
  BidStatus,
  BidderStatus,
  Prisma,
  VehicleStatus,
} from '@prisma/client';

import {
  ErrorCode,
  IN_AUCTION_VEHICLE_STATUSES,
  Paginated,
  TimelineEventType,
} from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import { RequestContextStore } from '@/common/context/request-context';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { toDecimal, toPrismaDecimal } from '@/common/money/money';
import { generateAuctionCode } from '@/common/util/ids';
import { PrismaService, PrismaTransaction } from '@/infrastructure/prisma/prisma.service';
import { DomainEventType, OutboxService } from '@/infrastructure/outbox';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { AccessScope } from '@/modules/identity/guards';
import {
  AuctionLotStateMachine,
  AuctionStateMachine,
  BidStateMachine,
} from '@/modules/shared/state-machine';
import { VehicleService } from '@/modules/vehicle/vehicle.service';

/**
 * Auctions.
 *
 * The disposal half of the business, and the part with the strongest integrity
 * requirements (S18/S19). Four properties are load-bearing:
 *
 *   **Bids are immutable.** Amount, bidder, time and sequence are frozen by a
 *   database trigger. Only `status` may advance, and every change is appended
 *   to `bid_events`. An auction administrator cannot quietly rewrite history.
 *
 *   **Bids serialise on a unique index.** `(lotId, sequenceNo)` is unique, so
 *   two bidders hitting the same lot in the same instant cannot both take the
 *   same position. The loser retries against the new highest bid rather than
 *   silently overwriting it.
 *
 *   **Role separation.** Selecting a winner and raising the sale invoice are
 *   different permissions held by different people, so one person cannot run an
 *   auction end to end alone.
 *
 *   **An auction does not dispose of a vehicle.** Winning, settling and marking
 *   the vehicle SOLD are separate, explicit transitions. A lot existing proves
 *   nothing about where the vehicle is.
 */
@Injectable()
export class AuctionService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehicleService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Auction');
  }

  /* ---------------------------------------------------------------- */
  /* Auction lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  async createAuction(
    actor: AuthenticatedUser,
    input: {
      title: string;
      description?: string | null;
      siteId?: string | null;
      scheduledStartAt: Date;
      scheduledEndAt: Date;
      defaultMinIncrement: string;
      registrationDeposit?: string | null;
      termsAndConditions?: string | null;
    },
  ): Promise<AuctionDetail> {
    if (input.scheduledEndAt <= input.scheduledStartAt) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'The auction must close after it opens.',
      );
    }
    if (toDecimal(input.defaultMinIncrement).lessThanOrEqualTo(0)) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'The minimum bid increment must be greater than zero.',
      );
    }
    if (input.siteId) AccessScope.assertSite(actor, input.siteId);

    const auctionId = await this.prisma.transaction(async (tx) => {
      const auction = await tx.auction.create({
        data: {
          organizationId: actor.organizationId,
          siteId: input.siteId ?? null,
          code: generateAuctionCode(),
          title: input.title,
          description: input.description ?? null,
          status: AuctionStatus.DRAFT,
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
          defaultMinIncrement: toPrismaDecimal(input.defaultMinIncrement),
          registrationDeposit: input.registrationDeposit
            ? toPrismaDecimal(input.registrationDeposit)
            : null,
          termsAndConditions: input.termsAndConditions ?? null,
          createdById: actor.id,
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.AUCTION_CREATED,
        entityType: 'Auction',
        entityId: auction.id,
        organizationId: actor.organizationId,
        siteId: input.siteId ?? null,
        afterState: {
          code: auction.code,
          title: auction.title,
          scheduledStartAt: input.scheduledStartAt.toISOString(),
          scheduledEndAt: input.scheduledEndAt.toISOString(),
        },
      });

      return auction.id;
    });

    return this.findAuctionById(actor, auctionId);
  }

  /** Advances an auction: SCHEDULED, PUBLISHED, OPEN, CLOSED. */
  async transitionAuction(
    actor: AuthenticatedUser,
    auctionId: string,
    to: AuctionStatus,
  ): Promise<AuctionDetail> {
    await this.prisma.transaction(async (tx) => {
      const auction = await tx.auction.findFirst({
        where: { id: auctionId, organizationId: actor.organizationId },
        include: { lots: { select: { id: true, status: true, vehicleId: true } } },
      });
      if (!auction) throw notFound('Auction', auctionId);
      AccessScope.assertSite(actor, auction.siteId);

      AuctionStateMachine.assert(auction.status, to);

      // Publishing an auction with nothing in it is always a mistake.
      if (to === AuctionStatus.PUBLISHED && auction.lots.length === 0) {
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          'An auction cannot be published with no lots.',
        );
      }

      const now = new Date();
      const data: Prisma.AuctionUpdateInput = { status: to, version: { increment: 1 } };

      if (to === AuctionStatus.PUBLISHED) {
        data.publishedAt = now;
        data.publishedById = actor.id;
      }
      if (to === AuctionStatus.OPEN) data.actualStartAt = now;
      if (to === AuctionStatus.CLOSED) {
        data.actualEndAt = now;
        data.closedAt = now;
        data.closedById = actor.id;
      }

      const updated = await tx.auction.updateMany({
        where: { id: auctionId, version: auction.version },
        data,
      });
      if (updated.count === 0) {
        throw new AppException(
          ErrorCode.CONCURRENT_MODIFICATION,
          'The auction changed while you were working on it. Reload and try again.',
        );
      }

      // Lots follow the auction. Bidding opens and closes for all of them at
      // once, which is what "the auction is open" means operationally.
      for (const lot of auction.lots) {
        if (to === AuctionStatus.OPEN && lot.status === AuctionLotStatus.LISTED) {
          await this.transitionLot(tx, lot.id, AuctionLotStatus.BIDDING_OPEN);
          await this.vehicles.transition(tx, lot.vehicleId, VehicleStatus.BIDDING_OPEN, {
            reason: `Bidding opened in auction ${auction.code}.`,
            siteId: auction.siteId,
            actorId: actor.id,
            actorType: ActorType.USER,
            tolerateNoop: true,
          });
        }
        if (to === AuctionStatus.CLOSED && lot.status === AuctionLotStatus.BIDDING_OPEN) {
          await this.transitionLot(tx, lot.id, AuctionLotStatus.BIDDING_CLOSED);
          await this.vehicles.transition(tx, lot.vehicleId, VehicleStatus.BIDDING_CLOSED, {
            reason: `Bidding closed in auction ${auction.code}.`,
            siteId: auction.siteId,
            actorId: actor.id,
            actorType: ActorType.USER,
            tolerateNoop: true,
          });
        }
      }

      const eventType =
        to === AuctionStatus.PUBLISHED
          ? DomainEventType.AUCTION_PUBLISHED
          : to === AuctionStatus.OPEN
            ? DomainEventType.AUCTION_OPENED
            : to === AuctionStatus.CLOSED
              ? DomainEventType.AUCTION_CLOSED
              : null;

      if (eventType) {
        await this.outbox.record(tx, {
          eventType,
          aggregateType: 'Auction',
          aggregateId: auctionId,
          payload: {
            auctionId,
            code: auction.code,
            organizationId: actor.organizationId,
            status: to,
            lotCount: auction.lots.length,
          },
        });
      }

      await this.audit.record(tx, {
        action:
          to === AuctionStatus.PUBLISHED
            ? AuditAction.AUCTION_PUBLISHED
            : to === AuctionStatus.OPEN
              ? AuditAction.AUCTION_OPENED
              : to === AuctionStatus.CLOSED
                ? AuditAction.AUCTION_CLOSED
                : AuditAction.AUCTION_CREATED,
        entityType: 'Auction',
        entityId: auctionId,
        organizationId: actor.organizationId,
        siteId: auction.siteId,
        beforeState: { status: auction.status },
        afterState: { status: to },
      });
    });

    return this.findAuctionById(actor, auctionId);
  }

  /* ---------------------------------------------------------------- */
  /* Lots                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Adds a vehicle to an auction.
   *
   * Eligibility is checked here rather than trusted from the caller: a vehicle
   * that is not in the yard, is under hold, or is already in another live
   * auction must not be listed.
   */
  async addLot(
    actor: AuthenticatedUser,
    auctionId: string,
    input: {
      vehicleId: string;
      reservePrice: string;
      minIncrement?: string | null;
      description?: string | null;
      conditionNotes?: string | null;
    },
  ): Promise<LotDetail> {
    const lotId = await this.prisma.transaction(async (tx) => {
      const auction = await tx.auction.findFirst({
        where: { id: auctionId, organizationId: actor.organizationId },
      });
      if (!auction) throw notFound('Auction', auctionId);
      AccessScope.assertSite(actor, auction.siteId);

      if (auction.status !== AuctionStatus.DRAFT && auction.status !== AuctionStatus.SCHEDULED) {
        throw new AppException(
          ErrorCode.INVALID_AUCTION_STATE_TRANSITION,
          `Lots cannot be added to an auction that is ${auction.status}.`,
        );
      }

      const vehicle = await tx.vehicle.findFirst({
        where: { id: input.vehicleId, organizationId: actor.organizationId },
        include: {
          sessions: {
            where: { status: { in: ['OPEN', 'ON_HOLD'] } },
            select: { id: true, siteId: true, holdReason: true, status: true },
            take: 1,
          },
        },
      });
      if (!vehicle) throw notFound('Vehicle', input.vehicleId);

      const session = vehicle.sessions[0];
      if (!session) {
        throw new AppException(
          ErrorCode.VEHICLE_NOT_AUCTION_ELIGIBLE,
          'Only a vehicle currently in the yard can be listed for auction.',
          { details: { vehicleId: vehicle.id, vehicleStatus: vehicle.status } },
        );
      }
      if (session.status === 'ON_HOLD') {
        throw new AppException(
          ErrorCode.VEHICLE_NOT_AUCTION_ELIGIBLE,
          `This vehicle is under hold and cannot be auctioned: ${session.holdReason ?? 'no reason recorded'}.`,
        );
      }
      if ((IN_AUCTION_VEHICLE_STATUSES as readonly string[]).includes(vehicle.status)) {
        throw new AppException(
          ErrorCode.VEHICLE_ALREADY_IN_AUCTION,
          `This vehicle is already ${vehicle.status} in an auction process.`,
        );
      }

      const lastLot = await tx.auctionLot.findFirst({
        where: { auctionId },
        orderBy: { lotNumber: 'desc' },
        select: { lotNumber: true },
      });

      const lot = await tx.auctionLot.create({
        data: {
          auctionId,
          lotNumber: (lastLot?.lotNumber ?? 0) + 1,
          vehicleId: vehicle.id,
          sessionId: session.id,
          status: AuctionLotStatus.LISTED,
          reservePrice: toPrismaDecimal(input.reservePrice),
          startingPrice: toPrismaDecimal(input.reservePrice),
          minIncrement: toPrismaDecimal(input.minIncrement ?? auction.defaultMinIncrement.toFixed(4)),
          currency: auction.currency,
          description: input.description ?? null,
          conditionNotes: input.conditionNotes ?? null,
        },
      });

      // The vehicle walks the lifecycle explicitly: eligible, then listed.
      await this.vehicles.transition(tx, vehicle.id, VehicleStatus.AUCTION_ELIGIBLE, {
        reason: `Selected for auction ${auction.code}.`,
        sessionId: session.id,
        siteId: session.siteId,
        actorId: actor.id,
        actorType: ActorType.USER,
        tolerateNoop: true,
      });
      await this.vehicles.transition(tx, vehicle.id, VehicleStatus.AUCTION_LISTED, {
        reason: `Listed as lot ${lot.lotNumber} in auction ${auction.code}.`,
        sessionId: session.id,
        siteId: session.siteId,
        actorId: actor.id,
        actorType: ActorType.USER,
        tolerateNoop: true,
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: actor.organizationId,
          vehicleId: vehicle.id,
          sessionId: session.id,
          siteId: session.siteId,
          type: TimelineEventType.AUCTION_LISTED,
          occurredAt: new Date(),
          actorId: actor.id,
          actorType: ActorType.USER,
          title: `Listed as lot ${lot.lotNumber} in ${auction.code}`,
          description: `Reserve ${auction.currency} ${toDecimal(input.reservePrice).toFixed(2)}.`,
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.outbox.record(tx, {
        eventType: DomainEventType.LOT_LISTED,
        aggregateType: 'AuctionLot',
        aggregateId: lot.id,
        payload: {
          lotId: lot.id,
          auctionId,
          organizationId: actor.organizationId,
          vehicleId: vehicle.id,
          lotNumber: lot.lotNumber,
          reservePrice: lot.reservePrice.toFixed(4),
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.LOT_ADDED,
        entityType: 'AuctionLot',
        entityId: lot.id,
        organizationId: actor.organizationId,
        siteId: session.siteId,
        afterState: {
          auctionCode: auction.code,
          lotNumber: lot.lotNumber,
          vehicleId: vehicle.id,
          reservePrice: lot.reservePrice.toFixed(4),
        },
      });

      return lot.id;
    });

    return this.findLotById(actor, lotId);
  }

  /* ---------------------------------------------------------------- */
  /* Bidding                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Places a bid.
   *
   * Every guard here exists because its absence would be exploitable:
   *
   *   - the auction must be OPEN and inside its window;
   *   - the bidder must be APPROVED and registered FOR THIS AUCTION;
   *   - the amount must clear the reserve and beat the standing high bid by at
   *     least the increment;
   *   - the sequence number is taken under a row lock on the lot, and
   *     `(lotId, sequenceNo)` is unique, so simultaneous bids cannot collide.
   *
   * Superseded bids are marked OUTBID, never deleted.
   *
   * @throws AppException AUCTION_NOT_OPEN, BIDDER_NOT_APPROVED,
   *         BIDDER_NOT_REGISTERED_FOR_AUCTION, BID_BELOW_RESERVE,
   *         BID_BELOW_MINIMUM_INCREMENT
   */
  async placeBid(
    actor: AuthenticatedUser,
    input: {
      lotId: string;
      bidderId: string;
      amount: string;
      channel?: BidChannel;
      idempotencyKey: string;
      onBehalf?: boolean;
    },
  ): Promise<BidResult> {
    const amount = toDecimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'A bid must be greater than zero.');
    }

    return this.prisma.transaction(async (tx) => {
      // Idempotency: a double-submitted bid is one bid.
      const existing = await tx.bid.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { lot: { select: { highestBidAmount: true, bidCount: true } } },
      });
      if (existing) {
        return {
          bidId: existing.id,
          sequenceNo: existing.sequenceNo,
          amount: existing.amount.toFixed(4),
          status: existing.status,
          isHighest: existing.status === BidStatus.ACCEPTED,
          duplicate: true,
        };
      }

      // Lock the lot row: this is what serialises concurrent bids.
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          auctionId: string;
          status: AuctionLotStatus;
          reservePrice: Prisma.Decimal;
          minIncrement: Prisma.Decimal;
          highestBidAmount: Prisma.Decimal | null;
          bidCount: number;
          vehicleId: string;
          currency: string;
        }>
      >`
        SELECT "id", "auctionId", "status", "reservePrice", "minIncrement",
               "highestBidAmount", "bidCount", "vehicleId", "currency"
        FROM "auction_lots"
        WHERE "id" = ${input.lotId}::uuid
        FOR UPDATE
      `;
      const lot = locked[0];
      if (!lot) throw notFound('Auction lot', input.lotId);

      const auction = await tx.auction.findFirst({
        where: { id: lot.auctionId, organizationId: actor.organizationId },
      });
      if (!auction) throw notFound('Auction', lot.auctionId);

      /* --- Window ---------------------------------------------------- */
      if (auction.status !== AuctionStatus.OPEN) {
        throw new AppException(
          ErrorCode.AUCTION_NOT_OPEN,
          `Auction ${auction.code} is ${auction.status}; bidding is not open.`,
          { details: { auctionStatus: auction.status } },
        );
      }
      if (lot.status !== AuctionLotStatus.BIDDING_OPEN) {
        throw new AppException(
          ErrorCode.AUCTION_NOT_OPEN,
          `This lot is ${lot.status}; bidding is not open on it.`,
        );
      }
      const now = new Date();
      if (now > auction.scheduledEndAt) {
        throw new AppException(
          ErrorCode.AUCTION_WINDOW_CLOSED,
          'The bidding window for this auction has passed.',
          { details: { closedAt: auction.scheduledEndAt.toISOString() } },
        );
      }

      /* --- Bidder ----------------------------------------------------- */
      const bidder = await tx.bidder.findFirst({
        where: { id: input.bidderId, organizationId: actor.organizationId },
      });
      if (!bidder) throw notFound('Bidder', input.bidderId);
      if (bidder.status !== BidderStatus.APPROVED) {
        throw new AppException(
          ErrorCode.BIDDER_NOT_APPROVED,
          `${bidder.displayName} is ${bidder.status} and cannot bid.`,
          { details: { bidderStatus: bidder.status } },
        );
      }

      const registration = await tx.auctionRegistration.findUnique({
        where: { auctionId_bidderId: { auctionId: auction.id, bidderId: bidder.id } },
      });
      if (!registration || registration.status !== AuctionRegistrationStatus.APPROVED) {
        throw new AppException(
          ErrorCode.BIDDER_NOT_REGISTERED_FOR_AUCTION,
          `${bidder.displayName} is not an approved registrant for auction ${auction.code}.`,
          { details: { registrationStatus: registration?.status ?? 'NOT_REGISTERED' } },
        );
      }

      /* --- Amount ------------------------------------------------------ */
      if (amount.lessThan(lot.reservePrice)) {
        throw new AppException(
          ErrorCode.BID_BELOW_RESERVE,
          `A bid must be at least the reserve of ${lot.currency} ${lot.reservePrice.toFixed(2)}.`,
          { details: { reservePrice: lot.reservePrice.toFixed(4), bid: amount.toFixed(4) } },
        );
      }

      if (lot.highestBidAmount) {
        const minimum = lot.highestBidAmount.add(lot.minIncrement);
        if (amount.lessThan(minimum)) {
          throw new AppException(
            ErrorCode.BID_BELOW_MINIMUM_INCREMENT,
            `The next bid must be at least ${lot.currency} ${minimum.toFixed(2)} ` +
              `(current high ${lot.highestBidAmount.toFixed(2)} plus ${lot.minIncrement.toFixed(2)}).`,
            {
              details: {
                currentHighest: lot.highestBidAmount.toFixed(4),
                minIncrement: lot.minIncrement.toFixed(4),
                minimumAcceptable: minimum.toFixed(4),
              },
            },
          );
        }
      }

      /* --- Record ------------------------------------------------------ */
      const sequenceNo = lot.bidCount + 1;

      const bid = await tx.bid.create({
        data: {
          lotId: lot.id,
          bidderId: bidder.id,
          amount: toPrismaDecimal(amount),
          currency: lot.currency,
          sequenceNo,
          placedAt: now,
          status: BidStatus.ACCEPTED,
          channel: input.channel ?? BidChannel.PORTAL,
          placedById: actor.id,
          placedOnBehalf: input.onBehalf ?? false,
          ipAddress: RequestContextStore.get().ipAddress ?? null,
          userAgent: RequestContextStore.get().userAgent ?? null,
          idempotencyKey: input.idempotencyKey,
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await tx.bidEvent.create({
        data: {
          bidId: bid.id,
          toStatus: BidStatus.ACCEPTED,
          reason: 'Bid accepted.',
          actorId: actor.id,
          actorType: ActorType.USER,
        },
      });

      // Supersede the previous leader. Marked OUTBID, never removed - the
      // ladder is the auction's evidence.
      const previousLeaders = await tx.bid.findMany({
        where: { lotId: lot.id, status: BidStatus.ACCEPTED, id: { not: bid.id } },
      });
      for (const previous of previousLeaders) {
        BidStateMachine.assert(previous.status, BidStatus.OUTBID);
        await tx.bid.update({ where: { id: previous.id }, data: { status: BidStatus.OUTBID } });
        await tx.bidEvent.create({
          data: {
            bidId: previous.id,
            fromStatus: BidStatus.ACCEPTED,
            toStatus: BidStatus.OUTBID,
            reason: `Outbid by sequence ${sequenceNo}.`,
            actorType: ActorType.SYSTEM,
          },
        });
      }

      await tx.auctionLot.update({
        where: { id: lot.id },
        data: {
          bidCount: sequenceNo,
          highestBidAmount: toPrismaDecimal(amount),
          version: { increment: 1 },
        },
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: actor.organizationId,
          vehicleId: lot.vehicleId,
          siteId: auction.siteId,
          type: TimelineEventType.BID_PLACED,
          occurredAt: now,
          actorId: actor.id,
          actorType: ActorType.USER,
          title: `Bid ${lot.currency} ${amount.toFixed(2)} by ${bidder.displayName}`,
          payload: { bidId: bid.id, sequenceNo, channel: bid.channel },
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.outbox.record(tx, {
        eventType: DomainEventType.BID_PLACED,
        aggregateType: 'Bid',
        aggregateId: bid.id,
        payload: {
          bidId: bid.id,
          lotId: lot.id,
          auctionId: auction.id,
          bidderId: bidder.id,
          organizationId: actor.organizationId,
          amount: amount.toFixed(4),
          currency: lot.currency,
          sequenceNo,
          placedAt: now.toISOString(),
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.BID_PLACED,
        entityType: 'Bid',
        entityId: bid.id,
        organizationId: actor.organizationId,
        siteId: auction.siteId,
        afterState: {
          lotId: lot.id,
          bidderId: bidder.id,
          bidderName: bidder.displayName,
          amount: amount.toFixed(4),
          sequenceNo,
          channel: bid.channel,
          onBehalf: bid.placedOnBehalf,
        },
      });

      return {
        bidId: bid.id,
        sequenceNo,
        amount: amount.toFixed(4),
        status: BidStatus.ACCEPTED,
        isHighest: true,
        duplicate: false,
      };
    });
  }

  /**
   * Selects the winning bid for a closed lot.
   *
   * Takes the highest ACCEPTED bid. Refuses if there is none, or if a winner is
   * already recorded — a lot can never acquire a second winner, which the
   * `winningBidId` unique constraint also enforces at the database.
   */
  async selectWinner(
    actor: AuthenticatedUser,
    lotId: string,
    /** Overrides the automatic pick; must still be a real bid on this lot. */
    explicitBidId?: string | null,
  ): Promise<LotDetail> {
    await this.prisma.transaction(async (tx) => {
      const lot = await tx.auctionLot.findUnique({
        where: { id: lotId },
        include: { auction: true },
      });
      if (!lot) throw notFound('Auction lot', lotId);
      if (lot.auction.organizationId !== actor.organizationId) throw notFound('Auction lot', lotId);
      AccessScope.assertSite(actor, lot.auction.siteId);

      if (lot.winningBidId) {
        throw new AppException(
          ErrorCode.WINNER_ALREADY_SELECTED,
          `Lot ${lot.lotNumber} already has a winning bid.`,
        );
      }

      AuctionLotStateMachine.assert(lot.status, AuctionLotStatus.WINNER_SELECTED);

      const winning = explicitBidId
        ? await tx.bid.findFirst({
            where: { id: explicitBidId, lotId, status: BidStatus.ACCEPTED },
          })
        : await tx.bid.findFirst({
            where: { lotId, status: BidStatus.ACCEPTED },
            orderBy: [{ amount: 'desc' }, { placedAt: 'asc' }],
          });

      if (!winning) {
        throw new AppException(
          ErrorCode.NO_ELIGIBLE_BIDS,
          'There is no eligible bid on this lot.',
          { details: { lotNumber: lot.lotNumber } },
        );
      }
      if (winning.amount.lessThan(lot.reservePrice)) {
        throw new AppException(
          ErrorCode.BID_BELOW_RESERVE,
          'The selected bid is below the reserve price.',
        );
      }

      await tx.bid.update({ where: { id: winning.id }, data: { status: BidStatus.WON } });
      await tx.bidEvent.create({
        data: {
          bidId: winning.id,
          fromStatus: BidStatus.ACCEPTED,
          toStatus: BidStatus.WON,
          reason: 'Selected as the winning bid.',
          actorId: actor.id,
          actorType: ActorType.USER,
        },
      });

      // Everything else on the lot is settled as LOST, so no bid is left in an
      // ambiguous state.
      const others = await tx.bid.findMany({
        where: { lotId, id: { not: winning.id }, status: { in: [BidStatus.ACCEPTED, BidStatus.OUTBID] } },
      });
      for (const other of others) {
        await tx.bid.update({ where: { id: other.id }, data: { status: BidStatus.LOST } });
        await tx.bidEvent.create({
          data: {
            bidId: other.id,
            fromStatus: other.status,
            toStatus: BidStatus.LOST,
            reason: 'Another bid won the lot.',
            actorId: actor.id,
            actorType: ActorType.USER,
          },
        });
      }

      await tx.auctionLot.update({
        where: { id: lotId },
        data: {
          status: AuctionLotStatus.WINNER_SELECTED,
          winningBidId: winning.id,
          winnerBidderId: winning.bidderId,
          winnerSelectedById: actor.id,
          winnerSelectedAt: new Date(),
          version: { increment: 1 },
        },
      });

      await this.vehicles.transition(tx, lot.vehicleId, VehicleStatus.WINNER_SELECTED, {
        reason: `Winning bid selected on lot ${lot.lotNumber}.`,
        siteId: lot.auction.siteId,
        actorId: actor.id,
        actorType: ActorType.USER,
        tolerateNoop: true,
      });

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: actor.organizationId,
          vehicleId: lot.vehicleId,
          siteId: lot.auction.siteId,
          type: TimelineEventType.AUCTION_WINNER_SELECTED,
          occurredAt: new Date(),
          actorId: actor.id,
          actorType: ActorType.USER,
          title: `Winning bid ${lot.currency} ${winning.amount.toFixed(2)}`,
          payload: { bidId: winning.id, bidderId: winning.bidderId },
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.outbox.record(tx, {
        eventType: DomainEventType.WINNER_SELECTED,
        aggregateType: 'AuctionLot',
        aggregateId: lotId,
        payload: {
          lotId,
          auctionId: lot.auctionId,
          organizationId: actor.organizationId,
          vehicleId: lot.vehicleId,
          bidderId: winning.bidderId,
          winningBidId: winning.id,
          amount: winning.amount.toFixed(4),
          currency: lot.currency,
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.WINNER_SELECTED,
        entityType: 'AuctionLot',
        entityId: lotId,
        organizationId: actor.organizationId,
        siteId: lot.auction.siteId,
        afterState: {
          lotNumber: lot.lotNumber,
          winningBidId: winning.id,
          bidderId: winning.bidderId,
          amount: winning.amount.toFixed(4),
          selectedManually: explicitBidId !== null && explicitBidId !== undefined,
        },
      });
    });

    return this.findLotById(actor, lotId);
  }

  /**
   * Creates the settlement record for a won lot.
   *
   * Fees and tax are supplied by the operator because auction commercial terms
   * are unresolved (OI-02/OI-03); nothing is assumed. The lot's unique
   * `lotId` on `auction_settlements` prevents a second settlement.
   */
  async createSettlement(
    actor: AuthenticatedUser,
    lotId: string,
    input: { feesAmount?: string | null; taxAmount?: string | null; dueDate?: Date | null; notes?: string | null },
  ): Promise<SettlementDetail> {
    const settlementId = await this.prisma.transaction(async (tx) => {
      const lot = await tx.auctionLot.findUnique({
        where: { id: lotId },
        include: { auction: true, winningBid: true, settlement: true },
      });
      if (!lot) throw notFound('Auction lot', lotId);
      if (lot.auction.organizationId !== actor.organizationId) throw notFound('Auction lot', lotId);
      AccessScope.assertSite(actor, lot.auction.siteId);

      if (lot.settlement) {
        throw new AppException(
          ErrorCode.SETTLEMENT_ALREADY_EXISTS,
          `Lot ${lot.lotNumber} already has a settlement.`,
        );
      }
      if (!lot.winningBid || !lot.winnerBidderId) {
        throw new AppException(
          ErrorCode.NO_ELIGIBLE_BIDS,
          'A winner must be selected before a settlement can be created.',
        );
      }

      AuctionLotStateMachine.assert(lot.status, AuctionLotStatus.SETTLEMENT_PENDING);

      const saleAmount = lot.winningBid.amount;
      const fees = toDecimal(input.feesAmount ?? '0');
      const tax = toDecimal(input.taxAmount ?? '0');
      const totalPayable = saleAmount.add(toPrismaDecimal(fees)).add(toPrismaDecimal(tax));

      const settlement = await tx.auctionSettlement.create({
        data: {
          auctionId: lot.auctionId,
          lotId: lot.id,
          bidderId: lot.winnerBidderId,
          winningBidId: lot.winningBid.id,
          saleAmount,
          feesAmount: toPrismaDecimal(fees),
          taxAmount: toPrismaDecimal(tax),
          totalPayable,
          currency: lot.currency,
          dueDate: input.dueDate ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });

      await tx.auctionLot.update({
        where: { id: lotId },
        data: { status: AuctionLotStatus.SETTLEMENT_PENDING, version: { increment: 1 } },
      });

      await this.vehicles.transition(tx, lot.vehicleId, VehicleStatus.SETTLEMENT_PENDING, {
        reason: `Settlement raised for lot ${lot.lotNumber}.`,
        siteId: lot.auction.siteId,
        actorId: actor.id,
        actorType: ActorType.USER,
        tolerateNoop: true,
      });

      await this.outbox.record(tx, {
        eventType: DomainEventType.SETTLEMENT_CREATED,
        aggregateType: 'AuctionSettlement',
        aggregateId: settlement.id,
        payload: {
          settlementId: settlement.id,
          lotId,
          auctionId: lot.auctionId,
          organizationId: actor.organizationId,
          bidderId: lot.winnerBidderId,
          totalPayable: totalPayable.toFixed(4),
          amountReceived: '0.0000',
          status: settlement.status,
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.SETTLEMENT_CREATED,
        entityType: 'AuctionSettlement',
        entityId: settlement.id,
        organizationId: actor.organizationId,
        siteId: lot.auction.siteId,
        afterState: {
          lotNumber: lot.lotNumber,
          saleAmount: saleAmount.toFixed(4),
          feesAmount: fees.toFixed(4),
          taxAmount: tax.toFixed(4),
          totalPayable: totalPayable.toFixed(4),
        },
      });

      return settlement.id;
    });

    return this.findSettlementById(actor, settlementId);
  }

  /**
   * Records money received against a settlement.
   *
   * When fully received, the lot settles and the vehicle becomes SETTLED then
   * SOLD — explicit transitions, because a settlement existing is not the same
   * as a vehicle having been disposed of.
   */
  async recordSettlementReceipt(
    actor: AuthenticatedUser,
    settlementId: string,
    input: { amount: string; reference?: string | null },
  ): Promise<SettlementDetail> {
    await this.prisma.transaction(async (tx) => {
      const settlement = await tx.auctionSettlement.findUnique({
        where: { id: settlementId },
        include: { auction: true, lot: true },
      });
      if (!settlement) throw notFound('Settlement', settlementId);
      if (settlement.auction.organizationId !== actor.organizationId) {
        throw notFound('Settlement', settlementId);
      }
      AccessScope.assertSite(actor, settlement.auction.siteId);

      const amount = toDecimal(input.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new AppException(ErrorCode.VALIDATION_FAILED, 'The amount must be positive.');
      }

      const received = settlement.amountReceived.add(toPrismaDecimal(amount));
      if (received.greaterThan(settlement.totalPayable)) {
        throw new AppException(
          ErrorCode.PAYMENT_EXCEEDS_BALANCE,
          `That receipt exceeds the amount payable (${settlement.currency} ${settlement.totalPayable.toFixed(2)}).`,
        );
      }

      const fullySettled = received.greaterThanOrEqualTo(settlement.totalPayable);

      await tx.auctionSettlement.update({
        where: { id: settlementId },
        data: {
          amountReceived: received,
          status: fullySettled ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          settledAt: fullySettled ? new Date() : null,
          settledById: fullySettled ? actor.id : null,
          notes: input.reference
            ? `${settlement.notes ?? ''}\nReceipt: ${input.reference}`.trim().slice(0, 1000)
            : settlement.notes,
          version: { increment: 1 },
        },
      });

      if (fullySettled) {
        await tx.auctionLot.update({
          where: { id: settlement.lotId },
          data: { status: AuctionLotStatus.SETTLED, version: { increment: 1 } },
        });

        // Two explicit transitions: settled, then sold. A vehicle is not
        // disposed of merely because money arrived.
        await this.vehicles.transition(tx, settlement.lot.vehicleId, VehicleStatus.SETTLED, {
          reason: `Settlement received in full for lot ${settlement.lot.lotNumber}.`,
          siteId: settlement.auction.siteId,
          actorId: actor.id,
          actorType: ActorType.USER,
          tolerateNoop: true,
        });
        await this.vehicles.transition(tx, settlement.lot.vehicleId, VehicleStatus.SOLD, {
          reason: `Sold at auction ${settlement.auction.code}.`,
          siteId: settlement.auction.siteId,
          actorId: actor.id,
          actorType: ActorType.USER,
          tolerateNoop: true,
        });

        await tx.vehicleTimelineEvent.create({
          data: {
            organizationId: actor.organizationId,
            vehicleId: settlement.lot.vehicleId,
            siteId: settlement.auction.siteId,
            type: TimelineEventType.AUCTION_SETTLED,
            occurredAt: new Date(),
            actorId: actor.id,
            actorType: ActorType.USER,
            title: `Settled: ${settlement.currency} ${settlement.totalPayable.toFixed(2)} received`,
            correlationId: RequestContextStore.correlationId(),
          },
        });

        await this.outbox.record(tx, {
          eventType: DomainEventType.SETTLEMENT_COMPLETED,
          aggregateType: 'AuctionSettlement',
          aggregateId: settlementId,
          payload: {
            settlementId,
            lotId: settlement.lotId,
            auctionId: settlement.auctionId,
            organizationId: actor.organizationId,
            bidderId: settlement.bidderId,
            totalPayable: settlement.totalPayable.toFixed(4),
            amountReceived: received.toFixed(4),
            status: 'RECEIVED',
          },
        });
      }

      await this.audit.record(tx, {
        action: AuditAction.SETTLEMENT_UPDATED,
        entityType: 'AuctionSettlement',
        entityId: settlementId,
        organizationId: actor.organizationId,
        siteId: settlement.auction.siteId,
        beforeState: { amountReceived: settlement.amountReceived.toFixed(4) },
        afterState: {
          amountReceived: received.toFixed(4),
          status: fullySettled ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          reference: input.reference ?? null,
        },
      });
    });

    return this.findSettlementById(actor, settlementId);
  }

  /* ---------------------------------------------------------------- */
  /* Bidders                                                           */
  /* ---------------------------------------------------------------- */

  async createBidder(
    actor: AuthenticatedUser,
    input: {
      legalName: string;
      displayName: string;
      contactName: string;
      phone: string;
      email?: string | null;
      pan?: string | null;
      gstin?: string | null;
      city?: string | null;
    },
  ): Promise<BidderItem> {
    const { generateBidderCode } = await import('@/common/util/ids');

    const bidder = await this.prisma.transaction(async (tx) => {
      const created = await tx.bidder.create({
        data: {
          organizationId: actor.organizationId,
          code: generateBidderCode(),
          legalName: input.legalName,
          displayName: input.displayName,
          contactName: input.contactName,
          phone: input.phone,
          email: input.email ?? null,
          pan: input.pan ?? null,
          gstin: input.gstin ?? null,
          city: input.city ?? null,
          // Registration alone confers nothing; KYC approval is separate.
          status: BidderStatus.KYC_PENDING,
          createdById: actor.id,
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.BIDDER_REGISTERED,
        entityType: 'Bidder',
        entityId: created.id,
        organizationId: actor.organizationId,
        afterState: { code: created.code, legalName: created.legalName, status: created.status },
      });

      return created;
    });

    return toBidderItem(bidder);
  }

  async approveBidder(actor: AuthenticatedUser, bidderId: string): Promise<BidderItem> {
    const bidder = await this.prisma.transaction(async (tx) => {
      const existing = await tx.bidder.findFirst({
        where: { id: bidderId, organizationId: actor.organizationId },
      });
      if (!existing) throw notFound('Bidder', bidderId);

      const updated = await tx.bidder.update({
        where: { id: bidderId },
        data: {
          status: BidderStatus.APPROVED,
          kycVerifiedAt: new Date(),
          kycVerifiedById: actor.id,
          approvedById: actor.id,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.BIDDER_APPROVED,
        entityType: 'Bidder',
        entityId: bidderId,
        organizationId: actor.organizationId,
        beforeState: { status: existing.status },
        afterState: { status: BidderStatus.APPROVED },
      });

      return updated;
    });

    return toBidderItem(bidder);
  }

  async registerBidderForAuction(
    actor: AuthenticatedUser,
    auctionId: string,
    bidderId: string,
    depositPaid: string,
    depositReference?: string | null,
  ): Promise<{ registrationId: string; status: string }> {
    return this.prisma.transaction(async (tx) => {
      const auction = await tx.auction.findFirst({
        where: { id: auctionId, organizationId: actor.organizationId },
      });
      if (!auction) throw notFound('Auction', auctionId);

      const bidder = await tx.bidder.findFirst({
        where: { id: bidderId, organizationId: actor.organizationId },
      });
      if (!bidder) throw notFound('Bidder', bidderId);
      if (bidder.status !== BidderStatus.APPROVED) {
        throw new AppException(
          ErrorCode.BIDDER_NOT_APPROVED,
          `${bidder.displayName} must complete KYC approval before registering.`,
        );
      }

      // The deposit requirement is configured per auction; if one is set, it
      // must be met. Nothing is assumed about the amount.
      if (auction.registrationDeposit && toDecimal(depositPaid).lessThan(auction.registrationDeposit)) {
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          `This auction requires a deposit of ${auction.currency} ${auction.registrationDeposit.toFixed(2)}.`,
        );
      }

      const registration = await tx.auctionRegistration.upsert({
        where: { auctionId_bidderId: { auctionId, bidderId } },
        create: {
          auctionId,
          bidderId,
          status: AuctionRegistrationStatus.APPROVED,
          depositPaid: toPrismaDecimal(depositPaid),
          depositReference: depositReference ?? null,
          approvedById: actor.id,
          approvedAt: new Date(),
        },
        update: {
          status: AuctionRegistrationStatus.APPROVED,
          depositPaid: toPrismaDecimal(depositPaid),
          depositReference: depositReference ?? null,
          approvedById: actor.id,
          approvedAt: new Date(),
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.BIDDER_REGISTERED,
        entityType: 'AuctionRegistration',
        entityId: registration.id,
        organizationId: actor.organizationId,
        siteId: auction.siteId,
        afterState: {
          auctionCode: auction.code,
          bidderId,
          depositPaid: registration.depositPaid.toFixed(4),
        },
      });

      return { registrationId: registration.id, status: registration.status };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  async listAuctions(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
    filters: { status?: AuctionStatus[] },
  ): Promise<Paginated<AuctionListItem>> {
    const siteFilter = AccessScope.siteFilter(actor);
    const where: Prisma.AuctionWhereInput = {
      organizationId: actor.organizationId,
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(siteFilter ? { OR: [{ siteId: null }, { siteId: siteFilter }] } : {}),
    };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.auction.findMany({
        where,
        include: { site: { select: { name: true } }, _count: { select: { lots: true, registrations: true } } },
        orderBy: { scheduledStartAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.auction.count({ where }),
    ]);

    return paginate(
      rows.map((row) => ({
        id: row.id,
        code: row.code,
        title: row.title,
        status: row.status,
        siteName: row.site?.name ?? null,
        scheduledStartAt: row.scheduledStartAt.toISOString(),
        scheduledEndAt: row.scheduledEndAt.toISOString(),
        currency: row.currency,
        defaultMinIncrement: row.defaultMinIncrement.toFixed(4),
        lotCount: row._count.lots,
        registrationCount: row._count.registrations,
      })),
      totalItems,
      query,
    );
  }

  async findAuctionById(actor: AuthenticatedUser, auctionId: string): Promise<AuctionDetail> {
    const auction = await this.prisma.auction.findFirst({
      where: { id: auctionId, organizationId: actor.organizationId },
      include: {
        site: { select: { id: true, name: true } },
        lots: {
          include: {
            vehicle: { select: { id: true, registrationNumber: true, make: true, model: true } },
            winner: { select: { id: true, displayName: true } },
            settlement: { select: { id: true, status: true, totalPayable: true, amountReceived: true } },
          },
          orderBy: { lotNumber: 'asc' },
        },
        registrations: { include: { bidder: { select: { id: true, displayName: true, status: true } } } },
      },
    });
    if (!auction) throw notFound('Auction', auctionId);

    return {
      id: auction.id,
      code: auction.code,
      title: auction.title,
      description: auction.description,
      status: auction.status,
      siteId: auction.siteId,
      siteName: auction.site?.name ?? null,
      scheduledStartAt: auction.scheduledStartAt.toISOString(),
      scheduledEndAt: auction.scheduledEndAt.toISOString(),
      actualStartAt: auction.actualStartAt?.toISOString() ?? null,
      actualEndAt: auction.actualEndAt?.toISOString() ?? null,
      currency: auction.currency,
      defaultMinIncrement: auction.defaultMinIncrement.toFixed(4),
      registrationDeposit: auction.registrationDeposit?.toFixed(4) ?? null,
      termsAndConditions: auction.termsAndConditions,
      lots: auction.lots.map((lot) => ({
        id: lot.id,
        lotNumber: lot.lotNumber,
        status: lot.status,
        vehicleId: lot.vehicleId,
        registrationNumber: lot.vehicle.registrationNumber,
        make: lot.vehicle.make,
        model: lot.vehicle.model,
        reservePrice: lot.reservePrice.toFixed(4),
        minIncrement: lot.minIncrement.toFixed(4),
        highestBidAmount: lot.highestBidAmount?.toFixed(4) ?? null,
        bidCount: lot.bidCount,
        winnerName: lot.winner?.displayName ?? null,
        settlementStatus: lot.settlement?.status ?? null,
        currency: lot.currency,
      })),
      registrations: auction.registrations.map((registration) => ({
        bidderId: registration.bidderId,
        bidderName: registration.bidder.displayName,
        status: registration.status,
        depositPaid: registration.depositPaid.toFixed(4),
      })),
    };
  }

  async findLotById(actor: AuthenticatedUser, lotId: string): Promise<LotDetail> {
    const lot = await this.prisma.auctionLot.findFirst({
      where: { id: lotId, auction: { organizationId: actor.organizationId } },
      include: {
        auction: { select: { id: true, code: true, status: true, siteId: true } },
        vehicle: { select: { id: true, registrationNumber: true, make: true, model: true, status: true } },
        winner: { select: { id: true, displayName: true } },
        settlement: true,
        bids: {
          include: { bidder: { select: { id: true, displayName: true } } },
          orderBy: { sequenceNo: 'desc' },
        },
      },
    });
    if (!lot) throw notFound('Auction lot', lotId);

    return {
      id: lot.id,
      auctionId: lot.auction.id,
      auctionCode: lot.auction.code,
      auctionStatus: lot.auction.status,
      lotNumber: lot.lotNumber,
      status: lot.status,
      vehicleId: lot.vehicleId,
      registrationNumber: lot.vehicle.registrationNumber,
      make: lot.vehicle.make,
      model: lot.vehicle.model,
      vehicleStatus: lot.vehicle.status,
      reservePrice: lot.reservePrice.toFixed(4),
      minIncrement: lot.minIncrement.toFixed(4),
      highestBidAmount: lot.highestBidAmount?.toFixed(4) ?? null,
      bidCount: lot.bidCount,
      currency: lot.currency,
      description: lot.description,
      conditionNotes: lot.conditionNotes,
      winnerBidderId: lot.winnerBidderId,
      winnerName: lot.winner?.displayName ?? null,
      settlementId: lot.settlement?.id ?? null,
      settlementStatus: lot.settlement?.status ?? null,
      // Full ladder, newest first. Superseded bids are present and marked, never
      // removed - this is the auction's evidence.
      bids: lot.bids.map((bid) => ({
        id: bid.id,
        sequenceNo: bid.sequenceNo,
        bidderId: bid.bidderId,
        bidderName: bid.bidder.displayName,
        amount: bid.amount.toFixed(4),
        status: bid.status,
        channel: bid.channel,
        placedAt: bid.placedAt.toISOString(),
        placedOnBehalf: bid.placedOnBehalf,
      })),
    };
  }

  async findSettlementById(
    actor: AuthenticatedUser,
    settlementId: string,
  ): Promise<SettlementDetail> {
    const settlement = await this.prisma.auctionSettlement.findFirst({
      where: { id: settlementId, auction: { organizationId: actor.organizationId } },
      include: {
        auction: { select: { code: true } },
        lot: { select: { lotNumber: true, vehicleId: true } },
        bidder: { select: { id: true, displayName: true, legalName: true } },
        saleInvoice: { select: { id: true, invoiceNumber: true, status: true } },
      },
    });
    if (!settlement) throw notFound('Settlement', settlementId);

    return {
      id: settlement.id,
      auctionCode: settlement.auction.code,
      lotNumber: settlement.lot.lotNumber,
      vehicleId: settlement.lot.vehicleId,
      bidderId: settlement.bidder.id,
      bidderName: settlement.bidder.displayName,
      saleAmount: settlement.saleAmount.toFixed(4),
      feesAmount: settlement.feesAmount.toFixed(4),
      taxAmount: settlement.taxAmount.toFixed(4),
      totalPayable: settlement.totalPayable.toFixed(4),
      amountReceived: settlement.amountReceived.toFixed(4),
      currency: settlement.currency,
      status: settlement.status,
      dueDate: settlement.dueDate?.toISOString() ?? null,
      settledAt: settlement.settledAt?.toISOString() ?? null,
      saleInvoiceId: settlement.saleInvoice?.id ?? null,
      saleInvoiceNumber: settlement.saleInvoice?.invoiceNumber ?? null,
      notes: settlement.notes,
    };
  }

  async listBidders(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<Paginated<BidderItem>> {
    const where: Prisma.BidderWhereInput = { organizationId: actor.organizationId };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.bidder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.bidder.count({ where }),
    ]);
    return paginate(rows.map(toBidderItem), totalItems, query);
  }

  /* ---------------------------------------------------------------- */

  private async transitionLot(
    tx: PrismaTransaction,
    lotId: string,
    to: AuctionLotStatus,
  ): Promise<void> {
    const lot = await tx.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { status: true, version: true },
    });
    AuctionLotStateMachine.assert(lot.status, to);
    const result = await tx.auctionLot.updateMany({
      where: { id: lotId, version: lot.version },
      data: { status: to, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new AppException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'The lot changed while you were working on it. Reload and try again.',
      );
    }
  }
}

/* ------------------------------------------------------------------ */

export interface AuctionListItem {
  id: string;
  code: string;
  title: string;
  status: string;
  siteName: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  currency: string;
  defaultMinIncrement: string;
  lotCount: number;
  registrationCount: number;
}

export interface AuctionDetail {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  siteId: string | null;
  siteName: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  actualStartAt: string | null;
  actualEndAt: string | null;
  currency: string;
  defaultMinIncrement: string;
  registrationDeposit: string | null;
  termsAndConditions: string | null;
  lots: Array<{
    id: string;
    lotNumber: number;
    status: string;
    vehicleId: string;
    registrationNumber: string;
    make: string | null;
    model: string | null;
    reservePrice: string;
    minIncrement: string;
    highestBidAmount: string | null;
    bidCount: number;
    winnerName: string | null;
    settlementStatus: string | null;
    currency: string;
  }>;
  registrations: Array<{
    bidderId: string;
    bidderName: string;
    status: string;
    depositPaid: string;
  }>;
}

export interface LotDetail {
  id: string;
  auctionId: string;
  auctionCode: string;
  auctionStatus: string;
  lotNumber: number;
  status: string;
  vehicleId: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  vehicleStatus: string;
  reservePrice: string;
  minIncrement: string;
  highestBidAmount: string | null;
  bidCount: number;
  currency: string;
  description: string | null;
  conditionNotes: string | null;
  winnerBidderId: string | null;
  winnerName: string | null;
  settlementId: string | null;
  settlementStatus: string | null;
  bids: Array<{
    id: string;
    sequenceNo: number;
    bidderId: string;
    bidderName: string;
    amount: string;
    status: string;
    channel: string;
    placedAt: string;
    placedOnBehalf: boolean;
  }>;
}

export interface SettlementDetail {
  id: string;
  auctionCode: string;
  lotNumber: number;
  vehicleId: string;
  bidderId: string;
  bidderName: string;
  saleAmount: string;
  feesAmount: string;
  taxAmount: string;
  totalPayable: string;
  amountReceived: string;
  currency: string;
  status: string;
  dueDate: string | null;
  settledAt: string | null;
  saleInvoiceId: string | null;
  saleInvoiceNumber: string | null;
  notes: string | null;
}

export interface BidResult {
  bidId: string;
  sequenceNo: number;
  amount: string;
  status: string;
  isHighest: boolean;
  duplicate: boolean;
}

export interface BidderItem {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  contactName: string;
  phone: string;
  email: string | null;
  status: string;
  kycVerifiedAt: string | null;
  createdAt: string;
}

function toBidderItem(row: {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  contactName: string;
  phone: string;
  email: string | null;
  status: string;
  kycVerifiedAt: Date | null;
  createdAt: Date;
}): BidderItem {
  return {
    id: row.id,
    code: row.code,
    legalName: row.legalName,
    displayName: row.displayName,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    status: row.status,
    kycVerifiedAt: row.kycVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
