/**
 * Development and demonstration seed.
 *
 * Creates a realistic but entirely FICTIONAL Sri JP Smartpark estate: two
 * repossession yards, three Phase 2 public parking sites, six financiers with
 * negotiated contracts, users across every role, and a population of vehicles
 * spread across the lifecycle.
 *
 * RULES OBSERVED HERE
 *
 *   - No real people. Owner names, addresses and contacts are invented.
 *   - No real financial institutions. The six lenders are invented names, so
 *     nothing implies a commercial relationship Sri JP does not have.
 *   - No invented Sri JP commercial terms. Every rate, free-day allowance, fee
 *     and tax rate carries an explicit PLACEHOLDER note in its own description,
 *     because the real terms are unresolved (docs/open-items.md OI-04..OI-06).
 *     They exist so the engine can be exercised, not because anyone agreed them.
 *   - Refuses to run against production.
 *
 * Usage:  npm run db:seed
 */

import {
  BillingPartyType,
  BillingRuleScope,
  ContractStatus,
  ContractVersionStatus,
  DeviceStatus,
  InvoiceType,
  ParkingMode,
  ParkingSpaceStatus,
  Prisma,
  RatePlanScope,
  RatePlanStatus,
  RateSlabKind,
  SiteStatus,
  SiteType,
  TravelDirection,
  UserStatus,
  VehicleClass,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, RoleCode } from '@smartpark/contracts';
import {
  PLACEHOLDER,
  daysAgo,
  describePermission,
  describeRole,
  hashPassword,
  humaniseRole,
  intBetween,
  normalizeCompanyName,
  pick,
  prisma,
} from './seed-support';
import {
  SeededFinancierRef,
  SeededSiteRef,
  SeededUserRefs,
  seedAuction,
  seedInvoicesAndPayments,
  seedVehiclesAndSessions,
} from './seed-operations';

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('The seed refuses to run with NODE_ENV=production.');
  }

  const adminEmail = process.env['SEED_ADMIN_EMAIL'] || 'admin@srijpsmartpark.example';
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'] || 'ChangeMe!Admin2025';
  const demoPassword = process.env['SEED_DEFAULT_PASSWORD'] || 'ChangeMe!Demo2025';
  const vehicleCount = Number(process.env['SEED_VEHICLE_COUNT'] ?? 60);

  const started = Date.now();

  console.log('Clearing existing data...');
  await truncateAll();

  console.log('Seeding organisation, permissions and roles...');
  const org = await seedOrganization();
  const permissionIds = await seedPermissions();
  const roles = await seedRoles(org.id, permissionIds);

  console.log('Seeding tax profile...');
  const taxProfile = await seedTaxProfile(org.id);

  console.log('Seeding sites, gates, zones, bays and cameras...');
  const sites = await seedSites(org.id, taxProfile.id);

  console.log('Seeding financiers and aliases...');
  const financiers = await seedFinanciers(org.id);

  console.log('Seeding contracts and rate plans...');
  await seedContracts(org.id, financiers, sites, taxProfile.id);

  console.log('Seeding Phase 2 public parking tariffs...');
  await seedSiteTariffs(org.id, sites);

  console.log('Seeding billing rules, invoice series, templates and settings...');
  await seedBillingRules(org.id);
  await seedInvoiceSeries(org.id);
  await seedNotificationTemplates(org.id);
  await seedSystemSettings(org.id);

  console.log('Seeding users...');
  const users = await seedUsers(org.id, roles, sites, financiers, adminEmail, adminPassword, demoPassword);

  console.log(`Seeding ${vehicleCount} vehicles and their stays...`);
  const seeded = await seedVehiclesAndSessions(org.id, sites, financiers, vehicleCount, users);

  console.log('Seeding invoices and payments...');
  await seedInvoicesAndPayments(org.id, sites, users);

  console.log('Seeding auction, bidders, bids and settlement...');
  await seedAuction(org.id, sites, users, seeded.auctionCandidates);

  await printSummary(adminEmail, adminPassword, demoPassword, Date.now() - started);
}

/* ------------------------------------------------------------------ */

/**
 * Resets every business table.
 *
 * TRUNCATE rather than delete: the immutability triggers on audit_logs, bids
 * and the vehicle timeline deliberately reject DELETE, so TRUNCATE is the only
 * way to reset them. That asymmetry is the protection working as intended.
 */
async function truncateAll(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}

async function seedOrganization() {
  return prisma.organization.create({
    data: {
      code: 'SRIJP',
      legalName: 'Sri JP Smartpark India Private Limited',
      displayName: 'Sri JP Smartpark',
      // GSTIN and PAN are deliberately blank: they are real business data Sri
      // JP must supply, and inventing them would be worse than leaving them
      // empty. The invoice layout renders them only when present.
      addressLine1: 'Registered office address to be confirmed',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      defaultCurrency: 'INR',
      contactEmail: 'operations@srijpsmartpark.example',
    },
  });
}

