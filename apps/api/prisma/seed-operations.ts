/**
 * Operational demo data: vehicles, stays, charges, invoices, payments and a
 * complete auction.
 *
 * Everything here is produced by the SAME logic the application uses - stays
 * are priced by the real `ChargeEngine` against real rate-plan snapshots, and
 * invoice totals are derived from those calculations. Nothing is a hard-coded
 * number, so the seeded estate is internally consistent and the dashboards it
 * produces are genuine rather than decorative.
 */

import {
  ActorType,
  AdmissionMethod,
  AnprEventStatus,
  AuctionLotStatus,
  AuctionStatus,
  AuctionRegistrationStatus,
  BidChannel,
  BidStatus,
  BidderStatus,
  BillingPartyType,
  ChargeCalculationType,
  FuelType,
  HypothecationStatus,
  InvoiceStatus,
  InvoiceType,
  ParkingMode,
  ParkingSessionStatus,
  ParkingSpaceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SettlementStatus,
  TravelDirection,
  VahanVerificationStatus,
  VehicleClass,
  VehicleStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import { TimelineEventType, normalizeRegistrationNumber } from '@smartpark/contracts';
import { ChargeEngine } from '../src/modules/billing/domain/charge-engine';
import { buildRatePlanSnapshot } from '../src/modules/billing/domain/rate-plan-snapshot';
import type { RatePlanSnapshot } from '../src/modules/billing/domain/rate-plan.types';
import {
  PLACEHOLDER,
  chance,
  daysAgo,
  generatePlate,
  intBetween,
  pick,
  prisma,
} from './seed-support';

export interface SeededSiteRef {
  id: string;
  code: string;
  name: string;
  parkingMode: ParkingMode;
  zoneIds: string[];
  gateIds: { entry: string; exit: string };
  laneIds: { entry: string; exit: string };
  deviceCodes: { entry: string; exit: string };
}

export interface SeededFinancierRef {
  id: string;
  code: string;
  displayName: string;
  legalName: string;
}

export interface SeededUserRefs {
  adminId: string;
  managementId: string;
  yardStaffId: string;
  financeId: string;
  auctionAdminId: string;
}

export interface VehicleSeedResult {
  /** Long-staying vehicles suitable for the demo auction. */
  auctionCandidates: Array<{ vehicleId: string; sessionId: string; registrationNumber: string }>;
  openSessionIds: string[];
  closedSessionIds: string[];
}

const MAKES: Array<{ make: string; model: string; klass: VehicleClass; fuel: FuelType }> = [
  { make: 'Maruti Suzuki', model: 'Swift', klass: VehicleClass.CAR, fuel: FuelType.PETROL },
  { make: 'Hyundai', model: 'i20', klass: VehicleClass.CAR, fuel: FuelType.PETROL },
  { make: 'Tata', model: 'Tiago', klass: VehicleClass.CAR, fuel: FuelType.PETROL },
  { make: 'Honda', model: 'City', klass: VehicleClass.CAR, fuel: FuelType.PETROL },
  { make: 'Mahindra', model: 'Scorpio', klass: VehicleClass.SUV, fuel: FuelType.DIESEL },
  { make: 'Tata', model: 'Nexon', klass: VehicleClass.SUV, fuel: FuelType.DIESEL },
  { make: 'Hyundai', model: 'Creta', klass: VehicleClass.SUV, fuel: FuelType.DIESEL },
  { make: 'Hero', model: 'Splendor Plus', klass: VehicleClass.TWO_WHEELER, fuel: FuelType.PETROL },
  { make: 'Honda', model: 'Activa', klass: VehicleClass.TWO_WHEELER, fuel: FuelType.PETROL },
  { make: 'Bajaj', model: 'Pulsar 150', klass: VehicleClass.TWO_WHEELER, fuel: FuelType.PETROL },
  { make: 'Bajaj', model: 'RE Compact', klass: VehicleClass.THREE_WHEELER, fuel: FuelType.CNG },
  { make: 'Tata', model: 'Ace Gold', klass: VehicleClass.LCV, fuel: FuelType.DIESEL },
  { make: 'Ashok Leyland', model: 'Ecomet 1215', klass: VehicleClass.HCV, fuel: FuelType.DIESEL },
];

const GIVEN_NAMES = ['Arun', 'Bhavna', 'Chetan', 'Divya', 'Farid', 'Gita', 'Harish', 'Ishita', 'Jaya', 'Kiran', 'Lalitha', 'Manoj'];
const FAMILY_NAMES = ['Ramanathan', 'Deshpande', 'Iyer', 'Sharma', 'Fernandes', 'Reddy', 'Chatterjee', 'Nair', 'Patel'];
const CITIES = ['Chennai', 'Coimbatore', 'Madurai', 'Salem', 'Tiruchirappalli'];

/* ------------------------------------------------------------------ */
/* Vehicles and stays                                                  */
/* ------------------------------------------------------------------ */

export async function seedVehiclesAndSessions(
  organizationId: string,
  sites: SeededSiteRef[],
  financiers: SeededFinancierRef[],
  vehicleCount: number,
  users: SeededUserRefs,
): Promise<VehicleSeedResult> {
  const yardSites = sites.filter((s) => s.parkingMode === ParkingMode.REPOSSESSION_YARD);
  if (yardSites.length === 0) throw new Error('The seed needs at least one repossession yard.');

  // Rate plans are loaded once and snapshotted per stay, exactly as the gate
  // does at admission.
  const ratePlans = await prisma.ratePlan.findMany({
    where: { organizationId, status: 'ACTIVE', scope: 'CONTRACT' },
    include: {
      slabs: true,
      contractVersion: {
        include: {
          contract: { select: { financierId: true } },
          taxProfile: { include: { components: true } },
        },
      },
    },
  });

  const plansByFinancier = new Map<string, typeof ratePlans>();
  for (const plan of ratePlans) {
    const financierId = plan.contractVersion?.contract.financierId;
    if (!financierId) continue;
    const list = plansByFinancier.get(financierId) ?? [];
    list.push(plan);
    plansByFinancier.set(financierId, list);
  }

  const auctionCandidates: VehicleSeedResult['auctionCandidates'] = [];
  const openSessionIds: string[] = [];
  const closedSessionIds: string[] = [];

  for (let index = 0; index < vehicleCount; index++) {
    const plate = generatePlate(index);
    const normalized = normalizeRegistrationNumber(plate);
    const spec = MAKES[index % MAKES.length]!;
    const financier = financiers[index % financiers.length]!;
    const site = yardSites[index % yardSites.length]!;

    // A deliberate slice of vehicles has no matched financier, so the "unrated
    // stay" work queue and the fallback billing rule are both visible.
    const unmatched = index % 11 === 0;

    // Distribution across the lifecycle, so every dashboard has real content:
    //   ~55% still in the yard, ~30% released, ~15% long-stay auction fodder.
    const roll = index % 20;
    const outcome = roll < 11 ? 'OPEN' : roll < 17 ? 'CLOSED' : 'AUCTION_CANDIDATE';

    const stayDays =
      outcome === 'AUCTION_CANDIDATE' ? intBetween(200, 420)
      : outcome === 'OPEN' ? intBetween(1, 150)
      : intBetween(5, 90);

    const entryAt = daysAgo(stayDays, 12);

    const vehicle = await prisma.vehicle.create({
      data: {
        organizationId,
        registrationNumber: plate,
        normalizedRegistrationNumber: normalized,
        registrationFormat: 'STATE',
        vehicleClass: spec.klass,
        vehicleType: spec.klass === VehicleClass.TWO_WHEELER ? 'Motorcycle' : 'Passenger vehicle',
        make: spec.make,
        model: spec.model,
        variant: pick(['LXI', 'VXI', 'ZXI', 'Base', 'Sportz']),
        color: pick(['White', 'Silver', 'Grey', 'Blue', 'Red', 'Black']),
        fuelType: spec.fuel,
        manufacturingYear: intBetween(2015, 2023),
        chassisNumberLast4: String(intBetween(1000, 9999)),
        engineNumberLast4: String(intBetween(1000, 9999)),
        registeredOwnerName: `${pick(GIVEN_NAMES)} ${pick(FAMILY_NAMES)}`,
        registeredOwnerAddress: `${intBetween(1, 180)}, ${pick(['MG Road', 'Anna Salai', 'Nehru Street'])}, ${pick(CITIES)}, Tamil Nadu`,
        hypothecationStatus: unmatched
          ? HypothecationStatus.UNKNOWN
          : HypothecationStatus.HYPOTHECATED,
        // The seed uses the simulator, which is not authoritative, so the
        // verification status must never claim VERIFIED.
        vahanVerificationStatus: unmatched
          ? VahanVerificationStatus.UNAVAILABLE
          : VahanVerificationStatus.UNAVAILABLE,
        vahanVerifiedAt: daysAgo(stayDays),
        currentFinancierId: unmatched ? null : financier.id,
        financierMatchMethod: unmatched ? 'UNMATCHED' : 'VAHAN_ALIAS',
        financierMatchConfidence: unmatched ? null : new Prisma.Decimal('1.0000'),
        status: VehicleStatus.CAPTURED,
        firstSeenAt: entryAt,
        lastSeenAt: entryAt,
        totalVisits: 1,
      },
    });

    // Ownership snapshot, clearly attributed to the simulator.
    await prisma.vehicleOwnershipRecord.create({
      data: {
        vehicleId: vehicle.id,
        provider: 'mock',
        source: 'MOCK',
        registeredOwnerName: vehicle.registeredOwnerName,
        registeredOwnerAddress: vehicle.registeredOwnerAddress,
        financierNameRaw: unmatched ? null : financier.legalName,
        matchedFinancierId: unmatched ? null : financier.id,
        hypothecationStatus: vehicle.hypothecationStatus,
        vehicleClass: spec.klass,
        make: spec.make,
        model: spec.model,
        fuelType: spec.fuel,
        manufacturingYear: vehicle.manufacturingYear,
        retrievedAt: entryAt,
        isCurrent: true,
        rawResponse: {
          simulator: true,
          notice: 'Seeded by the development simulator. NOT authoritative registry data.',
        },
      },
    });

    if (!unmatched) {
      await prisma.vehicleFinancierHistory.create({
        data: {
          vehicleId: vehicle.id,
          financierId: financier.id,
          financierNameRaw: financier.legalName,
          matchMethod: 'VAHAN_ALIAS',
          confidence: new Prisma.Decimal('1.0000'),
          effectiveFrom: entryAt,
          reason: 'Exact alias match during seeding.',
        },
      });
    }

    /* --- The entry capture ---------------------------------------- */
    const entryEvent = await prisma.anprEvent.create({
      data: {
        organizationId,
        deviceId: (await deviceId(site.deviceCodes.entry))!,
        siteId: site.id,
        gateId: site.gateIds.entry,
        laneId: site.laneIds.entry,
        providerEventId: `seed-in-${index}-${randomUUID().slice(0, 8)}`,
        capturedAt: entryAt,
        receivedAt: entryAt,
        plateNumberRaw: plate,
        normalizedPlate: normalized,
        confidence: new Prisma.Decimal((0.9 + Math.random() * 0.09).toFixed(4)),
        direction: TravelDirection.ENTRY,
        vehicleClassHint: spec.klass,
        status: AnprEventStatus.PROCESSED,
        dedupeKey: createHash('sha256').update(`seed-in-${index}`).digest('hex').slice(0, 64),
        vehicleId: vehicle.id,
        processedAt: entryAt,
        correlationId: `seed-${index}`,
        rawPayload: { simulator: true },
      },
    });

    /* --- Rate snapshot --------------------------------------------- */
    const candidatePlans = unmatched ? [] : (plansByFinancier.get(financier.id) ?? []);
    const plan =
      candidatePlans.find((p) => p.siteId === site.id) ??
      candidatePlans.find((p) => p.siteId === null) ??
      null;

    const snapshot: RatePlanSnapshot | null = plan
      ? buildRatePlanSnapshot(plan, plan.contractVersion?.taxProfile ?? null)
      : null;

    const zoneId = site.zoneIds[index % site.zoneIds.length]!;
    const space = await prisma.parkingSpace.findFirst({
      where: { zoneId, status: ParkingSpaceStatus.AVAILABLE },
      orderBy: { code: 'asc' },
    });

    const closes = outcome === 'CLOSED';
    const exitAt = closes ? new Date(entryAt.getTime() + stayDays * 86_400_000) : null;

    const session = await prisma.parkingSession.create({
      data: {
        organizationId,
        siteId: site.id,
        vehicleId: vehicle.id,
        sessionNumber: `SES-SEED-${String(index + 1).padStart(5, '0')}`,
        parkingMode: ParkingMode.REPOSSESSION_YARD,
        status: closes ? ParkingSessionStatus.CLOSED : ParkingSessionStatus.OPEN,
        entryAt,
        exitAt,
        entryGateId: site.gateIds.entry,
        entryLaneId: site.laneIds.entry,
        entryAnprEventId: entryEvent.id,
        financierId: unmatched ? null : financier.id,
        contractVersionId: plan?.contractVersionId ?? null,
        ratePlanId: plan?.id ?? null,
        ratePlanSnapshot: (snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
        rateUnresolved: snapshot === null,
        zoneId,
        spaceId: closes ? null : (space?.id ?? null),
        admissionMethod: AdmissionMethod.ANPR_AUTO,
        admittedById: users.yardStaffId,
        closedById: closes ? users.yardStaffId : null,
        closureReason: closes ? 'Released to the financier after settlement.' : null,
        correlationId: `seed-${index}`,
      },
    });

    if (!closes && space) {
      await prisma.parkingSpace.update({
        where: { id: space.id },
        data: { status: ParkingSpaceStatus.OCCUPIED },
      });
      await prisma.parkingAllocation.create({
        data: {
          sessionId: session.id,
          zoneId,
          spaceId: space.id,
          allocatedAt: entryAt,
          allocatedById: users.yardStaffId,
          reason: 'Automatic allocation at admission.',
        },
      });
    }

    await prisma.anprEvent.update({
      where: { id: entryEvent.id },
      data: { parkingSessionId: session.id },
    });

    /* --- Charge calculation, by the real engine --------------------- */
    if (snapshot) {
      const asOf = exitAt ?? new Date();
      const breakdown = ChargeEngine.calculate({
        entryAt,
        asOf,
        timezone: 'Asia/Kolkata',
        ratePlan: snapshot,
      });

      await prisma.chargeCalculation.create({
        data: {
          organizationId,
          sessionId: session.id,
          type: closes ? ChargeCalculationType.FINAL : ChargeCalculationType.ACCRUAL,
          asOf,
          engineVersion: breakdown.engineVersion,
          ratePlanId: plan?.id ?? null,
          ratePlanSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          timezone: breakdown.timezone,
          billingUnit: snapshot.billingUnit,
          roundingMode: snapshot.roundingMode,
          freeUnitPolicy: snapshot.freeUnitPolicy,
          rawDurationMinutes: breakdown.rawDurationMinutes,
          graceMinutes: breakdown.graceMinutes,
          totalUnits: new Prisma.Decimal(breakdown.totalUnits),
          freeUnits: new Prisma.Decimal(breakdown.freeUnits),
          chargeableUnits: new Prisma.Decimal(breakdown.chargeableUnits),
          subtotal: new Prisma.Decimal(breakdown.subtotal),
          taxTotal: new Prisma.Decimal(breakdown.taxTotal),
          total: new Prisma.Decimal(breakdown.total),
          currency: breakdown.currency,
          inputsHash: breakdown.inputsHash,
          explanation: breakdown.explanation as unknown as Prisma.InputJsonValue,
          isCurrent: true,
          lines: {
            create: [...breakdown.lines, ...breakdown.taxLines].map((line) => ({
              lineNo: line.lineNo,
              kind: line.kind as Prisma.ChargeLineCreateWithoutCalculationInput['kind'],
              description: line.description,
              fromUnit: line.fromUnit === null ? null : new Prisma.Decimal(line.fromUnit),
              toUnit: line.toUnit === null ? null : new Prisma.Decimal(line.toUnit),
              units: new Prisma.Decimal(line.units),
              unitAmount: new Prisma.Decimal(line.unitAmount),
              amount: new Prisma.Decimal(line.amount),
            })),
          },
        },
      });
    }

    /* --- Vehicle status and timeline -------------------------------- */
    const finalStatus = closes ? VehicleStatus.EXITED : VehicleStatus.PARKED;

    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        status: finalStatus,
        currentSiteId: closes ? null : site.id,
        currentSessionId: closes ? null : session.id,
        lastSeenAt: exitAt ?? entryAt,
      },
    });

    await prisma.vehicleTimelineEvent.createMany({
      data: [
        {
          organizationId,
          vehicleId: vehicle.id,
          sessionId: session.id,
          siteId: site.id,
          type: TimelineEventType.VEHICLE_CREATED,
          occurredAt: entryAt,
          actorType: ActorType.SYSTEM,
          title: 'Vehicle first seen',
          correlationId: `seed-${index}`,
        },
        {
          organizationId,
          vehicleId: vehicle.id,
          sessionId: session.id,
          siteId: site.id,
          type: TimelineEventType.SESSION_OPENED,
          occurredAt: entryAt,
          actorId: users.yardStaffId,
          actorType: ActorType.USER,
          title: `Entered ${site.name}`,
          description: `Stay ${session.sessionNumber} opened.`,
          correlationId: `seed-${index}`,
        },
        ...(closes && exitAt
          ? [
              {
                organizationId,
                vehicleId: vehicle.id,
                sessionId: session.id,
                siteId: site.id,
                type: TimelineEventType.SESSION_CLOSED,
                occurredAt: exitAt,
                actorId: users.yardStaffId,
                actorType: ActorType.USER,
                title: `Released from ${site.name}`,
                correlationId: `seed-${index}`,
              },
            ]
          : []),
      ],
    });

    if (closes) closedSessionIds.push(session.id);
    else openSessionIds.push(session.id);

    if (outcome === 'AUCTION_CANDIDATE' && !unmatched) {
      auctionCandidates.push({
        vehicleId: vehicle.id,
        sessionId: session.id,
        registrationNumber: normalized,
      });
    }
  }

  // A handful of low-confidence captures with no stay, so the gate review queue
  // is populated on first login.
  await seedReviewQueue(organizationId, yardSites[0]!);

  return { auctionCandidates, openSessionIds, closedSessionIds };
}

