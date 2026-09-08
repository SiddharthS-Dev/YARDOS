/**
 * Canonical domain enumerations.
 *
 * These values are mirrored 1:1 by the Prisma schema (`apps/api/prisma/schema.prisma`).
 * They are declared here so the API and the web console cannot drift apart.
 *
 * Naming rule: enum member name === wire value. Never rename or reuse a value;
 * persisted rows and audit history reference these strings forever.
 */

/* ------------------------------------------------------------------ */
/* Tenancy, sites and topology                                         */
/* ------------------------------------------------------------------ */

/**
 * The business line a site belongs to.
 *
 * REPOSSESSION_YARD is Phase 1. The public-parking variants are Phase 2 and are
 * present so the domain model, rating engine and reporting do not require rework
 * when those contracts are signed. See docs/open-items.md (OI-07/OI-08).
 */
export const SiteType = {
  REPOSSESSION_YARD: 'REPOSSESSION_YARD',
  AIRPORT_PARKING: 'AIRPORT_PARKING',
  METRO_PARKING: 'METRO_PARKING',
  RAILWAY_PARKING: 'RAILWAY_PARKING',
  OTHER_PUBLIC_PARKING: 'OTHER_PUBLIC_PARKING',
} as const;
export type SiteType = (typeof SiteType)[keyof typeof SiteType];

/**
 * How a parking session at a site is governed.
 *
 * REPOSSESSION_YARD - rated from a financier contract, released via approval workflow.
 * PUBLIC_PARKING    - rated from a site tariff, released on payment at exit.
 */
export const ParkingMode = {
  REPOSSESSION_YARD: 'REPOSSESSION_YARD',
  PUBLIC_PARKING: 'PUBLIC_PARKING',
} as const;
export type ParkingMode = (typeof ParkingMode)[keyof typeof ParkingMode];

export const SiteStatus = {
  PLANNED: 'PLANNED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DECOMMISSIONED: 'DECOMMISSIONED',
} as const;
export type SiteStatus = (typeof SiteStatus)[keyof typeof SiteStatus];

export const TravelDirection = {
  ENTRY: 'ENTRY',
  EXIT: 'EXIT',
  BIDIRECTIONAL: 'BIDIRECTIONAL',
} as const;
export type TravelDirection = (typeof TravelDirection)[keyof typeof TravelDirection];

export const GateStatus = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type GateStatus = (typeof GateStatus)[keyof typeof GateStatus];

export const ParkingSpaceStatus = {
  AVAILABLE: 'AVAILABLE',
  OCCUPIED: 'OCCUPIED',
  RESERVED: 'RESERVED',
  BLOCKED: 'BLOCKED',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
} as const;
export type ParkingSpaceStatus = (typeof ParkingSpaceStatus)[keyof typeof ParkingSpaceStatus];

/* ------------------------------------------------------------------ */
/* Vehicle                                                             */
/* ------------------------------------------------------------------ */

export const VehicleClass = {
  TWO_WHEELER: 'TWO_WHEELER',
  THREE_WHEELER: 'THREE_WHEELER',
  CAR: 'CAR',
  SUV: 'SUV',
  LCV: 'LCV',
  HCV: 'HCV',
  BUS: 'BUS',
  TRACTOR: 'TRACTOR',
  CONSTRUCTION_EQUIPMENT: 'CONSTRUCTION_EQUIPMENT',
  UNKNOWN: 'UNKNOWN',
} as const;
export type VehicleClass = (typeof VehicleClass)[keyof typeof VehicleClass];

export const FuelType = {
  PETROL: 'PETROL',
  DIESEL: 'DIESEL',
  CNG: 'CNG',
  LPG: 'LPG',
  ELECTRIC: 'ELECTRIC',
  HYBRID: 'HYBRID',
  UNKNOWN: 'UNKNOWN',
} as const;
export type FuelType = (typeof FuelType)[keyof typeof FuelType];

/**
 * Canonical vehicle lifecycle. Transitions are enforced server-side by
 * `VehicleStateMachine`; the UI never writes a status directly.
 */
