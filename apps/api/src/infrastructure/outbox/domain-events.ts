/**
 * The internal domain event catalogue.
 *
 * Events are the seam between modules. When a vehicle is admitted, the parking
 * module does not call the registry module, the notification module and the
 * audit module: it records one fact, and whoever cares reacts. That is what
 * keeps the modules independently extractable into services later (S4).
 *
 * Every event is written to the `outbox_events` table inside the same
 * transaction as the state change that produced it, then relayed
 * asynchronously. So an event can never describe something that did not happen,
 * and a state change can never fail to produce its event.
 */

export const DomainEventType = {
  /* --- ANPR / gate ---------------------------------------------- */
  ANPR_EVENT_RECEIVED: 'anpr.event.received',
  ANPR_EVENT_NEEDS_REVIEW: 'anpr.event.needs_review',
  ANPR_EVENT_RESOLVED: 'anpr.event.resolved',

  /* --- Vehicle -------------------------------------------------- */
  VEHICLE_CREATED: 'vehicle.created',
  VEHICLE_STATUS_CHANGED: 'vehicle.status_changed',
  VEHICLE_OWNERSHIP_UPDATED: 'vehicle.ownership_updated',
  VEHICLE_FINANCIER_MATCHED: 'vehicle.financier_matched',
  VEHICLE_REGISTRY_ENRICHMENT_REQUESTED: 'vehicle.registry_enrichment_requested',
  VEHICLE_REGISTRY_ENRICHMENT_FAILED: 'vehicle.registry_enrichment_failed',

  /* --- Parking -------------------------------------------------- */
  SESSION_OPENED: 'parking.session.opened',
  SESSION_ALLOCATED: 'parking.session.allocated',
  SESSION_HELD: 'parking.session.held',
  SESSION_HOLD_LIFTED: 'parking.session.hold_lifted',
  SESSION_CLOSED: 'parking.session.closed',
  SESSION_RATE_UNRESOLVED: 'parking.session.rate_unresolved',

  /* --- Charges & billing ---------------------------------------- */
  CHARGE_ACCRUED: 'billing.charge.accrued',
  CHARGE_FINALISED: 'billing.charge.finalised',

  /* --- Invoicing ------------------------------------------------ */
  INVOICE_GENERATED: 'invoice.generated',
  INVOICE_ISSUED: 'invoice.issued',
  INVOICE_SENT: 'invoice.sent',
  INVOICE_VOIDED: 'invoice.voided',
  INVOICE_PAID: 'invoice.paid',
  PAYMENT_RECORDED: 'payment.recorded',

  /* --- Release -------------------------------------------------- */
  RELEASE_REQUESTED: 'release.requested',
  RELEASE_APPROVED: 'release.approved',
  RELEASE_REJECTED: 'release.rejected',
  RELEASE_COMPLETED: 'release.completed',

  /* --- Auction -------------------------------------------------- */
  AUCTION_PUBLISHED: 'auction.published',
  AUCTION_OPENED: 'auction.opened',
  AUCTION_CLOSED: 'auction.closed',
  LOT_LISTED: 'auction.lot.listed',
  BID_PLACED: 'auction.bid.placed',
  WINNER_SELECTED: 'auction.winner.selected',
  SETTLEMENT_CREATED: 'auction.settlement.created',
  SETTLEMENT_COMPLETED: 'auction.settlement.completed',

  /* --- Notification --------------------------------------------- */
  NOTIFICATION_QUEUED: 'notification.queued',
} as const;
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

/** Envelope every event travels in. */
export interface DomainEvent<T = Record<string, unknown>> {
  eventType: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  payload: T;
  occurredAt: Date;
  correlationId: string;
}

/* ------------------------------------------------------------------ */
/* Payload shapes                                                      */
/* ------------------------------------------------------------------ */

export interface AnprEventReceivedPayload {
  anprEventId: string;
  organizationId: string;
  siteId: string;
  deviceId: string;
  normalizedPlate: string;
  confidence: string;
  direction: string;
  capturedAt: string;
}

export interface VehicleCreatedPayload {
  vehicleId: string;
  organizationId: string;
  normalizedRegistrationNumber: string;
}

export interface VehicleStatusChangedPayload {
  vehicleId: string;
  organizationId: string;
  from: string;
  to: string;
  reason?: string;
}

export interface RegistryEnrichmentRequestedPayload {
  lookupId: string;
  vehicleId: string;
  normalizedRegistrationNumber: string;
  organizationId: string;
}

export interface SessionOpenedPayload {
  sessionId: string;
  organizationId: string;
  siteId: string;
  vehicleId: string;
  financierId: string | null;
  ratePlanId: string | null;
  parkingMode: string;
  entryAt: string;
}

export interface SessionClosedPayload {
  sessionId: string;
  organizationId: string;
  siteId: string;
  vehicleId: string;
  exitAt: string;
  chargeCalculationId: string | null;
  invoiceId: string | null;
}

export interface ChargeAccruedPayload {
  sessionId: string;
  calculationId: string;
  organizationId: string;
  total: string;
  currency: string;
  chargeableUnits: string;
  asOf: string;
}

export interface InvoiceGeneratedPayload {
  invoiceId: string;
  invoiceNumber: string;
  organizationId: string;
  siteId: string;
  billingPartyType: string;
  financierId: string | null;
  total: string;
  currency: string;
  sessionId: string | null;
  vehicleId: string | null;
}

export interface InvoiceIssuedPayload extends InvoiceGeneratedPayload {
  issuedAt: string;
  dueDate: string | null;
}

export interface PaymentRecordedPayload {
  paymentId: string;
  invoiceId: string;
  organizationId: string;
  amount: string;
  currency: string;
  method: string;
  invoiceStatusAfter: string;
}

export interface ReleaseEventPayload {
  releaseRequestId: string;
  requestNumber: string;
  organizationId: string;
  siteId: string;
  sessionId: string;
  vehicleId: string;
  status: string;
  actorId?: string;
}

export interface BidPlacedPayload {
  bidId: string;
  lotId: string;
  auctionId: string;
  bidderId: string;
  organizationId: string;
  amount: string;
  currency: string;
  sequenceNo: number;
  placedAt: string;
}

export interface WinnerSelectedPayload {
  lotId: string;
  auctionId: string;
  organizationId: string;
  vehicleId: string;
  bidderId: string;
  winningBidId: string;
  amount: string;
  currency: string;
}

export interface SettlementPayload {
  settlementId: string;
  lotId: string;
  auctionId: string;
  organizationId: string;
  bidderId: string;
  totalPayable: string;
  amountReceived: string;
  status: string;
}

export interface NotificationQueuedPayload {
  notificationId: string;
  organizationId: string;
  channel: string;
  templateCode: string;
}
