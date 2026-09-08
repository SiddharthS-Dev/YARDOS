/**
 * Permission catalogue and the default role bundles.
 *
 * Authorisation model (three independent checks, all enforced server-side):
 *
 *   1. PERMISSION  - does the caller's role set grant this verb on this resource?
 *   2. SITE SCOPE  - is the record's site inside the caller's site grants?
 *                    (Users with `site:access:all` bypass this.)
 *   3. OBJECT SCOPE- for financier portal users, does the record belong to their
 *                    own financier? Enforced by `FinancierScopeGuard` and by
 *                    mandatory `financierId` predicates in the repositories.
 *
 * The console uses this catalogue only to hide affordances. It is never the
 * authority - every API handler re-checks.
 */

export const Permission = {
  /* --- Platform administration ---------------------------------- */
  'org:read': 'org:read',
  'org:write': 'org:write',
  'user:read': 'user:read',
  'user:write': 'user:write',
  'user:impersonate': 'user:impersonate',
  'role:read': 'role:read',
  'role:write': 'role:write',
  'setting:read': 'setting:read',
  'setting:write': 'setting:write',
  'integration:read': 'integration:read',
  'integration:write': 'integration:write',
  'audit:read': 'audit:read',
  'job:read': 'job:read',
  'job:trigger': 'job:trigger',

  /* --- Site & topology ------------------------------------------ */
  'site:read': 'site:read',
  'site:write': 'site:write',
  /** Grants visibility of every site, bypassing per-user site grants. */
  'site:access:all': 'site:access:all',
  'gate:read': 'gate:read',
  'gate:write': 'gate:write',
  'zone:read': 'zone:read',
  'zone:write': 'zone:write',

  /* --- Vehicle -------------------------------------------------- */
  'vehicle:read': 'vehicle:read',
  'vehicle:write': 'vehicle:write',
  /** See registered-owner PII unmasked. Deliberately narrow (requirement S36). */
  'vehicle:pii:read': 'vehicle:pii:read',
  'vehicle:timeline:read': 'vehicle:timeline:read',

  /* --- ANPR ----------------------------------------------------- */
  'anpr:device:read': 'anpr:device:read',
  'anpr:device:write': 'anpr:device:write',
  'anpr:event:read': 'anpr:event:read',
  /** Ingest capture events. Held by device service accounts, not humans. */
  'anpr:event:ingest': 'anpr:event:ingest',
  /** Resolve a low-confidence or unreadable capture by hand. Always audited. */
  'anpr:event:review': 'anpr:event:review',

  /* --- Vehicle registry (VAHAN / aggregator) -------------------- */
  'registry:lookup': 'registry:lookup',
  'registry:read': 'registry:read',
  'registry:verify:manual': 'registry:verify:manual',

  /* --- Financier ------------------------------------------------ */
  'financier:read': 'financier:read',
  'financier:write': 'financier:write',
  /** The financier-portal search over the central vehicle repository. */
  'financier:portal:search': 'financier:portal:search',

  /* --- Contract & rating ---------------------------------------- */
  'contract:read': 'contract:read',
  'contract:write': 'contract:write',
  /** Activating a contract version changes what customers are charged. */
  'contract:approve': 'contract:approve',
  'rate:read': 'rate:read',
  'rate:write': 'rate:write',
  'billingrule:read': 'billingrule:read',
  'billingrule:write': 'billingrule:write',

  /* --- Parking operations --------------------------------------- */
  'session:read': 'session:read',
  'session:admit': 'session:admit',
  'session:allocate': 'session:allocate',
  'session:hold': 'session:hold',
  'session:close': 'session:close',
  'charge:read': 'charge:read',
  'charge:recalculate': 'charge:recalculate',

  /* --- Release -------------------------------------------------- */
  'release:read': 'release:read',
  'release:request': 'release:request',
  /** Segregation of duty: an approver may not approve their own request. */
  'release:approve': 'release:approve',
  'release:execute': 'release:execute',

  /* --- Billing -------------------------------------------------- */
  'invoice:read': 'invoice:read',
  'invoice:generate': 'invoice:generate',
  'invoice:issue': 'invoice:issue',
  'invoice:void': 'invoice:void',
  'invoice:send': 'invoice:send',
  'payment:read': 'payment:read',
  'payment:record': 'payment:record',
  'payment:refund': 'payment:refund',

  /* --- Auction -------------------------------------------------- */
  'auction:read': 'auction:read',
  'auction:write': 'auction:write',
  'auction:publish': 'auction:publish',
  'auction:open': 'auction:open',
  'auction:close': 'auction:close',
  /** Separated from auction:close so one person cannot run a whole auction. */
  'auction:selectwinner': 'auction:selectwinner',
  'bidder:read': 'bidder:read',
  'bidder:write': 'bidder:write',
  'bidder:approve': 'bidder:approve',
  'bid:read': 'bid:read',
  'bid:place': 'bid:place',
  /** Place a bid on a bidder's behalf at a physical auction hall. Audited. */
  'bid:place:onbehalf': 'bid:place:onbehalf',
  'settlement:read': 'settlement:read',
  'settlement:write': 'settlement:write',

  /* --- Notification & documents --------------------------------- */
  'notification:read': 'notification:read',
  'notification:template:write': 'notification:template:write',
  'notification:send': 'notification:send',
  'document:read': 'document:read',
  'document:write': 'document:write',

  /* --- Reporting ------------------------------------------------ */
  'report:operations': 'report:operations',
  'report:finance': 'report:finance',
  'report:auction': 'report:auction',
  'report:financier': 'report:financier',
  'report:export': 'report:export',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

/**
 * Built-in role codes. Sites may define additional custom roles at runtime;
 * these five are seeded and cannot be deleted.
 */
export const RoleCode = {
  SYSTEM_ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR',
  MANAGEMENT: 'MANAGEMENT',
  YARD_STAFF: 'YARD_STAFF',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
  AUCTION_ADMINISTRATOR: 'AUCTION_ADMINISTRATOR',
  FINANCIER_USER: 'FINANCIER_USER',
  /** Non-human principal used by ANPR gateways to post capture events. */
  DEVICE_SERVICE_ACCOUNT: 'DEVICE_SERVICE_ACCOUNT',
} as const;
export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];

