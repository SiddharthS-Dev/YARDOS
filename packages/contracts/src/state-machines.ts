/**
 * Explicit state machines for every lifecycle that carries business or financial
 * meaning.
 *
 * These tables are the single source of truth for "what may follow what". They
 * live in the shared package for two reasons:
 *   1. The API enforces them (the UI can never write a status directly).
 *   2. The console uses them to decide which actions to offer, so the UI never
 *      shows a button for a transition the server would reject.
 *
 * A transition table is a plain map from state -> allowed next states. An empty
 * array marks a terminal state.
 */

import {
  AuctionLotStatus,
  AuctionStatus,
  BidStatus,
  ContractVersionStatus,
  InvoiceStatus,
  ParkingSessionStatus,
  PaymentStatus,
  ReleaseRequestStatus,
  SettlementStatus,
  VehicleStatus,
} from './enums';

export type TransitionTable<T extends string> = Readonly<Record<T, readonly T[]>>;

/* ------------------------------------------------------------------ */
/* Vehicle                                                             */
/* ------------------------------------------------------------------ */

/**
 * Vehicle lifecycle.
 *
 * Two branches leave PARKED: the release branch (owner/financier reclaims the
 * vehicle) and the auction branch (vehicle is disposed of). Both converge on
 * EXITED, which is terminal.
 *
 * UNDER_HOLD is reachable from PARKED and returns to PARKED; it represents a
 * legal or financier hold that blocks release without ending the stay.
 */
export const VEHICLE_TRANSITIONS: TransitionTable<VehicleStatus> = {
  CAPTURED: [VehicleStatus.IDENTIFIED, VehicleStatus.EXITED],
  IDENTIFIED: [
    VehicleStatus.VAHAN_PENDING,
    VehicleStatus.VAHAN_VERIFIED,
    VehicleStatus.FINANCIER_MATCHED,
    // A public-parking vehicle needs no registry enrichment to be admitted.
    VehicleStatus.YARD_ADMITTED,
    VehicleStatus.EXITED,
  ],
  VAHAN_PENDING: [
    VehicleStatus.VAHAN_VERIFIED,
    VehicleStatus.VAHAN_FAILED,
    // Admission must never block on an external registry (requirement S9).
    VehicleStatus.YARD_ADMITTED,
    VehicleStatus.EXITED,
  ],
  VAHAN_VERIFIED: [
    VehicleStatus.FINANCIER_MATCHED,
    VehicleStatus.YARD_ADMITTED,
    VehicleStatus.EXITED,
  ],
  VAHAN_FAILED: [
    VehicleStatus.VAHAN_PENDING,
    VehicleStatus.VAHAN_VERIFIED,
    VehicleStatus.FINANCIER_MATCHED,
    VehicleStatus.YARD_ADMITTED,
    VehicleStatus.EXITED,
  ],
  FINANCIER_MATCHED: [
    VehicleStatus.YARD_ADMITTED,
    VehicleStatus.VAHAN_PENDING,
    VehicleStatus.EXITED,
  ],
  YARD_ADMITTED: [VehicleStatus.PARKED, VehicleStatus.EXITED],
  PARKED: [
    VehicleStatus.UNDER_HOLD,
    VehicleStatus.RELEASE_REQUESTED,
    VehicleStatus.AUCTION_ELIGIBLE,
    // Public parking and cash exits close without an approval workflow.
    VehicleStatus.EXITED,
  ],
  UNDER_HOLD: [VehicleStatus.PARKED, VehicleStatus.AUCTION_ELIGIBLE],
  RELEASE_REQUESTED: [
    VehicleStatus.RELEASE_APPROVED,
    // Rejected release returns the vehicle to the yard.
    VehicleStatus.PARKED,
  ],
  RELEASE_APPROVED: [VehicleStatus.EXITED, VehicleStatus.PARKED],
  AUCTION_ELIGIBLE: [VehicleStatus.AUCTION_LISTED, VehicleStatus.PARKED],
  AUCTION_LISTED: [VehicleStatus.BIDDING_OPEN, VehicleStatus.PARKED],
  BIDDING_OPEN: [VehicleStatus.BIDDING_CLOSED],
  // An auction that draws no eligible bid returns the vehicle to the yard.
  BIDDING_CLOSED: [VehicleStatus.WINNER_SELECTED, VehicleStatus.PARKED],
  WINNER_SELECTED: [VehicleStatus.SETTLEMENT_PENDING],
  // A defaulting winner sends the lot back for re-auction.
  SETTLEMENT_PENDING: [VehicleStatus.SETTLED, VehicleStatus.PARKED],
  SETTLED: [VehicleStatus.SOLD],
  SOLD: [VehicleStatus.EXITED],
  // EXITED ends a VISIT, not the vehicle record. The same vehicle can be
  // repossessed again, or drive into a public car park months later, and it
  // must resolve to the same canonical row - that is what makes the financier
  // intelligence service work. So a returning vehicle re-enters at CAPTURED
  // and walks the full path again; it can never jump straight back to PARKED.
  EXITED: [VehicleStatus.CAPTURED],
};

