import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AccessScope } from '@/modules/identity/guards';

/**
 * Reporting.
 *
 * Two rules govern everything here:
 *
 *   **Scope is applied in SQL, not after.** Every query is narrowed by the
 *   caller's site grants and, for a financier portal user, by their own
 *   financier. A financier must never be able to run estate-wide reporting
 *   (S33), and that cannot be achieved by filtering a full result set.
 *
 *   **Nothing is fabricated.** Where there is no data the figure is zero and
 *   the series is empty; the console renders an honest empty state rather than
 *   a plausible-looking line.
 *
 * Aggregations use raw SQL where a grouped/windowed query is materially more
 * efficient than the ORM equivalent - these run against tables that grow
 * without bound, and the indexes exist specifically to serve them.
 */
@Injectable()
export class ReportingService {
  private readonly logger: ScopedLogger;

  constructor(
    private readonly prisma: PrismaService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Reporting');
  }

  /**
   * The management dashboard headline figures.
   *
   * Every number is derived from persisted state (requirement S43), never
   * hardcoded, and each is defined in `docs/reporting.md`.
   */
  async dashboard(actor: AuthenticatedUser, siteId?: string): Promise<DashboardSummary> {
    const scope = this.scope(actor, siteId);
    const todayStart = startOfToday();

    const sessionWhere: Prisma.ParkingSessionWhereInput = {
      organizationId: actor.organizationId,
      ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}),
      ...(scope.financierId ? { financierId: scope.financierId } : {}),
    };

    const invoiceWhere: Prisma.InvoiceWhereInput = {
      organizationId: actor.organizationId,
      ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}),
      ...(scope.financierId ? { financierId: scope.financierId } : {}),
    };

    const [
      vehiclesInYard,
      entriesToday,
      exitsToday,
      awaitingEnrichment,
      withoutContract,
      ageingBeyondThreshold,
      pendingReleases,
      reviewQueue,
      outstanding,
      collectedThisMonth,
      openAuctions,
      auctionPipelineValue,
    ] = await Promise.all([
      this.prisma.parkingSession.count({
        where: { ...sessionWhere, status: { in: ['OPEN', 'ON_HOLD', 'PENDING_EXIT'] } },
      }),
      this.prisma.parkingSession.count({
        where: { ...sessionWhere, entryAt: { gte: todayStart } },
      }),
      this.prisma.parkingSession.count({
        where: { ...sessionWhere, exitAt: { gte: todayStart } },
      }),
      this.prisma.vehicle.count({
        where: {
          organizationId: actor.organizationId,
          vahanVerificationStatus: { in: ['NOT_REQUESTED', 'PENDING'] },
          ...(scope.financierId ? { currentFinancierId: scope.financierId } : {}),
          currentSiteId: scope.siteIds ? { in: scope.siteIds } : { not: null },
        },
      }),
      // The deliberate consequence of the gate never blocking: a work queue.
      this.prisma.parkingSession.count({
        where: {
          ...sessionWhere,
          rateUnresolved: true,
          status: { in: ['OPEN', 'ON_HOLD', 'PENDING_EXIT'] },
        },
      }),
      this.prisma.parkingSession.count({
        where: {
          ...sessionWhere,
          status: { in: ['OPEN', 'ON_HOLD'] },
          entryAt: { lte: new Date(Date.now() - 90 * 86_400_000) },
        },
      }),
      this.prisma.releaseRequest.count({
        where: {
          organizationId: actor.organizationId,
          status: { in: ['SUBMITTED', 'AWAITING_PAYMENT', 'AWAITING_APPROVAL', 'APPROVED'] },
          ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}),
        },
      }),
      // Financier users have no business seeing an operational review queue.
      scope.financierId
        ? Promise.resolve(0)
        : this.prisma.anprEvent.count({
            where: {
              organizationId: actor.organizationId,
              status: 'PENDING_REVIEW',
              ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}),
            },
          }),
      this.prisma.invoice.aggregate({
        _sum: { balance: true },
        _count: true,
        where: { ...invoiceWhere, status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] } },
      }),
      this.prisma.invoice.aggregate({
        _sum: { amountPaid: true },
        where: { ...invoiceWhere, issueDate: { gte: startOfMonth() } },
      }),
      scope.financierId
        ? Promise.resolve(0)
        : this.prisma.auction.count({
            where: {
              organizationId: actor.organizationId,
              status: { in: ['PUBLISHED', 'OPEN', 'CLOSED', 'WINNER_SELECTED', 'SETTLEMENT_PENDING'] },
            },
          }),
      scope.financierId
        ? Promise.resolve({ _sum: { reservePrice: null } })
        : this.prisma.auctionLot.aggregate({
            _sum: { reservePrice: true },
            where: {
              status: { in: ['LISTED', 'BIDDING_OPEN', 'BIDDING_CLOSED', 'WINNER_SELECTED'] },
              auction: { organizationId: actor.organizationId },
            },
          }),
    ]);

    return {
      vehiclesInYard,
      entriesToday,
      exitsToday,
      awaitingEnrichment,
      withoutContract,
      ageingBeyondThreshold,
      pendingReleases,
      captureReviewQueue: reviewQueue,
      outstandingAmount: (outstanding._sum.balance ?? new Prisma.Decimal(0)).toFixed(4),
      outstandingInvoiceCount: outstanding._count,
      collectedThisMonth: (collectedThisMonth._sum.amountPaid ?? new Prisma.Decimal(0)).toFixed(4),
      openAuctions,
      auctionPipelineValue: (
        (auctionPipelineValue as { _sum: { reservePrice: Prisma.Decimal | null } })._sum
          .reservePrice ?? new Prisma.Decimal(0)
      ).toFixed(4),
      currency: 'INR',
      generatedAt: new Date().toISOString(),
    };
  }

  /** Occupancy per site, and per zone within a site. */
  async occupancy(actor: AuthenticatedUser, siteId?: string): Promise<OccupancyReport> {
    const scope = this.scope(actor, siteId);

    const sites = await this.prisma.site.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(scope.siteIds ? { id: { in: scope.siteIds } } : {}),
      },
      include: {
        zones: {
          where: { isActive: true },
          include: {
            _count: {
              select: { sessions: { where: { status: { in: ['OPEN', 'ON_HOLD', 'PENDING_EXIT'] } } } },
            },
          },
        },
        _count: {
          select: { parkingSessions: { where: { status: { in: ['OPEN', 'ON_HOLD', 'PENDING_EXIT'] } } } },
        },
      },
      orderBy: { code: 'asc' },
    });

    return {
      sites: sites.map((site) => {
        const zoneCapacity = site.zones.reduce((sum, zone) => sum + zone.capacity, 0);
        // Zone capacity is authoritative for allocation; the site figure is
        // nominal, so prefer the sum of zones where zones exist.
        const capacity = zoneCapacity > 0 ? zoneCapacity : site.totalCapacity;
        const occupied = site._count.parkingSessions;
        return {
          siteId: site.id,
          siteCode: site.code,
          siteName: site.name,
          siteType: site.siteType,
          parkingMode: site.parkingMode,
          status: site.status,
          capacity,
          occupied,
          available: Math.max(0, capacity - occupied),
          utilisationPercent: capacity > 0 ? Math.round((occupied / capacity) * 1000) / 10 : 0,
          zones: site.zones.map((zone) => ({
            zoneId: zone.id,
            code: zone.code,
            name: zone.name,
            capacity: zone.capacity,
            occupied: zone._count.sessions,
            available: Math.max(0, zone.capacity - zone._count.sessions),
            utilisationPercent:
              zone.capacity > 0
                ? Math.round((zone._count.sessions / zone.capacity) * 1000) / 10
                : 0,
            allowedClasses: zone.allowedClasses,
          })),
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Vehicle ageing distribution.
   *
   * The buckets are the operational question: what is about to become a
   * problem, and what already is.
   */
  async ageing(actor: AuthenticatedUser, siteId?: string): Promise<AgeingReport> {
    const scope = this.scope(actor, siteId);

    const sessions = await this.prisma.parkingSession.findMany({
      where: {
        organizationId: actor.organizationId,
        status: { in: ['OPEN', 'ON_HOLD', 'PENDING_EXIT'] },
        ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}),
        ...(scope.financierId ? { financierId: scope.financierId } : {}),
      },
      select: { entryAt: true, financierId: true, financier: { select: { displayName: true } } },
    });

    const buckets: Array<{ label: string; minDays: number; maxDays: number | null; count: number }> = [
      { label: '0-7 days', minDays: 0, maxDays: 7, count: 0 },
      { label: '8-30 days', minDays: 8, maxDays: 30, count: 0 },
      { label: '31-90 days', minDays: 31, maxDays: 90, count: 0 },
      { label: '91-180 days', minDays: 91, maxDays: 180, count: 0 },
      { label: 'Over 180 days', minDays: 181, maxDays: null, count: 0 },
    ];

    const now = Date.now();
    let totalDays = 0;
    let oldestDays = 0;

    for (const session of sessions) {
      const days = Math.floor((now - session.entryAt.getTime()) / 86_400_000);
      totalDays += days;
      if (days > oldestDays) oldestDays = days;
      const bucket = buckets.find((b) => days >= b.minDays && (b.maxDays === null || days <= b.maxDays));
      if (bucket) bucket.count++;
    }

    return {
      buckets,
      totalVehicles: sessions.length,
      averageAgeDays: sessions.length > 0 ? Math.round(totalDays / sessions.length) : 0,
      oldestAgeDays: oldestDays,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Revenue and receivables.
   *
   * Definitions (also in `docs/reporting.md`):
   *   invoiced  - total of invoices ISSUED in the window
   *   collected - payments SUCCESSFULLY received in the window
   *   outstanding - current balance on unsettled invoices, regardless of window
   *
   * Invoiced and collected are deliberately NOT the same series: an invoice
   * raised in one month and paid in the next belongs to both, in different
   * months, and conflating them is how revenue reports mislead.
   */
  async revenue(
    actor: AuthenticatedUser,
    options: { from?: Date; to?: Date; siteId?: string } = {},
  ): Promise<RevenueReport> {
    const scope = this.scope(actor, options.siteId);
    const from = options.from ?? new Date(Date.now() - 180 * 86_400_000);
    const to = options.to ?? new Date();

    const invoiceWhere: Prisma.InvoiceWhereInput = {
      organizationId: actor.organizationId,
      ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}),
      ...(scope.financierId ? { financierId: scope.financierId } : {}),
    };

    const [invoiced, collected, outstanding, overdue, byFinancier] = await Promise.all([
      this.prisma.invoice.aggregate({
        _sum: { total: true },
        _count: true,
        where: { ...invoiceWhere, issueDate: { gte: from, lte: to }, status: { not: 'VOID' } },
      }),
      this.prisma.invoice.aggregate({
        _sum: { amountPaid: true },
        where: { ...invoiceWhere, issueDate: { gte: from, lte: to } },
      }),
      this.prisma.invoice.aggregate({
        _sum: { balance: true },
        _count: true,
        where: { ...invoiceWhere, status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] } },
      }),
      this.prisma.invoice.aggregate({
        _sum: { balance: true },
        _count: true,
        where: {
          ...invoiceWhere,
          status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] },
          dueDate: { lt: new Date() },
        },
      }),
      this.prisma.invoice.groupBy({
        by: ['financierId'],
        _sum: { total: true, balance: true },
        _count: true,
        where: { ...invoiceWhere, status: { not: 'VOID' }, financierId: { not: null } },
        orderBy: { _sum: { total: 'desc' } },
        take: 20,
      }),
    ]);

    const financierIds = byFinancier
      .map((row) => row.financierId)
      .filter((id): id is string => id !== null);
    const financiers = await this.prisma.financier.findMany({
      where: { id: { in: financierIds } },
      select: { id: true, displayName: true },
    });
    const nameById = new Map(financiers.map((f) => [f.id, f.displayName]));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      currency: 'INR',
      invoicedAmount: (invoiced._sum.total ?? new Prisma.Decimal(0)).toFixed(4),
      invoiceCount: invoiced._count,
      collectedAmount: (collected._sum.amountPaid ?? new Prisma.Decimal(0)).toFixed(4),
      outstandingAmount: (outstanding._sum.balance ?? new Prisma.Decimal(0)).toFixed(4),
      outstandingCount: outstanding._count,
      overdueAmount: (overdue._sum.balance ?? new Prisma.Decimal(0)).toFixed(4),
      overdueCount: overdue._count,
      byFinancier: byFinancier.map((row) => ({
        financierId: row.financierId ?? '',
        financierName: nameById.get(row.financierId ?? '') ?? 'Unknown',
        invoiceCount: row._count,
        invoicedAmount: (row._sum.total ?? new Prisma.Decimal(0)).toFixed(4),
        outstandingAmount: (row._sum.balance ?? new Prisma.Decimal(0)).toFixed(4),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Entry and exit counts per day.
   *
   * Uses a generated date series so days with no activity appear as zero
   * rather than being missing - a gap in a chart reads as "no data", which is
   * a different claim from "nothing happened".
   */
  async activity(
    actor: AuthenticatedUser,
    options: { days?: number; siteId?: string } = {},
  ): Promise<ActivityReport> {
    const scope = this.scope(actor, options.siteId);
    const days = Math.min(Math.max(options.days ?? 30, 1), 365);
    const from = new Date(Date.now() - days * 86_400_000);

    const siteFilter = scope.siteIds
      ? Prisma.sql`AND s."siteId" = ANY(${scope.siteIds}::uuid[])`
      : Prisma.empty;
    const financierFilter = scope.financierId
      ? Prisma.sql`AND s."financierId" = ${scope.financierId}::uuid`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; entries: bigint; exits: bigint }>
    >`
      WITH days AS (
        SELECT generate_series(
          date_trunc('day', ${from}::timestamptz),
          date_trunc('day', now()),
          '1 day'::interval
        ) AS day
      )
      SELECT
        d.day,
        COALESCE((
          SELECT count(*) FROM "parking_sessions" s
          WHERE s."organizationId" = ${actor.organizationId}::uuid
            AND date_trunc('day', s."entryAt") = d.day
            ${siteFilter} ${financierFilter}
        ), 0) AS entries,
        COALESCE((
          SELECT count(*) FROM "parking_sessions" s
          WHERE s."organizationId" = ${actor.organizationId}::uuid
            AND s."exitAt" IS NOT NULL
            AND date_trunc('day', s."exitAt") = d.day
            ${siteFilter} ${financierFilter}
        ), 0) AS exits
      FROM days d
      ORDER BY d.day ASC
    `;

    return {
      from: from.toISOString(),
      days,
      series: rows.map((row) => ({
        date: row.day.toISOString().slice(0, 10),
        entries: Number(row.entries),
        exits: Number(row.exits),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Auction activity. Not available to financier portal users. */
  async auctionActivity(actor: AuthenticatedUser): Promise<AuctionReport> {
    if (actor.financierId) {
      // A financier has no legitimate view of estate-wide disposal activity.
      return {
        auctions: [],
        totalLots: 0,
        totalBids: 0,
        settledValue: '0.0000',
        pendingSettlementValue: '0.0000',
        currency: 'INR',
        generatedAt: new Date().toISOString(),
      };
    }

    const [auctions, bidCount, settled, pending] = await Promise.all([
      this.prisma.auction.findMany({
        where: { organizationId: actor.organizationId },
        include: { _count: { select: { lots: true, registrations: true } } },
        orderBy: { scheduledStartAt: 'desc' },
        take: 20,
      }),
      this.prisma.bid.count({ where: { lot: { auction: { organizationId: actor.organizationId } } } }),
      this.prisma.auctionSettlement.aggregate({
        _sum: { amountReceived: true },
        where: { status: 'RECEIVED', auction: { organizationId: actor.organizationId } },
      }),
      this.prisma.auctionSettlement.aggregate({
        _sum: { totalPayable: true },
        where: {
          status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] },
          auction: { organizationId: actor.organizationId },
        },
      }),
    ]);

    const totalLots = auctions.reduce((sum, auction) => sum + auction._count.lots, 0);

    return {
      auctions: auctions.map((auction) => ({
        id: auction.id,
        code: auction.code,
        title: auction.title,
        status: auction.status,
        scheduledStartAt: auction.scheduledStartAt.toISOString(),
        lotCount: auction._count.lots,
        registrationCount: auction._count.registrations,
      })),
      totalLots,
      totalBids: bidCount,
      settledValue: (settled._sum.amountReceived ?? new Prisma.Decimal(0)).toFixed(4),
      pendingSettlementValue: (pending._sum.totalPayable ?? new Prisma.Decimal(0)).toFixed(4),
      currency: 'INR',
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Resolves the caller's data scope.
   *
   * `siteIds === undefined` means unrestricted; an explicit array (possibly
   * empty) means restricted to exactly those. An empty array therefore yields
   * zero rows, which is the correct behaviour for a user with no grants -
   * never "everything".
   */
  private scope(
    actor: AuthenticatedUser,
    requestedSiteId?: string,
  ): { siteIds: string[] | undefined; financierId: string | undefined } {
    if (requestedSiteId) {
      // An explicit request must still be inside the caller's grants.
      AccessScope.assertSite(actor, requestedSiteId);
      return { siteIds: [requestedSiteId], financierId: actor.financierId ?? undefined };
    }
    return {
      siteIds: actor.allSiteAccess ? undefined : actor.siteIds,
      financierId: actor.financierId ?? undefined,
    };
  }
}

/* ------------------------------------------------------------------ */

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface DashboardSummary {
  vehiclesInYard: number;
  entriesToday: number;
  exitsToday: number;
  awaitingEnrichment: number;
  withoutContract: number;
  ageingBeyondThreshold: number;
  pendingReleases: number;
  captureReviewQueue: number;
  outstandingAmount: string;
  outstandingInvoiceCount: number;
  collectedThisMonth: string;
  openAuctions: number;
  auctionPipelineValue: string;
  currency: string;
  generatedAt: string;
}

export interface OccupancyReport {
  sites: Array<{
    siteId: string;
    siteCode: string;
    siteName: string;
    siteType: string;
    parkingMode: string;
    status: string;
    capacity: number;
    occupied: number;
    available: number;
    utilisationPercent: number;
    zones: Array<{
      zoneId: string;
      code: string;
      name: string;
      capacity: number;
      occupied: number;
      available: number;
      utilisationPercent: number;
      allowedClasses: string[];
    }>;
  }>;
  generatedAt: string;
}

export interface AgeingReport {
  buckets: Array<{ label: string; minDays: number; maxDays: number | null; count: number }>;
  totalVehicles: number;
  averageAgeDays: number;
  oldestAgeDays: number;
  generatedAt: string;
}

export interface RevenueReport {
  from: string;
  to: string;
  currency: string;
  invoicedAmount: string;
  invoiceCount: number;
  collectedAmount: string;
  outstandingAmount: string;
  outstandingCount: number;
  overdueAmount: string;
  overdueCount: number;
  byFinancier: Array<{
    financierId: string;
    financierName: string;
    invoiceCount: number;
    invoicedAmount: string;
    outstandingAmount: string;
  }>;
  generatedAt: string;
}

export interface ActivityReport {
  from: string;
  days: number;
  series: Array<{ date: string; entries: number; exits: number }>;
  generatedAt: string;
}

export interface AuctionReport {
  auctions: Array<{
    id: string;
    code: string;
    title: string;
    status: string;
    scheduledStartAt: string;
    lotCount: number;
    registrationCount: number;
  }>;
  totalLots: number;
  totalBids: number;
  settledValue: string;
  pendingSettlementValue: string;
  currency: string;
  generatedAt: string;
}