const P = Permission;

/**
 * Default permission bundles.
 *
 * ASSUMPTION / PROPOSED DESIGN: the requirements name five user groups
 * (Sri JP management, yard staff, finance company users, auction administrators,
 * system administrators). FINANCE_OFFICER and DEVICE_SERVICE_ACCOUNT are added
 * because billing duties and machine ingestion must not be carried out under a
 * human management login. Confirm the final matrix with Sri JP before go-live.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly Permission[]>> = {
  // Full platform control, including user and integration administration.
  SYSTEM_ADMINISTRATOR: ALL_PERMISSIONS,

  // Full business visibility and reporting; deliberately NOT granted the
  // operational verbs that create financial records (issue/void/settle), so
  // management sign-off stays distinct from execution.
  MANAGEMENT: [
    P['org:read'],
    P['user:read'],
    P['role:read'],
    P['setting:read'],
    P['audit:read'],
    P['job:read'],
    P['site:read'],
    P['site:access:all'],
    P['gate:read'],
    P['zone:read'],
    P['vehicle:read'],
    P['vehicle:pii:read'],
    P['vehicle:timeline:read'],
    P['anpr:device:read'],
    P['anpr:event:read'],
    P['registry:read'],
    P['financier:read'],
    P['contract:read'],
    P['rate:read'],
    P['billingrule:read'],
    P['session:read'],
    P['charge:read'],
    P['release:read'],
    P['release:approve'],
    P['invoice:read'],
    P['payment:read'],
    P['auction:read'],
    P['bidder:read'],
    P['bid:read'],
    P['settlement:read'],
    P['notification:read'],
    P['document:read'],
    P['report:operations'],
    P['report:finance'],
    P['report:auction'],
    P['report:financier'],
    P['report:export'],
  ],

  // Gate and yard floor. Can admit, allocate, hold and request release, but
  // cannot approve a release or touch money.
  YARD_STAFF: [
    P['site:read'],
    P['gate:read'],
    P['zone:read'],
    P['vehicle:read'],
    P['vehicle:write'],
    P['vehicle:timeline:read'],
    P['anpr:device:read'],
    P['anpr:event:read'],
    P['anpr:event:review'],
    P['registry:lookup'],
    P['registry:read'],
    P['financier:read'],
    P['contract:read'],
    P['rate:read'],
    P['session:read'],
    P['session:admit'],
    P['session:allocate'],
    P['session:hold'],
    P['charge:read'],
    P['release:read'],
    P['release:request'],
    P['release:execute'],
    P['document:read'],
    P['document:write'],
    P['report:operations'],
  ],

  // Owns the billing lifecycle end to end.
  FINANCE_OFFICER: [
    P['site:read'],
    P['site:access:all'],
    P['vehicle:read'],
    P['vehicle:pii:read'],
    P['vehicle:timeline:read'],
    P['financier:read'],
    P['financier:write'],
    P['contract:read'],
    P['contract:write'],
    P['rate:read'],
    P['rate:write'],
    P['billingrule:read'],
    P['session:read'],
    P['charge:read'],
    P['charge:recalculate'],
    P['release:read'],
    P['invoice:read'],
    P['invoice:generate'],
    P['invoice:issue'],
    P['invoice:send'],
    P['invoice:void'],
    P['payment:read'],
    P['payment:record'],
    P['settlement:read'],
    P['notification:read'],
    P['document:read'],
    P['document:write'],
    P['report:finance'],
    P['report:operations'],
    P['report:export'],
  ],

  // Runs auctions. Note: no invoice:issue and no payment:record - the sale
  // invoice is raised by finance, keeping disposal and cash collection apart.
  AUCTION_ADMINISTRATOR: [
    P['site:read'],
    P['site:access:all'],
    P['vehicle:read'],
    P['vehicle:timeline:read'],
    P['financier:read'],
    P['session:read'],
    P['charge:read'],
    P['auction:read'],
    P['auction:write'],
    P['auction:publish'],
    P['auction:open'],
    P['auction:close'],
    P['auction:selectwinner'],
    P['bidder:read'],
    P['bidder:write'],
    P['bidder:approve'],
    P['bid:read'],
    P['bid:place:onbehalf'],
    P['settlement:read'],
    P['settlement:write'],
    P['invoice:read'],
    P['invoice:generate'],
    P['document:read'],
    P['document:write'],
    P['report:auction'],
  ],

  // Financier portal. Every one of these reads is additionally narrowed to the
  // user's own financier by FinancierScopeGuard - the permission alone grants
  // nothing across financier boundaries.
  FINANCIER_USER: [
    P['financier:portal:search'],
    P['vehicle:read'],
    P['vehicle:timeline:read'],
    P['session:read'],
    P['charge:read'],
    P['invoice:read'],
    P['payment:read'],
    P['contract:read'],
    P['rate:read'],
    P['document:read'],
    P['report:financier'],
  ],

  // Machine principal for ANPR gateways. Ingest only - no read access at all,
  // so a leaked device credential cannot enumerate the yard.
  DEVICE_SERVICE_ACCOUNT: [P['anpr:event:ingest']],
};

/** Roles whose users must be linked to a financier record. */
export const FINANCIER_SCOPED_ROLES: readonly RoleCode[] = [RoleCode.FINANCIER_USER];

/** Roles that may never be assigned to an interactive human login. */
export const MACHINE_ONLY_ROLES: readonly RoleCode[] = [RoleCode.DEVICE_SERVICE_ACCOUNT];