async function seedPermissions(): Promise<Map<string, string>> {
  await prisma.permission.createMany({
    data: ALL_PERMISSIONS.map((code) => ({
      code,
      category: code.split(':')[0] ?? 'general',
      description: describePermission(code),
    })),
  });
  const created = await prisma.permission.findMany({ select: { id: true, code: true } });
  return new Map(created.map((p) => [p.code, p.id]));
}

async function seedRoles(
  organizationId: string,
  permissionIds: Map<string, string>,
): Promise<Map<string, string>> {
  const roles = new Map<string, string>();

  for (const [code, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await prisma.role.create({
      data: {
        organizationId,
        code,
        name: humaniseRole(code),
        description: describeRole(code),
        isSystem: true,
        permissions: {
          create: permissions
            .map((permission) => permissionIds.get(permission))
            .filter((id): id is string => Boolean(id))
            .map((permissionId) => ({ permissionId })),
        },
      },
    });
    roles.set(code, role.id);
  }
  return roles;
}

/**
 * A GST-shaped tax profile with PLACEHOLDER rates.
 *
 * The structure - two components as CGST/SGST would be - is modelled so the
 * engine and invoice layout can be exercised. The rates are NOT a Sri JP tax
 * position: the GST treatment of yard parking and of an auction sale is an
 * unresolved item (OI-06) needing their accountant's answer.
 */
async function seedTaxProfile(organizationId: string) {
  return prisma.taxProfile.create({
    data: {
      organizationId,
      code: 'PLACEHOLDER-GST',
      name: 'Placeholder GST profile',
      description: `${PLACEHOLDER} Confirm applicability, rate and HSN/SAC before go-live.`,
      isDefault: true,
      components: {
        create: [
          {
            sequence: 1,
            code: 'CGST',
            name: 'CGST (placeholder rate)',
            kind: 'PERCENTAGE',
            rate: new Prisma.Decimal('0.090000'),
            base: 'SUBTOTAL',
          },
          {
            sequence: 2,
            code: 'SGST',
            name: 'SGST (placeholder rate)',
            kind: 'PERCENTAGE',
            rate: new Prisma.Decimal('0.090000'),
            base: 'SUBTOTAL',
          },
        ],
      },
    },
  });
}

async function seedSites(organizationId: string, taxProfileId: string): Promise<SeededSiteRef[]> {
  const definitions = [
    {
      code: 'YRD-CHN-01',
      name: 'Chennai Yard - Ambattur',
      siteType: SiteType.REPOSSESSION_YARD,
      parkingMode: ParkingMode.REPOSSESSION_YARD,
      status: SiteStatus.ACTIVE,
      city: 'Chennai',
      capacity: 420,
      zones: [
        { code: 'A', name: 'Zone A - Two wheelers', capacity: 180, classes: [VehicleClass.TWO_WHEELER, VehicleClass.THREE_WHEELER] },
        { code: 'B', name: 'Zone B - Cars and SUVs', capacity: 160, classes: [VehicleClass.CAR, VehicleClass.SUV] },
        { code: 'C', name: 'Zone C - Commercial', capacity: 80, classes: [VehicleClass.LCV, VehicleClass.HCV, VehicleClass.BUS] },
      ],
    },
    {
      code: 'YRD-CBE-01',
      name: 'Coimbatore Yard - Peelamedu',
      siteType: SiteType.REPOSSESSION_YARD,
      parkingMode: ParkingMode.REPOSSESSION_YARD,
      status: SiteStatus.ACTIVE,
      city: 'Coimbatore',
      capacity: 260,
      zones: [
        { code: 'A', name: 'Zone A - Two wheelers', capacity: 140, classes: [VehicleClass.TWO_WHEELER] },
        { code: 'B', name: 'Zone B - Four wheelers', capacity: 120, classes: [VehicleClass.CAR, VehicleClass.SUV, VehicleClass.LCV] },
      ],
    },
    // Phase 2 sites are PLANNED, not ACTIVE. Marking them active would
    // misrepresent the position: the contracts are not signed (OI-07/OI-08).
    {
      code: 'APT-MAA-01',
      name: 'Chennai Airport Car Park (Phase 2)',
      siteType: SiteType.AIRPORT_PARKING,
      parkingMode: ParkingMode.PUBLIC_PARKING,
      status: SiteStatus.PLANNED,
      city: 'Chennai',
      capacity: 900,
      zones: [
        { code: 'P1', name: 'P1 - Short stay', capacity: 400, classes: [] },
        { code: 'P2', name: 'P2 - Long stay', capacity: 500, classes: [] },
      ],
    },
    {
      code: 'MET-MAA-01',
      name: 'Alandur Metro Park & Ride (Phase 2)',
      siteType: SiteType.METRO_PARKING,
      parkingMode: ParkingMode.PUBLIC_PARKING,
      status: SiteStatus.PLANNED,
      city: 'Chennai',
      capacity: 350,
      zones: [{ code: 'M1', name: 'M1 - Commuter parking', capacity: 350, classes: [] }],
    },
    {
      code: 'RLY-CBE-01',
      name: 'Coimbatore Junction Parking (Phase 2)',
      siteType: SiteType.RAILWAY_PARKING,
      parkingMode: ParkingMode.PUBLIC_PARKING,
      status: SiteStatus.PLANNED,
      city: 'Coimbatore',
      capacity: 220,
      zones: [{ code: 'R1', name: 'R1 - Station forecourt', capacity: 220, classes: [] }],
    },
  ];

  const seeded: SeededSiteRef[] = [];

  for (const definition of definitions) {
    const site = await prisma.site.create({
      data: {
        organizationId,
        code: definition.code,
        name: definition.name,
        siteType: definition.siteType,
        parkingMode: definition.parkingMode,
        status: definition.status,
        timezone: 'Asia/Kolkata',
        city: definition.city,
        state: 'Tamil Nadu',
        totalCapacity: definition.capacity,
        taxProfileId,
        contactEmail: `${definition.code.toLowerCase()}@srijpsmartpark.example`,
      },
    });

    const entryGate = await prisma.gate.create({
      data: { siteId: site.id, code: 'G1', name: 'Main gate - entry', direction: TravelDirection.ENTRY },
    });
    const exitGate = await prisma.gate.create({
      data: { siteId: site.id, code: 'G2', name: 'Main gate - exit', direction: TravelDirection.EXIT },
    });
    const entryLane = await prisma.lane.create({
      data: { gateId: entryGate.id, code: 'L1', name: 'Entry lane 1', direction: TravelDirection.ENTRY },
    });
    const exitLane = await prisma.lane.create({
      data: { gateId: exitGate.id, code: 'L1', name: 'Exit lane 1', direction: TravelDirection.EXIT },
    });

    const zoneIds: string[] = [];
    for (const zone of definition.zones) {
      const created = await prisma.parkingZone.create({
        data: {
          siteId: site.id,
          code: zone.code,
          name: zone.name,
          capacity: zone.capacity,
          allowedClasses: zone.classes,
        },
      });
      zoneIds.push(created.id);

      // Individual bays are modelled only for the yards, where a vehicle's
      // exact position matters for retrieval. Public car parks are counted,
      // not assigned - which is how they actually operate.
      if (definition.parkingMode === ParkingMode.REPOSSESSION_YARD) {
        const bayCount = Math.min(zone.capacity, 60);
        await prisma.parkingSpace.createMany({
          data: Array.from({ length: bayCount }, (_, index) => ({
            zoneId: created.id,
            code: `${zone.code}-${String(index + 1).padStart(3, '0')}`,
            status: ParkingSpaceStatus.AVAILABLE,
          })),
        });
      }
    }

    const entryDeviceCode = `${definition.code}-CAM-IN`;
    const exitDeviceCode = `${definition.code}-CAM-OUT`;
    const online = definition.status === SiteStatus.ACTIVE;

    await prisma.anprDevice.createMany({
      data: [
        {
          siteId: site.id,
          gateId: entryGate.id,
          laneId: entryLane.id,
          code: entryDeviceCode,
          name: `${definition.name} entry camera`,
          provider: 'mock',
          providerDeviceId: entryDeviceCode,
          direction: TravelDirection.ENTRY,
          status: online ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE,
          confidenceThreshold: new Prisma.Decimal('0.8500'),
        },
        {
          siteId: site.id,
          gateId: exitGate.id,
          laneId: exitLane.id,
          code: exitDeviceCode,
          name: `${definition.name} exit camera`,
          provider: 'mock',
          providerDeviceId: exitDeviceCode,
          direction: TravelDirection.EXIT,
          status: online ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE,
          confidenceThreshold: new Prisma.Decimal('0.8500'),
        },
      ],
    });

    seeded.push({
      id: site.id,
      code: site.code,
      name: site.name,
      parkingMode: site.parkingMode,
      zoneIds,
      gateIds: { entry: entryGate.id, exit: exitGate.id },
      laneIds: { entry: entryLane.id, exit: exitLane.id },
      deviceCodes: { entry: entryDeviceCode, exit: exitDeviceCode },
    });
  }

  return seeded;
}

/**
 * Six invented lenders.
 *
 * The names match those the registry simulator returns, so the alias matcher
 * has something real to resolve - the demo shows a genuine match rather than a
 * hard-coded link.
 */
async function seedFinanciers(organizationId: string): Promise<SeededFinancierRef[]> {
  const definitions = [
    { code: 'NVF', legalName: 'Northbridge Vehicle Finance Limited', displayName: 'Northbridge Vehicle Finance' },
    { code: 'SCF', legalName: 'Sundara Capital Finance Ltd', displayName: 'Sundara Capital Finance' },
    { code: 'MAL', legalName: 'Meridian Auto Loans Pvt Ltd', displayName: 'Meridian Auto Loans' },
    { code: 'KCC', legalName: 'Kaveri Commercial Credit Ltd', displayName: 'Kaveri Commercial Credit' },
    { code: 'ERF', legalName: 'Everest Retail Finance Limited', displayName: 'Everest Retail Finance' },
    { code: 'PAF', legalName: 'Palmgrove Asset Finance Pvt Ltd', displayName: 'Palmgrove Asset Finance' },
  ];

  const seeded: SeededFinancierRef[] = [];

  for (const definition of definitions) {
    // The legal and display names frequently normalise to the SAME alias, because
    // normalisation strips corporate suffixes ("... Finance Limited" and
    // "... Finance" both become NORTHBRIDGEVEHICLEFINANCE). De-duplicate before
    // inserting: the (financierId, normalizedAlias) unique index is doing its job.
    const aliasByNormalised = new Map<string, string>();
    for (const alias of [definition.legalName, definition.displayName]) {
      const normalised = normalizeCompanyName(alias);
      if (!aliasByNormalised.has(normalised)) aliasByNormalised.set(normalised, alias);
    }

    const financier = await prisma.financier.create({
      data: {
        organizationId,
        code: definition.code,
        legalName: definition.legalName,
        displayName: definition.displayName,
        city: 'Chennai',
        state: 'Tamil Nadu',
        billingEmail: `billing@${definition.code.toLowerCase()}.example`,
        billingPhone: `+9198${intBetween(10000000, 99999999)}`,
        notificationEmails: [`alerts@${definition.code.toLowerCase()}.example`],
        notificationPhones: [],
        paymentTermsDays: 30,
        notes: 'Fictional counterparty created by the development seed.',
        aliases: {
          create: Array.from(aliasByNormalised.entries()).map(([normalizedAlias, alias]) => ({
            alias,
            normalizedAlias,
            source: 'SEED',
          })),
        },
        contacts: {
          create: [
            {
              name: `${pick(['Arun', 'Divya', 'Kiran', 'Nithya'])} ${pick(['Iyer', 'Reddy', 'Nair'])}`,
              designation: 'Collections manager',
              email: `collections@${definition.code.toLowerCase()}.example`,
              phone: `+9198${intBetween(10000000, 99999999)}`,
              isPrimary: true,
            },
          ],
        },
      },
    });

    seeded.push({
      id: financier.id,
      code: financier.code,
      displayName: financier.displayName,
      legalName: financier.legalName,
    });
  }

  return seeded;
}

/**
 * One contract per financier, each with a different rate shape so every engine
 * variant is represented: free periods, slab ladders, a flat intake charge.
 *
 * EVERY amount is a placeholder.
 */
async function seedContracts(
  organizationId: string,
  financiers: SeededFinancierRef[],
  sites: SeededSiteRef[],
  taxProfileId: string,
): Promise<void> {
  const yardSites = sites.filter((site) => site.parkingMode === ParkingMode.REPOSSESSION_YARD);

  const shapes = [
    {
      label: 'Tiered daily rate with a seven-day free period',
      freeUnits: '7',
      slabs: [
        { from: 1, to: 30, amount: '120.0000', description: 'Days 1-30 (placeholder rate)' },
        { from: 31, to: 60, amount: '90.0000', description: 'Days 31-60 (placeholder rate)' },
        { from: 61, to: null, amount: '70.0000', description: 'Day 61 onwards (placeholder rate)' },
      ],
    },
    {
      label: 'Flat daily rate, no free period',
      freeUnits: '0',
      slabs: [{ from: 1, to: null, amount: '100.0000', description: 'Flat per day (placeholder rate)' }],
    },
    {
      label: 'Short free period with two tiers',
      freeUnits: '3',
      slabs: [
        { from: 1, to: 45, amount: '110.0000', description: 'Days 1-45 (placeholder rate)' },
        { from: 46, to: null, amount: '80.0000', description: 'Day 46 onwards (placeholder rate)' },
      ],
    },
    {
      label: 'Flat intake handling charge, then daily',
      freeUnits: '0',
      slabs: [
        { from: 1, to: 1, amount: '750.0000', kind: RateSlabKind.FLAT, description: 'Intake handling (placeholder)' },
        { from: 2, to: null, amount: '95.0000', description: 'Day 2 onwards (placeholder rate)' },
      ],
    },
    {
      label: 'Long free period, single tier',
      freeUnits: '15',
      slabs: [{ from: 1, to: null, amount: '130.0000', description: 'Per day after the free period (placeholder)' }],
    },
    {
      label: 'Tiered with a long-tail discount',
      freeUnits: '5',
      slabs: [
        { from: 1, to: 20, amount: '140.0000', description: 'Days 1-20 (placeholder rate)' },
        { from: 21, to: 90, amount: '95.0000', description: 'Days 21-90 (placeholder rate)' },
        { from: 91, to: null, amount: '55.0000', description: 'Day 91 onwards (placeholder rate)' },
      ],
    },
  ];

  for (const [index, financier] of financiers.entries()) {
    const shape = shapes[index % shapes.length]!;

    const contract = await prisma.contract.create({
      data: {
        organizationId,
        financierId: financier.id,
        code: `CTR-${financier.code}-001`,
        title: `${financier.displayName} - repossession yard parking`,
        status: ContractStatus.ACTIVE,
        notes: `${PLACEHOLDER} Commercial terms pending (OI-04, OI-05).`,
      },
    });

    const contractVersion = await prisma.contractVersion.create({
      data: {
        contractId: contract.id,
        versionNo: 1,
        status: ContractVersionStatus.ACTIVE,
        effectiveFrom: daysAgo(400),
        // FINANCIER as the fallback reflects the requirement's framing that
        // financiers park repossessed vehicles here. The BillingRule rows are
        // what actually decide; the real matrix is OI-06.
        defaultBillingParty: BillingPartyType.FINANCIER,
        paymentTermsDays: 30,
        taxProfileId,
        approvedAt: daysAgo(400),
        notes: `${PLACEHOLDER} ${shape.label}.`,
      },
    });

    await prisma.ratePlan.create({
      data: {
        organizationId,
        scope: RatePlanScope.CONTRACT,
        contractVersionId: contractVersion.id,
        siteId: null,
        vehicleClass: null,
        code: `RP-${financier.code}-STD`,
        name: `${financier.displayName} standard yard rate`,
        description: `${PLACEHOLDER} ${shape.label}.`,
        billingUnit: 'CALENDAR_DAY',
        roundingMode: 'CEIL',
        freeUnits: new Prisma.Decimal(shape.freeUnits),
        // SKIP_LADDER matches the worked example in the requirements. The
        // alternative reading (CONSUME_LADDER) is documented as OI-05 and is a
        // single field change per plan.
        freeUnitPolicy: 'SKIP_LADDER',
        graceMinutes: 0,
        currency: 'INR',
        effectiveFrom: daysAgo(400),
        status: RatePlanStatus.ACTIVE,
        priority: 100,
        slabs: {
          create: shape.slabs.map((slab, slabIndex) => ({
            sequence: slabIndex + 1,
            fromUnit: new Prisma.Decimal(slab.from),
            toUnit: slab.to === null ? null : new Prisma.Decimal(slab.to),
            kind: ('kind' in slab && slab.kind) || RateSlabKind.PER_UNIT,
            amount: new Prisma.Decimal(slab.amount),
            description: slab.description,
          })),
        },
      },
    });

    // A site-specific override on one contract, so resolution precedence is
    // visible in the demo rather than merely implemented.
    if (index === 0 && yardSites[1]) {
      await prisma.ratePlan.create({
        data: {
          organizationId,
          scope: RatePlanScope.CONTRACT,
          contractVersionId: contractVersion.id,
          siteId: yardSites[1].id,
          code: `RP-${financier.code}-CBE`,
          name: `${financier.displayName} Coimbatore rate`,
          description: `${PLACEHOLDER} Site-specific override demonstrating resolution precedence.`,
          billingUnit: 'CALENDAR_DAY',
          roundingMode: 'CEIL',
          freeUnits: new Prisma.Decimal('7'),
          freeUnitPolicy: 'SKIP_LADDER',
          graceMinutes: 0,
          currency: 'INR',
          effectiveFrom: daysAgo(300),
          status: RatePlanStatus.ACTIVE,
          priority: 200,
          slabs: {
            create: [
              {
                sequence: 1,
                fromUnit: new Prisma.Decimal(1),
                toUnit: null,
                kind: RateSlabKind.PER_UNIT,
                amount: new Prisma.Decimal('95.0000'),
                description: 'Flat per day at Coimbatore (placeholder rate)',
              },
            ],
          },
        },
      });
    }
  }
}

/** Hourly tariffs for the Phase 2 sites, with a daily cap. All placeholders. */
async function seedSiteTariffs(organizationId: string, sites: SeededSiteRef[]): Promise<void> {
  for (const site of sites.filter((s) => s.parkingMode === ParkingMode.PUBLIC_PARKING)) {
    await prisma.ratePlan.create({
      data: {
        organizationId,
        scope: RatePlanScope.SITE_TARIFF,
        siteId: site.id,
        code: `TAR-${site.code}`,
        name: `${site.name} public tariff`,
        description: `${PLACEHOLDER} Phase 2 tariff pending the signed contract (OI-07).`,
        billingUnit: 'HOUR',
        roundingMode: 'CEIL',
        freeUnits: new Prisma.Decimal('0'),
        freeUnitPolicy: 'SKIP_LADDER',
        // A free drop-off window is standard; the length is a placeholder.
        graceMinutes: 15,
        dailyCapAmount: new Prisma.Decimal('300.0000'),
        currency: 'INR',
        effectiveFrom: daysAgo(30),
        status: RatePlanStatus.ACTIVE,
        priority: 100,
        slabs: {
          create: [
            { sequence: 1, fromUnit: new Prisma.Decimal(1), toUnit: new Prisma.Decimal(1), kind: RateSlabKind.PER_UNIT, amount: new Prisma.Decimal('40.0000'), description: 'First hour (placeholder rate)' },
            { sequence: 2, fromUnit: new Prisma.Decimal(2), toUnit: new Prisma.Decimal(6), kind: RateSlabKind.PER_UNIT, amount: new Prisma.Decimal('25.0000'), description: 'Hours 2-6 (placeholder rate)' },
            { sequence: 3, fromUnit: new Prisma.Decimal(7), toUnit: null, kind: RateSlabKind.PER_UNIT, amount: new Prisma.Decimal('15.0000'), description: 'Hour 7 onwards (placeholder rate)' },
          ],
        },
      },
    });
  }
}

/**
 * Billing rules: the configurable answer to "financier or customer?".
 *
 * These are a DEFENSIBLE STARTING POINT that makes the mechanism visible, not a
 * Sri JP policy (OI-06). Replacing them is a data change, not a code change.
 */
async function seedBillingRules(organizationId: string): Promise<void> {
  await prisma.billingRule.createMany({
    data: [
      {
        organizationId,
        code: 'BR-PUBLIC-DRIVER',
        name: 'Public parking is settled by the driver',
        description: 'A public car park is a cash-at-barrier business.',
        scopeType: BillingRuleScope.GLOBAL,
        priority: 900,
        conditions: { all: [{ fact: 'parkingMode', op: 'eq', value: 'PUBLIC_PARKING' }] },
        outcomePartyType: BillingPartyType.CUSTOMER,
        outcomeNote: 'Settled at the exit barrier.',
      },
      {
        organizationId,
        code: 'BR-AUCTION-BIDDER',
        name: 'Auction sale is billed to the winning bidder',
        description: 'The sale invoice goes to whoever won the lot.',
        scopeType: BillingRuleScope.GLOBAL,
        priority: 800,
        conditions: { all: [{ fact: 'soldAtAuction', op: 'eq', value: true }] },
        outcomePartyType: BillingPartyType.BIDDER,
      },
      {
        organizationId,
        code: 'BR-YARD-FINANCIER',
        name: 'Yard parking is billed to the financier',
        description: `${PLACEHOLDER} Default pending the confirmed matrix (OI-06).`,
        scopeType: BillingRuleScope.GLOBAL,
        priority: 100,
        conditions: {
          all: [
            { fact: 'parkingMode', op: 'eq', value: 'REPOSSESSION_YARD' },
            { fact: 'financierMatched', op: 'eq', value: true },
          ],
        },
        outcomePartyType: BillingPartyType.FINANCIER,
      },
      {
        organizationId,
        code: 'BR-FALLBACK-CUSTOMER',
        name: 'Unmatched vehicle falls to the collecting party',
        description:
          'With no matched financier there is nobody to invoice but whoever collects. These ' +
          'cases should be rare and are worth reviewing.',
        scopeType: BillingRuleScope.GLOBAL,
        priority: 10,
        conditions: { all: [{ fact: 'financierMatched', op: 'eq', value: false }] },
        outcomePartyType: BillingPartyType.CUSTOMER,
      },
    ],
  });
}

async function seedInvoiceSeries(organizationId: string): Promise<void> {
  const financialYear = '2025-26';
  await prisma.invoiceSeries.createMany({
    data: [
      { organizationId, code: 'PARKING', name: 'Parking invoices', type: InvoiceType.PARKING, prefix: `SJP/PKG/${financialYear}/`, financialYear, nextSequence: 1, padding: 5 },
      { organizationId, code: 'SALE', name: 'Auction sale invoices', type: InvoiceType.SALE, prefix: `SJP/SAL/${financialYear}/`, financialYear, nextSequence: 1, padding: 5 },
      { organizationId, code: 'CREDIT', name: 'Credit notes', type: InvoiceType.CREDIT_NOTE, prefix: `SJP/CRN/${financialYear}/`, financialYear, nextSequence: 1, padding: 5 },
    ],
  });
}

async function seedNotificationTemplates(organizationId: string): Promise<void> {
  const templates = [
    {
      code: 'VEHICLE_ADMITTED', channel: 'EMAIL' as const, name: 'Vehicle admitted to yard',
      subjectTemplate: 'Vehicle {{registrationNumber}} admitted at {{siteName}}',
      bodyTemplate:
        'Dear {{financierName}},\n\nVehicle {{registrationNumber}} ({{makeModel}}) was admitted to ' +
        '{{siteName}} on {{entryAt}} under stay {{sessionNumber}}.\n\nSri JP Smartpark',
      variables: ['financierName', 'registrationNumber', 'makeModel', 'siteName', 'entryAt', 'sessionNumber'],
    },
    {
      code: 'VEHICLE_ADMITTED', channel: 'SMS' as const, name: 'Vehicle admitted (SMS)',
      subjectTemplate: null,
      bodyTemplate: 'Sri JP Smartpark: vehicle {{registrationNumber}} admitted at {{siteName}} on {{entryAt}}. Ref {{sessionNumber}}.',
      variables: ['registrationNumber', 'siteName', 'entryAt', 'sessionNumber'],
    },
    {
      code: 'INVOICE_ISSUED', channel: 'EMAIL' as const, name: 'Invoice issued',
      subjectTemplate: 'Invoice {{invoiceNumber}} from Sri JP Smartpark',
      bodyTemplate:
        'Dear {{billingPartyName}},\n\nInvoice {{invoiceNumber}} for {{currency}} {{total}} has been ' +
        'issued for vehicle {{registrationNumber}}.\nDue date: {{dueDate}}.\n\nSri JP Smartpark',
      variables: ['billingPartyName', 'invoiceNumber', 'currency', 'total', 'registrationNumber', 'dueDate'],
    },
    {
      code: 'INVOICE_ISSUED', channel: 'WHATSAPP' as const, name: 'Invoice issued (WhatsApp)',
      subjectTemplate: null,
      bodyTemplate: 'Sri JP Smartpark: invoice {{invoiceNumber}} for {{currency}} {{total}} (vehicle {{registrationNumber}}) is due on {{dueDate}}.',
      variables: ['invoiceNumber', 'currency', 'total', 'registrationNumber', 'dueDate'],
    },
    {
      code: 'RELEASE_APPROVED', channel: 'SMS' as const, name: 'Release approved',
      subjectTemplate: null,
      bodyTemplate: 'Sri JP Smartpark: release {{requestNumber}} for vehicle {{registrationNumber}} is approved. Present code {{authorizationCode}} at the gate.',
      variables: ['requestNumber', 'registrationNumber', 'authorizationCode'],
    },
    {
      code: 'AUCTION_WON', channel: 'EMAIL' as const, name: 'Auction lot won',
      subjectTemplate: 'You have won lot {{lotNumber}} in auction {{auctionCode}}',
      bodyTemplate:
        'Dear {{bidderName}},\n\nYour bid of {{currency}} {{amount}} for lot {{lotNumber}} ' +
        '({{registrationNumber}}) was successful.\nSettlement is due by {{dueDate}}.\n\nSri JP Smartpark',
      variables: ['bidderName', 'lotNumber', 'auctionCode', 'currency', 'amount', 'registrationNumber', 'dueDate'],
    },
  ];

  for (const template of templates) {
    await prisma.notificationTemplate.create({
      data: {
        organizationId,
        code: template.code,
        channel: template.channel,
        locale: 'en',
        name: template.name,
        subjectTemplate: template.subjectTemplate,
        bodyTemplate: template.bodyTemplate,
        variables: template.variables,
      },
    });
  }
}

/** Operational thresholds that must be tunable without a deploy (S41). */
async function seedSystemSettings(organizationId: string): Promise<void> {
  const settings = [
    { key: 'financier.match.autoAcceptConfidence', value: 0.8, dataType: 'NUMBER' as const, description: 'Minimum confidence at which a registry financier match is applied automatically. Below this it is a suggestion for review.' },
    { key: 'vehicle.ageing.alertDays', value: 90, dataType: 'NUMBER' as const, description: 'Stay length after which a vehicle is highlighted as ageing.' },
    { key: 'vehicle.auction.eligibleAfterDays', value: 180, dataType: 'NUMBER' as const, description: 'PLACEHOLDER. Stay length after which a vehicle is suggested for auction. The real rule depends on the financier agreement and legal notice period (OI-04).' },
    { key: 'release.requireInvoiceSettled', value: false, dataType: 'BOOLEAN' as const, description: 'PLACEHOLDER. Whether an outstanding balance blocks release. Sri JP must confirm whether financiers settle on account or per vehicle (OI-06).' },
    { key: 'release.authorizationCodeTtlMinutes', value: 240, dataType: 'DURATION_MINUTES' as const, description: 'How long a gate authorisation code remains valid.' },
    { key: 'auction.settlement.dueDays', value: 7, dataType: 'NUMBER' as const, description: 'PLACEHOLDER. Days a winning bidder has to settle (OI-04).' },
    { key: 'notification.financier.onAdmission', value: true, dataType: 'BOOLEAN' as const, description: 'Alert a financier when one of their vehicles is admitted.' },
  ];

  for (const setting of settings) {
    await prisma.systemSetting.create({
      data: {
        organizationId,
        scope: 'GLOBAL',
        siteScopeKey: 'GLOBAL',
        key: setting.key,
        valueJson: setting.value as Prisma.InputJsonValue,
        dataType: setting.dataType,
        description: setting.description,
      },
    });
  }
}

async function seedUsers(
  organizationId: string,
  roles: Map<string, string>,
  sites: SeededSiteRef[],
  financiers: SeededFinancierRef[],
  adminEmail: string,
  adminPassword: string,
  demoPassword: string,
): Promise<SeededUserRefs> {
  const adminHash = await hashPassword(adminPassword);
  const demoHash = await hashPassword(demoPassword);
  const yardSiteIds = sites
    .filter((site) => site.parkingMode === ParkingMode.REPOSSESSION_YARD)
    .map((site) => site.id);

  async function createUser(input: {
    email: string;
    fullName: string;
    roleCode: string;
    passwordHash: string;
    siteIds?: string[];
    financierId?: string | null;
    isServiceAccount?: boolean;
  }): Promise<string> {
    const roleId = roles.get(input.roleCode);
    if (!roleId) throw new Error(`Role ${input.roleCode} was not seeded.`);

    const user = await prisma.user.create({
      data: {
        organizationId,
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        passwordAlgorithm: 'scrypt',
        status: UserStatus.ACTIVE,
        financierId: input.financierId ?? null,
        isServiceAccount: input.isServiceAccount ?? false,
        roles: { create: [{ roleId }] },
        ...(input.siteIds && input.siteIds.length > 0
          ? { siteAccess: { create: input.siteIds.map((siteId) => ({ siteId })) } }
          : {}),
      },
    });
    return user.id;
  }

  const adminId = await createUser({
    email: adminEmail,
    fullName: 'System Administrator',
    roleCode: RoleCode.SYSTEM_ADMINISTRATOR,
    passwordHash: adminHash,
  });

  const managementId = await createUser({
    email: 'management@srijpsmartpark.example',
    fullName: 'Priya Management',
    roleCode: RoleCode.MANAGEMENT,
    passwordHash: demoHash,
  });

  // Scoped to one site each, so site isolation is demonstrable by signing in.
  const yardStaffId = await createUser({
    email: 'yard.chennai@srijpsmartpark.example',
    fullName: 'Suresh Yard Supervisor',
    roleCode: RoleCode.YARD_STAFF,
    passwordHash: demoHash,
    siteIds: yardSiteIds.slice(0, 1),
  });

  await createUser({
    email: 'yard.coimbatore@srijpsmartpark.example',
    fullName: 'Latha Yard Supervisor',
    roleCode: RoleCode.YARD_STAFF,
    passwordHash: demoHash,
    siteIds: yardSiteIds.slice(1, 2),
  });

  const financeId = await createUser({
    email: 'finance@srijpsmartpark.example',
    fullName: 'Ganesh Finance Officer',
    roleCode: RoleCode.FINANCE_OFFICER,
    passwordHash: demoHash,
  });

  const auctionAdminId = await createUser({
    email: 'auctions@srijpsmartpark.example',
    fullName: 'Meera Auction Administrator',
    roleCode: RoleCode.AUCTION_ADMINISTRATOR,
    passwordHash: demoHash,
  });

  // Two financier portal logins, so cross-financier isolation can be proved.
  for (const financier of financiers.slice(0, 2)) {
    await createUser({
      email: `portal@${financier.code.toLowerCase()}.example`,
      fullName: `${financier.displayName} portal user`,
      roleCode: RoleCode.FINANCIER_USER,
      passwordHash: demoHash,
      financierId: financier.id,
    });
  }

  // Machine principal for the cameras: ingest only, random unusable password.
  await createUser({
    email: 'anpr-gateway@devices.srijpsmartpark.example',
    fullName: 'ANPR gateway service account',
    roleCode: RoleCode.DEVICE_SERVICE_ACCOUNT,
    passwordHash: await hashPassword(randomUUID()),
    isServiceAccount: true,
  });

  return { adminId, managementId, yardStaffId, financeId, auctionAdminId };
}

async function printSummary(
  adminEmail: string,
  adminPassword: string,
  demoPassword: string,
  elapsedMs: number,
): Promise<void> {
  const [sites, financiers, vehicles, openSessions, invoices, bids, auditRows] = await Promise.all([
    prisma.site.count(),
    prisma.financier.count(),
    prisma.vehicle.count(),
    prisma.parkingSession.count({ where: { status: 'OPEN' } }),
    prisma.invoice.count(),
    prisma.bid.count(),
    prisma.auditLog.count(),
  ]);

  const outstanding = await prisma.invoice.aggregate({
    _sum: { balance: true },
    where: { status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] } },
  });

  console.log(`
================================================================
  SmartPark Enterprise - seed complete in ${(elapsedMs / 1000).toFixed(1)}s
================================================================

  Sites                 ${sites}   (2 yards + 3 Phase 2 sites, PLANNED)
  Financiers            ${financiers}
  Vehicles              ${vehicles}
  Open stays            ${openSessions}
  Invoices              ${invoices}
  Auction bids          ${bids}
  Audit entries         ${auditRows}
  Outstanding balance   INR ${(outstanding._sum.balance ?? 0).toString()}

  SIGN IN
  --------------------------------------------------------------
  System administrator  ${adminEmail}
                        ${adminPassword}

  Management            management@srijpsmartpark.example
  Yard (Chennai only)   yard.chennai@srijpsmartpark.example
  Yard (Coimbatore)     yard.coimbatore@srijpsmartpark.example
  Finance               finance@srijpsmartpark.example
  Auctions              auctions@srijpsmartpark.example
  Financier portal      portal@nvf.example
  Financier portal      portal@scf.example
                        (all of the above: ${demoPassword})

  NOTE ON THE DATA
  --------------------------------------------------------------
  Every rate, tax rate, fee and threshold above is a PLACEHOLDER.
  None of it is a Sri JP commercial term - see docs/open-items.md.
  Ownership data is produced by the registry SIMULATOR and is
  marked non-authoritative throughout the platform.
================================================================
`);
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