async function seedReviewQueue(organizationId: string, site: SeededSiteRef): Promise<void> {
  const deviceIdValue = await deviceId(site.deviceCodes.entry);
  if (!deviceIdValue) return;

  for (let index = 0; index < 4; index++) {
    const capturedAt = new Date(Date.now() - intBetween(5, 240) * 60_000);
    await prisma.anprEvent.create({
      data: {
        organizationId,
        deviceId: deviceIdValue,
        siteId: site.id,
        gateId: site.gateIds.entry,
        laneId: site.laneIds.entry,
        providerEventId: `seed-review-${index}-${randomUUID().slice(0, 8)}`,
        capturedAt,
        plateNumberRaw: pick(['TN 09 B? 41##', 'KA-05-M?-8?21', 'TN22 A 9O31', 'AP31 BQ 1I05']),
        normalizedPlate: `TN${intBetween(10, 99)}XX${intBetween(1000, 9999)}`,
        confidence: new Prisma.Decimal((0.4 + Math.random() * 0.35).toFixed(4)),
        direction: TravelDirection.ENTRY,
        status: AnprEventStatus.PENDING_REVIEW,
        dedupeKey: createHash('sha256').update(`seed-review-${index}`).digest('hex').slice(0, 64),
        correlationId: `seed-review-${index}`,
        rawPayload: { simulator: true, note: 'Low-confidence capture for the review queue.' },
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Invoices and payments                                               */
/* ------------------------------------------------------------------ */

/**
 * Raises an invoice for every closed stay that has a FINAL charge, then settles
 * a realistic proportion of them: some paid in full, some part-paid, some
 * outstanding and a few overdue - so the receivables and ageing reports have
 * something true to show.
 */
export async function seedInvoicesAndPayments(
  organizationId: string,
  sites: SeededSiteRef[],
  users: SeededUserRefs,
): Promise<void> {
  void sites;

  const series = await prisma.invoiceSeries.findFirstOrThrow({
    where: { organizationId, code: 'PARKING' },
  });
  const rule = await prisma.billingRule.findFirst({
    where: { organizationId, code: 'BR-YARD-FINANCIER' },
  });

  const calculations = await prisma.chargeCalculation.findMany({
    where: { organizationId, type: ChargeCalculationType.FINAL },
    include: {
      session: {
        include: {
          vehicle: { select: { id: true, registrationNumber: true, make: true, model: true } },
          financier: true,
          site: { select: { id: true } },
        },
      },
      lines: { orderBy: { lineNo: 'asc' } },
    },
  });

  let sequence = series.nextSequence;

  for (const calculation of calculations) {
    const session = calculation.session;
    const financier = session.financier;
    if (!financier) continue;
    if (calculation.total.lessThanOrEqualTo(0)) continue;

    const invoiceNumber = `${series.prefix}${String(sequence).padStart(series.padding, '0')}`;
    sequence++;

    const issueDate = session.exitAt ?? new Date();
    const dueDate = new Date(issueDate.getTime() + financier.paymentTermsDays * 86_400_000);

    // Roughly: 55% paid, 20% part-paid, 25% outstanding.
    const settlement = chance(0.55) ? 'PAID' : chance(0.45) ? 'PARTIAL' : 'OUTSTANDING';
    const amountPaid =
      settlement === 'PAID'
        ? calculation.total
        : settlement === 'PARTIAL'
          ? calculation.total.mul(new Prisma.Decimal('0.4')).toDecimalPlaces(4)
          : new Prisma.Decimal(0);

    const status =
      settlement === 'PAID'
        ? InvoiceStatus.PAID
        : settlement === 'PARTIAL'
          ? InvoiceStatus.PARTIALLY_PAID
          : InvoiceStatus.SENT;

    const invoice = await prisma.invoice.create({
      data: {
        organizationId,
        siteId: session.siteId,
        seriesId: series.id,
        type: InvoiceType.PARKING,
        status,
        invoiceNumber,
        issueDate,
        dueDate,
        billingPartyType: BillingPartyType.FINANCIER,
        financierId: financier.id,
        billingPartyName: financier.legalName,
        billingPartyAddress: [financier.addressLine1, financier.city, financier.state]
          .filter(Boolean)
          .join(', ') || null,
        billingPartyEmail: financier.billingEmail,
        billingPartyPhone: financier.billingPhone,
        billingRuleId: rule?.id ?? null,
        sessionId: session.id,
        vehicleId: session.vehicleId,
        chargeCalculationId: calculation.id,
        currency: calculation.currency,
        subtotal: calculation.subtotal,
        taxTotal: calculation.taxTotal,
        total: calculation.total,
        amountPaid,
        balance: calculation.total.sub(amountPaid),
        notes: `Parking charges for stay ${session.sessionNumber}.`,
        idempotencyKey: `seed-invoice-${session.id}`,
        issuedById: users.financeId,
        issuedAt: issueDate,
        sentAt: issueDate,
        lines: {
          create: calculation.lines
            .filter((line) => line.kind !== 'TAX')
            .map((line, index) => ({
              lineNo: index + 1,
              description: line.description,
              quantity: line.units,
              unitAmount: line.unitAmount,
              amount: line.amount,
            })),
        },
        taxLines: {
          create: calculation.lines
            .filter((line) => line.kind === 'TAX')
            .map((line, index) => ({
              sequence: index + 1,
              code: `TAX${index + 1}`,
              name: line.description,
              kind: 'PERCENTAGE',
              rate: line.unitAmount,
              taxableAmount: calculation.subtotal,
              amount: line.amount,
            })),
        },
      },
    });

    if (amountPaid.greaterThan(0)) {
      await prisma.payment.create({
        data: {
          organizationId,
          invoiceId: invoice.id,
          amount: amountPaid,
          currency: calculation.currency,
          method: pick([PaymentMethod.BANK_TRANSFER, PaymentMethod.UPI, PaymentMethod.CHEQUE]),
          provider: 'manual',
          status: PaymentStatus.SUCCESS,
          initiatedAt: new Date(issueDate.getTime() + intBetween(1, 20) * 86_400_000),
          completedAt: new Date(issueDate.getTime() + intBetween(1, 20) * 86_400_000),
          reference: `UTR${intBetween(100000000, 999999999)}`,
          receivedById: users.financeId,
          idempotencyKey: `seed-payment-${invoice.id}`,
        },
      });
    }

    await prisma.vehicleTimelineEvent.create({
      data: {
        organizationId,
        vehicleId: session.vehicleId,
        sessionId: session.id,
        siteId: session.siteId,
        type: TimelineEventType.INVOICE_ISSUED,
        occurredAt: issueDate,
        actorId: users.financeId,
        actorType: ActorType.USER,
        title: `Invoice ${invoiceNumber} issued`,
        description: `${calculation.currency} ${calculation.total.toFixed(2)} to ${financier.displayName}.`,
        correlationId: `seed-invoice-${session.id}`,
      },
    });
  }

  await prisma.invoiceSeries.update({
    where: { id: series.id },
    data: { nextSequence: sequence },
  });
}

/* ------------------------------------------------------------------ */
/* Auction                                                             */
/* ------------------------------------------------------------------ */

/**
 * A complete auction: registered bidders, a competitive bid ladder on each lot,
 * a selected winner and a settlement.
 *
 * The bid ladder is built so the audit trail is meaningful - earlier bids are
 * OUTBID rather than deleted, which is the behaviour the immutability trigger
 * enforces in production.
 */
export async function seedAuction(
  organizationId: string,
  sites: SeededSiteRef[],
  users: SeededUserRefs,
  candidates: Array<{ vehicleId: string; sessionId: string; registrationNumber: string }>,
): Promise<void> {
  if (candidates.length === 0) {
    console.log('  (no long-stay vehicles available, so no auction was seeded)');
    return;
  }

  const yardSite = sites.find((s) => s.parkingMode === ParkingMode.REPOSSESSION_YARD)!;
  const lots = candidates.slice(0, Math.min(6, candidates.length));

  /* --- Bidders ---------------------------------------------------- */
  const bidderDefinitions = [
    { code: 'BDR-001', name: 'Velmurugan Auto Traders', contact: 'R. Velmurugan' },
    { code: 'BDR-002', name: 'Southern Fleet Buyers LLP', contact: 'K. Anitha' },
    { code: 'BDR-003', name: 'Coastline Motors', contact: 'S. Prakash' },
    { code: 'BDR-004', name: 'Greenfield Vehicle Exchange', contact: 'M. Fathima' },
  ];

  const bidders = [];
  for (const definition of bidderDefinitions) {
    bidders.push(
      await prisma.bidder.create({
        data: {
          organizationId,
          code: definition.code,
          legalName: `${definition.name} Private Limited`,
          displayName: definition.name,
          contactName: definition.contact,
          phone: `+9198${intBetween(10000000, 99999999)}`,
          email: `${definition.code.toLowerCase()}@bidders.example`,
          city: pick(CITIES),
          state: 'Tamil Nadu',
          status: BidderStatus.APPROVED,
          kycVerifiedAt: daysAgo(60),
          kycVerifiedById: users.auctionAdminId,
          approvedById: users.auctionAdminId,
          approvedAt: daysAgo(60),
          notes: 'Fictional bidder created by the development seed.',
        },
      }),
    );
  }

  /* --- The auction ------------------------------------------------ */
  const scheduledStartAt = daysAgo(10);
  const scheduledEndAt = daysAgo(9);

  const auction = await prisma.auction.create({
    data: {
      organizationId,
      siteId: yardSite.id,
      code: 'AUC-2025-0001',
      title: 'Repossessed vehicle auction - September',
      description:
        'Long-stay repossessed vehicles offered for disposal. Terms are placeholders ' +
        'pending confirmation of the auction rules (OI-04).',
      status: AuctionStatus.SETTLED,
      scheduledStartAt,
      scheduledEndAt,
      actualStartAt: scheduledStartAt,
      actualEndAt: scheduledEndAt,
      defaultMinIncrement: new Prisma.Decimal('2500.0000'),
      registrationDeposit: new Prisma.Decimal('25000.0000'),
      currency: 'INR',
      termsAndConditions: `${PLACEHOLDER} Auction terms to be supplied by Sri JP.`,
      publishedById: users.auctionAdminId,
      publishedAt: daysAgo(20),
      closedById: users.auctionAdminId,
      closedAt: scheduledEndAt,
      createdById: users.auctionAdminId,
    },
  });

  for (const bidder of bidders) {
    await prisma.auctionRegistration.create({
      data: {
        auctionId: auction.id,
        bidderId: bidder.id,
        status: AuctionRegistrationStatus.APPROVED,
        depositPaid: new Prisma.Decimal('25000.0000'),
        depositReference: `DEP${intBetween(100000, 999999)}`,
        registeredAt: daysAgo(18),
        approvedById: users.auctionAdminId,
        approvedAt: daysAgo(17),
      },
    });
  }

  /* --- Lots and bids ---------------------------------------------- */
  for (const [index, candidate] of lots.entries()) {
    const reservePrice = new Prisma.Decimal(intBetween(40, 260) * 1000);
    const minIncrement = new Prisma.Decimal('2500.0000');

    const lot = await prisma.auctionLot.create({
      data: {
        auctionId: auction.id,
        lotNumber: index + 1,
        vehicleId: candidate.vehicleId,
        sessionId: candidate.sessionId,
        status: AuctionLotStatus.BIDDING_CLOSED,
        reservePrice,
        startingPrice: reservePrice,
        minIncrement,
        currency: 'INR',
        description: `Lot ${index + 1}: ${candidate.registrationNumber}`,
        conditionNotes: 'Sold as seen. Condition report available on request.',
      },
    });

    // A competitive ladder: each bid clears the previous by at least the
    // increment, and the bidders alternate.
    const bidCount = intBetween(3, 6);
    let currentAmount = reservePrice;
    let sequenceNo = 0;
    const placedBids: Array<{ id: string; amount: Prisma.Decimal; bidderId: string }> = [];

    for (let bidIndex = 0; bidIndex < bidCount; bidIndex++) {
      sequenceNo++;
      currentAmount = currentAmount.add(minIncrement.mul(intBetween(1, 4)));
      const bidder = bidders[bidIndex % bidders.length]!;
      const placedAt = new Date(scheduledStartAt.getTime() + bidIndex * 7 * 60_000);

      const bid = await prisma.bid.create({
        data: {
          lotId: lot.id,
          bidderId: bidder.id,
          amount: currentAmount,
          currency: 'INR',
          sequenceNo,
          placedAt,
          status: BidStatus.ACCEPTED,
          channel: pick([BidChannel.PORTAL, BidChannel.HALL]),
          idempotencyKey: `seed-bid-${lot.id}-${sequenceNo}`,
          correlationId: `seed-auction-${index}`,
        },
      });
      placedBids.push({ id: bid.id, amount: currentAmount, bidderId: bidder.id });

      await prisma.bidEvent.create({
        data: {
          bidId: bid.id,
          toStatus: BidStatus.ACCEPTED,
          reason: 'Bid accepted.',
          actorType: ActorType.SYSTEM,
          occurredAt: placedAt,
        },
      });
    }

    // Earlier bids are marked OUTBID, never removed. The bid rows themselves
    // are immutable apart from this status field.
    const winningBid = placedBids[placedBids.length - 1]!;
    for (const bid of placedBids.slice(0, -1)) {
      await prisma.bid.update({ where: { id: bid.id }, data: { status: BidStatus.LOST } });
      await prisma.bidEvent.create({
        data: {
          bidId: bid.id,
          fromStatus: BidStatus.ACCEPTED,
          toStatus: BidStatus.LOST,
          reason: 'Outbid.',
          actorType: ActorType.SYSTEM,
        },
      });
    }
    await prisma.bid.update({ where: { id: winningBid.id }, data: { status: BidStatus.WON } });
    await prisma.bidEvent.create({
      data: {
        bidId: winningBid.id,
        fromStatus: BidStatus.ACCEPTED,
        toStatus: BidStatus.WON,
        reason: 'Highest eligible bid at close.',
        actorId: users.auctionAdminId,
        actorType: ActorType.USER,
      },
    });

    await prisma.auctionLot.update({
      where: { id: lot.id },
      data: {
        status: AuctionLotStatus.SETTLED,
        bidCount: placedBids.length,
        highestBidAmount: winningBid.amount,
        winningBidId: winningBid.id,
        winnerBidderId: winningBid.bidderId,
        winnerSelectedById: users.auctionAdminId,
        winnerSelectedAt: scheduledEndAt,
      },
    });

    // Settlement. Fees and tax are placeholders.
    const feesAmount = winningBid.amount.mul(new Prisma.Decimal('0.02')).toDecimalPlaces(4);
    const taxAmount = new Prisma.Decimal(0);
    const totalPayable = winningBid.amount.add(feesAmount).add(taxAmount);

    await prisma.auctionSettlement.create({
      data: {
        auctionId: auction.id,
        lotId: lot.id,
        bidderId: winningBid.bidderId,
        winningBidId: winningBid.id,
        saleAmount: winningBid.amount,
        feesAmount,
        taxAmount,
        totalPayable,
        amountReceived: totalPayable,
        currency: 'INR',
        status: SettlementStatus.RECEIVED,
        dueDate: new Date(scheduledEndAt.getTime() + 7 * 86_400_000),
        settledAt: new Date(scheduledEndAt.getTime() + intBetween(1, 6) * 86_400_000),
        settledById: users.auctionAdminId,
        notes: `${PLACEHOLDER} Buyer's premium taken as 2% for demonstration.`,
        createdById: users.auctionAdminId,
      },
    });

    await prisma.vehicle.update({
      where: { id: candidate.vehicleId },
      data: { status: VehicleStatus.SOLD },
    });

    await prisma.vehicleTimelineEvent.createMany({
      data: [
        {
          organizationId,
          vehicleId: candidate.vehicleId,
          sessionId: candidate.sessionId,
          siteId: yardSite.id,
          type: TimelineEventType.AUCTION_LISTED,
          occurredAt: daysAgo(20),
          actorId: users.auctionAdminId,
          actorType: ActorType.USER,
          title: `Listed as lot ${index + 1} in ${auction.code}`,
          correlationId: `seed-auction-${index}`,
        },
        {
          organizationId,
          vehicleId: candidate.vehicleId,
          sessionId: candidate.sessionId,
          siteId: yardSite.id,
          type: TimelineEventType.AUCTION_WINNER_SELECTED,
          occurredAt: scheduledEndAt,
          actorId: users.auctionAdminId,
          actorType: ActorType.USER,
          title: `Winning bid INR ${winningBid.amount.toFixed(2)}`,
          correlationId: `seed-auction-${index}`,
        },
      ],
    });
  }

  await prisma.auction.update({
    where: { id: auction.id },
    data: { status: AuctionStatus.COMPLETED },
  });
}

/* ------------------------------------------------------------------ */

const deviceCache = new Map<string, string>();

async function deviceId(code: string): Promise<string | null> {
  const cached = deviceCache.get(code);
  if (cached) return cached;
  const device = await prisma.anprDevice.findFirst({ where: { code }, select: { id: true } });
  if (device) deviceCache.set(code, device.id);
  return device?.id ?? null;
}