/* ------------------------------------------------------------------ */
/* Parking session                                                     */
/* ------------------------------------------------------------------ */

export const PARKING_SESSION_TRANSITIONS: TransitionTable<ParkingSessionStatus> = {
  OPEN: [
    ParkingSessionStatus.ON_HOLD,
    ParkingSessionStatus.PENDING_EXIT,
    ParkingSessionStatus.CLOSED,
    ParkingSessionStatus.CANCELLED,
  ],
  ON_HOLD: [ParkingSessionStatus.OPEN, ParkingSessionStatus.PENDING_EXIT],
  PENDING_EXIT: [ParkingSessionStatus.CLOSED, ParkingSessionStatus.OPEN],
  CLOSED: [],
  CANCELLED: [],
};

/* ------------------------------------------------------------------ */
/* Invoice                                                             */
/* ------------------------------------------------------------------ */

/**
 * Invoice lifecycle.
 *
 * Once ISSUED an invoice is a financial record: it can never return to a
 * pre-issue state, and it can only be reversed by CANCELLED/VOID (which require
 * a reason and, for VOID, a credit note).
 */
export const INVOICE_TRANSITIONS: TransitionTable<InvoiceStatus> = {
  DRAFT: [InvoiceStatus.GENERATED, InvoiceStatus.CANCELLED],
  GENERATED: [InvoiceStatus.VALIDATED, InvoiceStatus.CANCELLED],
  VALIDATED: [InvoiceStatus.ISSUED, InvoiceStatus.CANCELLED],
  ISSUED: [
    InvoiceStatus.SENT,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.PAID,
    InvoiceStatus.VOID,
  ],
  SENT: [InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID, InvoiceStatus.VOID],
  PARTIALLY_PAID: [InvoiceStatus.PAID, InvoiceStatus.VOID],
  PAID: [InvoiceStatus.VOID],
  CANCELLED: [],
  VOID: [],
};

/** Statuses at which an invoice is a committed financial record. */
export const ISSUED_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
];

/** Statuses at which an invoice can still receive a payment. */
export const PAYABLE_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
];

/* ------------------------------------------------------------------ */
/* Payment                                                             */
/* ------------------------------------------------------------------ */