export const VehicleStatus = {
  CAPTURED: 'CAPTURED',
  IDENTIFIED: 'IDENTIFIED',
  VAHAN_PENDING: 'VAHAN_PENDING',
  VAHAN_VERIFIED: 'VAHAN_VERIFIED',
  VAHAN_FAILED: 'VAHAN_FAILED',
  FINANCIER_MATCHED: 'FINANCIER_MATCHED',
  YARD_ADMITTED: 'YARD_ADMITTED',
  PARKED: 'PARKED',
  UNDER_HOLD: 'UNDER_HOLD',
  RELEASE_REQUESTED: 'RELEASE_REQUESTED',
  RELEASE_APPROVED: 'RELEASE_APPROVED',
  AUCTION_ELIGIBLE: 'AUCTION_ELIGIBLE',
  AUCTION_LISTED: 'AUCTION_LISTED',
  BIDDING_OPEN: 'BIDDING_OPEN',
  BIDDING_CLOSED: 'BIDDING_CLOSED',
  WINNER_SELECTED: 'WINNER_SELECTED',
  SETTLEMENT_PENDING: 'SETTLEMENT_PENDING',
  SETTLED: 'SETTLED',
  SOLD: 'SOLD',
  EXITED: 'EXITED',
} as const;
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

export const VahanVerificationStatus = {
  NOT_REQUESTED: 'NOT_REQUESTED',
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  UNAVAILABLE: 'UNAVAILABLE',
  MANUALLY_VERIFIED: 'MANUALLY_VERIFIED',
} as const;
export type VahanVerificationStatus =
  (typeof VahanVerificationStatus)[keyof typeof VahanVerificationStatus];