export const PAYMENT_TRANSITIONS: TransitionTable<PaymentStatus> = {
  INITIATED: [
    PaymentStatus.PENDING,
    PaymentStatus.SUCCESS,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  PENDING: [PaymentStatus.SUCCESS, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  SUCCESS: [PaymentStatus.REFUNDED],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/* ------------------------------------------------------------------ */
/* Release request                                                     */
/* ------------------------------------------------------------------ */

export const RELEASE_TRANSITIONS: TransitionTable<ReleaseRequestStatus> = {
  DRAFT: [ReleaseRequestStatus.SUBMITTED, ReleaseRequestStatus.CANCELLED],
  SUBMITTED: [
    ReleaseRequestStatus.ELIGIBILITY_FAILED,
    ReleaseRequestStatus.AWAITING_PAYMENT,
    ReleaseRequestStatus.AWAITING_APPROVAL,
    ReleaseRequestStatus.CANCELLED,
  ],
  // Eligibility can be re-run after the blocking condition is cleared.
  ELIGIBILITY_FAILED: [ReleaseRequestStatus.SUBMITTED, ReleaseRequestStatus.CANCELLED],
  AWAITING_PAYMENT: [ReleaseRequestStatus.AWAITING_APPROVAL, ReleaseRequestStatus.CANCELLED],
  AWAITING_APPROVAL: [
    ReleaseRequestStatus.APPROVED,
    ReleaseRequestStatus.REJECTED,
    ReleaseRequestStatus.CANCELLED,
  ],
  // COMPLETED is reached only by a physical gate exit being recorded.
  APPROVED: [ReleaseRequestStatus.COMPLETED, ReleaseRequestStatus.CANCELLED],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

/* ------------------------------------------------------------------ */
/* Auction                                                             */
/* ------------------------------------------------------------------ */

export const AUCTION_TRANSITIONS: TransitionTable<AuctionStatus> = {
  DRAFT: [AuctionStatus.SCHEDULED, AuctionStatus.CANCELLED],
  SCHEDULED: [AuctionStatus.PUBLISHED, AuctionStatus.DRAFT, AuctionStatus.CANCELLED],
  PUBLISHED: [AuctionStatus.OPEN, AuctionStatus.CANCELLED],
  OPEN: [AuctionStatus.CLOSED],
  CLOSED: [AuctionStatus.WINNER_SELECTED, AuctionStatus.CANCELLED],
  WINNER_SELECTED: [AuctionStatus.SETTLEMENT_PENDING],
  SETTLEMENT_PENDING: [AuctionStatus.SETTLED],
  SETTLED: [AuctionStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

export const AUCTION_LOT_TRANSITIONS: TransitionTable<AuctionLotStatus> = {
  DRAFT: [AuctionLotStatus.LISTED, AuctionLotStatus.WITHDRAWN],
  LISTED: [AuctionLotStatus.BIDDING_OPEN, AuctionLotStatus.WITHDRAWN],
  BIDDING_OPEN: [AuctionLotStatus.BIDDING_CLOSED],
  BIDDING_CLOSED: [AuctionLotStatus.WINNER_SELECTED, AuctionLotStatus.UNSOLD],
  WINNER_SELECTED: [AuctionLotStatus.SETTLEMENT_PENDING],
  // A defaulting winner puts the lot back on the shelf as UNSOLD.
  SETTLEMENT_PENDING: [AuctionLotStatus.SETTLED, AuctionLotStatus.UNSOLD],
  SETTLED: [],
  UNSOLD: [AuctionLotStatus.LISTED],
  WITHDRAWN: [],
};

/**
 * Bid status transitions.
 *
 * Note this governs only the `status` column. A bid's amount, bidder and
 * placement timestamp are immutable and enforced by a database trigger
 * (see migration `20250101000100_immutability_guards`).
 */
export const BID_TRANSITIONS: TransitionTable<BidStatus> = {
  ACCEPTED: [BidStatus.OUTBID, BidStatus.WINNING, BidStatus.LOST, BidStatus.RETRACTED],
  OUTBID: [BidStatus.LOST, BidStatus.WINNING],
  WINNING: [BidStatus.WON, BidStatus.OUTBID, BidStatus.LOST],
  WON: [],
  LOST: [],
  RETRACTED: [],
};

export const SETTLEMENT_TRANSITIONS: TransitionTable<SettlementStatus> = {
  PENDING: [
    SettlementStatus.PARTIALLY_RECEIVED,
    SettlementStatus.RECEIVED,
    SettlementStatus.DEFAULTED,
    SettlementStatus.CANCELLED,
  ],
  PARTIALLY_RECEIVED: [SettlementStatus.RECEIVED, SettlementStatus.DEFAULTED],
  RECEIVED: [],
  DEFAULTED: [],
  CANCELLED: [],
};

/* ------------------------------------------------------------------ */
/* Contract version                                                    */
/* ------------------------------------------------------------------ */

export const CONTRACT_VERSION_TRANSITIONS: TransitionTable<ContractVersionStatus> = {
  DRAFT: [ContractVersionStatus.PENDING_APPROVAL, ContractVersionStatus.CANCELLED],
  PENDING_APPROVAL: [
    ContractVersionStatus.ACTIVE,
    ContractVersionStatus.DRAFT,
    ContractVersionStatus.CANCELLED,
  ],
  ACTIVE: [ContractVersionStatus.SUPERSEDED],
  SUPERSEDED: [],
  CANCELLED: [],
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function canTransition<T extends string>(
  table: TransitionTable<T>,
  from: T,
  to: T,
): boolean {
  const allowed = table[from];
  return Array.isArray(allowed) && (allowed as readonly T[]).includes(to);
}

export function allowedTransitions<T extends string>(
  table: TransitionTable<T>,
  from: T,
): readonly T[] {
  return table[from] ?? [];
}

export function isTerminal<T extends string>(table: TransitionTable<T>, state: T): boolean {
  return (table[state] ?? []).length === 0;
}

/**
 * Vehicle statuses that mean "physically present at a Sri JP location".
 * Used by occupancy KPIs and by the release-eligibility check.
 */
export const ON_SITE_VEHICLE_STATUSES: readonly VehicleStatus[] = [
  VehicleStatus.YARD_ADMITTED,
  VehicleStatus.PARKED,
  VehicleStatus.UNDER_HOLD,
  VehicleStatus.RELEASE_REQUESTED,
  VehicleStatus.RELEASE_APPROVED,
  VehicleStatus.AUCTION_ELIGIBLE,
  VehicleStatus.AUCTION_LISTED,
  VehicleStatus.BIDDING_OPEN,
  VehicleStatus.BIDDING_CLOSED,
  VehicleStatus.WINNER_SELECTED,
  VehicleStatus.SETTLEMENT_PENDING,
  VehicleStatus.SETTLED,
  VehicleStatus.SOLD,
];

/** Vehicle statuses in which the vehicle is committed to an auction process. */
export const IN_AUCTION_VEHICLE_STATUSES: readonly VehicleStatus[] = [
  VehicleStatus.AUCTION_LISTED,
  VehicleStatus.BIDDING_OPEN,
  VehicleStatus.BIDDING_CLOSED,
  VehicleStatus.WINNER_SELECTED,
  VehicleStatus.SETTLEMENT_PENDING,
  VehicleStatus.SETTLED,
];