export const HypothecationStatus = {
  HYPOTHECATED: 'HYPOTHECATED',
  NOT_HYPOTHECATED: 'NOT_HYPOTHECATED',
  TERMINATED: 'TERMINATED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type HypothecationStatus = (typeof HypothecationStatus)[keyof typeof HypothecationStatus];

/** How a vehicle was matched to a financier. Drives trust level and review queues. */
export const FinancierMatchMethod = {
  VAHAN_HYPOTHECATION: 'VAHAN_HYPOTHECATION',
  VAHAN_ALIAS: 'VAHAN_ALIAS',
  MANUAL: 'MANUAL',
  FINANCIER_DECLARED: 'FINANCIER_DECLARED',
  UNMATCHED: 'UNMATCHED',
} as const;
export type FinancierMatchMethod = (typeof FinancierMatchMethod)[keyof typeof FinancierMatchMethod];

/* ------------------------------------------------------------------ */
/* ANPR                                                                */
/* ------------------------------------------------------------------ */

export const AnprEventStatus = {
  RECEIVED: 'RECEIVED',
  DUPLICATE: 'DUPLICATE',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PROCESSED: 'PROCESSED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;
export type AnprEventStatus = (typeof AnprEventStatus)[keyof typeof AnprEventStatus];

export const DeviceStatus = {
  ONLINE: 'ONLINE',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
  MAINTENANCE: 'MAINTENANCE',
  DECOMMISSIONED: 'DECOMMISSIONED',
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

/* ------------------------------------------------------------------ */
/* Integrations                                                        */
/* ------------------------------------------------------------------ */

export const IntegrationKind = {
  ANPR: 'ANPR',
  VEHICLE_REGISTRY: 'VEHICLE_REGISTRY',
  PAYMENT: 'PAYMENT',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
  OBJECT_STORAGE: 'OBJECT_STORAGE',
} as const;
export type IntegrationKind = (typeof IntegrationKind)[keyof typeof IntegrationKind];

export const IntegrationCallStatus = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  TIMEOUT: 'TIMEOUT',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  RATE_LIMITED: 'RATE_LIMITED',
  SKIPPED_CACHED: 'SKIPPED_CACHED',
} as const;
export type IntegrationCallStatus =
  (typeof IntegrationCallStatus)[keyof typeof IntegrationCallStatus];

export const LookupStatus = {
  QUEUED: 'QUEUED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  EXHAUSTED: 'EXHAUSTED',
  CANCELLED: 'CANCELLED',
} as const;
export type LookupStatus = (typeof LookupStatus)[keyof typeof LookupStatus];

/* ------------------------------------------------------------------ */
/* Contracts and rating                                                */
/* ------------------------------------------------------------------ */

export const ContractStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  EXPIRED: 'EXPIRED',
  TERMINATED: 'TERMINATED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];

export const ContractVersionStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  CANCELLED: 'CANCELLED',
} as const;
export type ContractVersionStatus =
  (typeof ContractVersionStatus)[keyof typeof ContractVersionStatus];

/** The unit in which a rate plan measures a stay. */
export const BillingUnit = {
  MINUTE: 'MINUTE',
  HOUR: 'HOUR',
  /** Elapsed 24-hour periods from the entry instant. */
  DAY: 'DAY',
  /** Distinct calendar dates in the site timezone; entry day counts as day 1. */
  CALENDAR_DAY: 'CALENDAR_DAY',
  WEEK: 'WEEK',
  MONTH: 'MONTH',
} as const;
export type BillingUnit = (typeof BillingUnit)[keyof typeof BillingUnit];

/** How a partial billing unit is treated. */
export const RoundingMode = {
  /** Any started unit is charged in full (most common for daily yard parking). */
  CEIL: 'CEIL',
  /** Only completed units are charged. */
  FLOOR: 'FLOOR',
  /** Half a unit or more rounds up. */
  NEAREST: 'NEAREST',
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/**
 * Whether free units are consumed from the front of the slab ladder.
 *
 * CONSUME_LADDER - free days occupy ladder positions 1..N, so the first
 *                  chargeable day is priced at the day-(N+1) slab.
 * SKIP_LADDER    - free days are removed entirely, so the first chargeable
 *                  day is priced at the day-1 slab.
 *
 * ASSUMPTION / PROPOSED DESIGN: default CONSUME_LADDER. Confirm per contract with
 * Sri JP finance before go-live (docs/open-items.md OI-05).
 */
export const FreeUnitPolicy = {
  CONSUME_LADDER: 'CONSUME_LADDER',
  SKIP_LADDER: 'SKIP_LADDER',
} as const;
export type FreeUnitPolicy = (typeof FreeUnitPolicy)[keyof typeof FreeUnitPolicy];

/** Where a rate plan derives its authority from. */
export const RatePlanScope = {
  /** Negotiated with a financier; applies to repossession yard stays. */
  CONTRACT: 'CONTRACT',
  /** Published tariff for a public parking site (Phase 2). */
  SITE_TARIFF: 'SITE_TARIFF',
} as const;
export type RatePlanScope = (typeof RatePlanScope)[keyof typeof RatePlanScope];

export const RateSlabKind = {
  /** amount is charged for every unit falling inside the slab. */
  PER_UNIT: 'PER_UNIT',
  /** amount is charged once if any unit falls inside the slab. */
  FLAT: 'FLAT',
} as const;
export type RateSlabKind = (typeof RateSlabKind)[keyof typeof RateSlabKind];

export const RatePlanStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type RatePlanStatus = (typeof RatePlanStatus)[keyof typeof RatePlanStatus];

/* ------------------------------------------------------------------ */
/* Parking sessions and charges                                        */
/* ------------------------------------------------------------------ */

export const ParkingSessionStatus = {
  OPEN: 'OPEN',
  ON_HOLD: 'ON_HOLD',
  PENDING_EXIT: 'PENDING_EXIT',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type ParkingSessionStatus = (typeof ParkingSessionStatus)[keyof typeof ParkingSessionStatus];

export const ChargeCalculationType = {
  /** Non-binding "cost as of now" figure. Never invoiced. */
  ESTIMATE: 'ESTIMATE',
  /** Nightly accrual snapshot used for ageing and revenue recognition. */
  ACCRUAL: 'ACCRUAL',
  /** Immutable calculation attached to an invoice at exit or settlement. */
  FINAL: 'FINAL',
} as const;
export type ChargeCalculationType =
  (typeof ChargeCalculationType)[keyof typeof ChargeCalculationType];

export const ChargeLineKind = {
  SLAB: 'SLAB',
  FREE_ALLOWANCE: 'FREE_ALLOWANCE',
  GRACE: 'GRACE',
  MINIMUM_CHARGE: 'MINIMUM_CHARGE',
  DAILY_CAP_ADJUSTMENT: 'DAILY_CAP_ADJUSTMENT',
  TAX: 'TAX',
} as const;
export type ChargeLineKind = (typeof ChargeLineKind)[keyof typeof ChargeLineKind];

/* ------------------------------------------------------------------ */
/* Billing, invoicing and payment                                      */
/* ------------------------------------------------------------------ */

/**
 * Who receives the invoice for a stay. The decision matrix itself is an
 * unresolved business item (docs/open-items.md OI-06) and is therefore held in
 * configurable `BillingRule` rows, never in code.
 */
export const BillingPartyType = {
  FINANCIER: 'FINANCIER',
  CUSTOMER: 'CUSTOMER',
  BIDDER: 'BIDDER',
  OTHER: 'OTHER',
} as const;
export type BillingPartyType = (typeof BillingPartyType)[keyof typeof BillingPartyType];

/**
 * Scope a billing rule is written at. Evaluated most-specific first, so a rule
 * attached to one contract version always beats a general one.
 */
export const BillingRuleScope = {
  GLOBAL: 'GLOBAL',
  SITE: 'SITE',
  FINANCIER: 'FINANCIER',
  CONTRACT_VERSION: 'CONTRACT_VERSION',
} as const;
export type BillingRuleScope = (typeof BillingRuleScope)[keyof typeof BillingRuleScope];

export const InvoiceType = {
  PARKING: 'PARKING',
  SALE: 'SALE',
  CREDIT_NOTE: 'CREDIT_NOTE',
} as const;
export type InvoiceType = (typeof InvoiceType)[keyof typeof InvoiceType];

export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  GENERATED: 'GENERATED',
  VALIDATED: 'VALIDATED',
  ISSUED: 'ISSUED',
  SENT: 'SENT',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  VOID: 'VOID',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PaymentStatus = {
  INITIATED: 'INITIATED',
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = {
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  NET_BANKING: 'NET_BANKING',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CHEQUE: 'CHEQUE',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const TaxComponentKind = {
  PERCENTAGE: 'PERCENTAGE',
  FIXED: 'FIXED',
} as const;
export type TaxComponentKind = (typeof TaxComponentKind)[keyof typeof TaxComponentKind];

/* ------------------------------------------------------------------ */
/* Release                                                             */
/* ------------------------------------------------------------------ */

export const ReleaseRequestStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  ELIGIBILITY_FAILED: 'ELIGIBILITY_FAILED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReleaseRequestStatus = (typeof ReleaseRequestStatus)[keyof typeof ReleaseRequestStatus];

export const ApprovalDecision = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

/* ------------------------------------------------------------------ */
/* Auction                                                             */
/* ------------------------------------------------------------------ */

export const AuctionStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  PUBLISHED: 'PUBLISHED',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  WINNER_SELECTED: 'WINNER_SELECTED',
  SETTLEMENT_PENDING: 'SETTLEMENT_PENDING',
  SETTLED: 'SETTLED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type AuctionStatus = (typeof AuctionStatus)[keyof typeof AuctionStatus];

export const AuctionLotStatus = {
  DRAFT: 'DRAFT',
  LISTED: 'LISTED',
  BIDDING_OPEN: 'BIDDING_OPEN',
  BIDDING_CLOSED: 'BIDDING_CLOSED',
  WINNER_SELECTED: 'WINNER_SELECTED',
  UNSOLD: 'UNSOLD',
  SETTLEMENT_PENDING: 'SETTLEMENT_PENDING',
  SETTLED: 'SETTLED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type AuctionLotStatus = (typeof AuctionLotStatus)[keyof typeof AuctionLotStatus];

export const BidderStatus = {
  REGISTERED: 'REGISTERED',
  KYC_PENDING: 'KYC_PENDING',
  APPROVED: 'APPROVED',
  SUSPENDED: 'SUSPENDED',
  BLACKLISTED: 'BLACKLISTED',
} as const;
export type BidderStatus = (typeof BidderStatus)[keyof typeof BidderStatus];

export const AuctionRegistrationStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type AuctionRegistrationStatus =
  (typeof AuctionRegistrationStatus)[keyof typeof AuctionRegistrationStatus];

/**
 * Bid status. The amount, bidder and placement time of a bid are immutable and
 * protected by a database trigger; only this status field may advance.
 */
export const BidStatus = {
  ACCEPTED: 'ACCEPTED',
  OUTBID: 'OUTBID',
  WINNING: 'WINNING',
  WON: 'WON',
  LOST: 'LOST',
  RETRACTED: 'RETRACTED',
} as const;
export type BidStatus = (typeof BidStatus)[keyof typeof BidStatus];

export const SettlementStatus = {
  PENDING: 'PENDING',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  DEFAULTED: 'DEFAULTED',
  CANCELLED: 'CANCELLED',
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

/* ------------------------------------------------------------------ */
/* Notification                                                        */
/* ------------------------------------------------------------------ */

export const NotificationChannel = {
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  SUPPRESSED: 'SUPPRESSED',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export const DocumentKind = {
  ANPR_CAPTURE: 'ANPR_CAPTURE',
  VEHICLE_PHOTO: 'VEHICLE_PHOTO',
  INVOICE_PDF: 'INVOICE_PDF',
  AUCTION_DOCUMENT: 'AUCTION_DOCUMENT',
  RELEASE_DOCUMENT: 'RELEASE_DOCUMENT',
  FINANCIER_DOCUMENT: 'FINANCIER_DOCUMENT',
  BIDDER_KYC: 'BIDDER_KYC',
  OTHER: 'OTHER',
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

export const ScanStatus = {
  PENDING: 'PENDING',
  CLEAN: 'CLEAN',
  INFECTED: 'INFECTED',
  SKIPPED: 'SKIPPED',
  ERROR: 'ERROR',
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

/* ------------------------------------------------------------------ */
/* Platform                                                            */
/* ------------------------------------------------------------------ */

export const UserStatus = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  LOCKED: 'LOCKED',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ActorType = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
  DEVICE: 'DEVICE',
  INTEGRATION: 'INTEGRATION',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export const OutboxStatus = {
  PENDING: 'PENDING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export const JobRunStatus = {
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type JobRunStatus = (typeof JobRunStatus)[keyof typeof JobRunStatus];

export const SettingScope = {
  GLOBAL: 'GLOBAL',
  SITE: 'SITE',
} as const;
export type SettingScope = (typeof SettingScope)[keyof typeof SettingScope];

export const SettingDataType = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  JSON: 'JSON',
  DURATION_MINUTES: 'DURATION_MINUTES',
} as const;
export type SettingDataType = (typeof SettingDataType)[keyof typeof SettingDataType];

/** Timeline event types. Append-only; drives the vehicle history view. */
export const TimelineEventType = {
  ANPR_CAPTURED: 'ANPR_CAPTURED',
  ANPR_REVIEW_REQUIRED: 'ANPR_REVIEW_REQUIRED',
  ANPR_MANUALLY_RESOLVED: 'ANPR_MANUALLY_RESOLVED',
  VEHICLE_CREATED: 'VEHICLE_CREATED',
  VEHICLE_STATUS_CHANGED: 'VEHICLE_STATUS_CHANGED',
  VAHAN_LOOKUP_REQUESTED: 'VAHAN_LOOKUP_REQUESTED',
  VAHAN_LOOKUP_SUCCEEDED: 'VAHAN_LOOKUP_SUCCEEDED',
  VAHAN_LOOKUP_FAILED: 'VAHAN_LOOKUP_FAILED',
  OWNERSHIP_UPDATED: 'OWNERSHIP_UPDATED',
  FINANCIER_MATCHED: 'FINANCIER_MATCHED',
  CONTRACT_RESOLVED: 'CONTRACT_RESOLVED',
  SESSION_OPENED: 'SESSION_OPENED',
  SPACE_ALLOCATED: 'SPACE_ALLOCATED',
  SPACE_CHANGED: 'SPACE_CHANGED',
  HOLD_PLACED: 'HOLD_PLACED',
  HOLD_LIFTED: 'HOLD_LIFTED',
  CHARGE_ACCRUED: 'CHARGE_ACCRUED',
  RELEASE_REQUESTED: 'RELEASE_REQUESTED',
  RELEASE_APPROVED: 'RELEASE_APPROVED',
  RELEASE_REJECTED: 'RELEASE_REJECTED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  INVOICE_ISSUED: 'INVOICE_ISSUED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  SESSION_CLOSED: 'SESSION_CLOSED',
  VEHICLE_EXITED: 'VEHICLE_EXITED',
  AUCTION_LISTED: 'AUCTION_LISTED',
  BIDDING_OPENED: 'BIDDING_OPENED',
  BID_PLACED: 'BID_PLACED',
  BIDDING_CLOSED: 'BIDDING_CLOSED',
  AUCTION_WINNER_SELECTED: 'AUCTION_WINNER_SELECTED',
  AUCTION_SETTLED: 'AUCTION_SETTLED',
  VEHICLE_SOLD: 'VEHICLE_SOLD',
} as const;
export type TimelineEventType = (typeof TimelineEventType)[keyof typeof TimelineEventType];
