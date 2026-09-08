import {
  BillingUnit,
  FreeUnitPolicy,
  RateSlabKind,
  RoundingMode,
  TaxComponentKind,
} from '@smartpark/contracts';

/**
 * A frozen copy of everything the charge engine needs to price a stay.
 *
 * Why a snapshot rather than a live read: a stay can last months, and a
 * contract can be renegotiated while a vehicle is still in the yard. Pricing a
 * parked vehicle from today's rate card would silently re-price history and
 * make an already-issued invoice unreproducible.
 *
 * The snapshot is taken at admission, stored on `parking_sessions`, copied onto
 * every `charge_calculations` row, and is the only input the engine ever reads.
 * Amounts are decimal STRINGS: the snapshot is persisted as JSON, and JSON
 * numbers are IEEE-754 doubles.
 */
export interface RateSlabSnapshot {
  id: string;
  sequence: number;
  /** Inclusive, 1-based ladder position where this slab starts. */
  fromUnit: string;
  /** Inclusive ladder position where it ends. `null` means open-ended. */
  toUnit: string | null;
  kind: RateSlabKind;
  amount: string;
  description?: string | null;
}

export interface TaxComponentSnapshot {
  sequence: number;
  code: string;
  name: string;
  kind: TaxComponentKind;
  /** Fraction, not a percentage: 9% is "0.090000". */
  rate: string;
  /** SUBTOTAL applies to the pre-tax total; RUNNING_TOTAL compounds. */
  base: 'SUBTOTAL' | 'RUNNING_TOTAL';
  hsnSac?: string | null;
}

export interface TaxProfileSnapshot {
  code: string;
  name: string;
  components: TaxComponentSnapshot[];
}

export interface RatePlanSnapshot {
  id: string;
  code: string;
  name: string;
  scope: string;
  billingUnit: BillingUnit;
  roundingMode: RoundingMode;
  /** Units granted at no charge, as a decimal string. */
  freeUnits: string;
  freeUnitPolicy: FreeUnitPolicy;
  graceMinutes: number;
  minimumChargeAmount?: string | null;
  dailyCapAmount?: string | null;
  currency: string;
  slabs: RateSlabSnapshot[];
  /** Absent means no tax is applied - which is a configuration decision. */
  taxProfile?: TaxProfileSnapshot | null;
  /** Captured for the audit trail; not used in the arithmetic. */
  capturedAt: string;
  contractVersionId?: string | null;
  siteId?: string | null;
}

/** Inputs to one charge calculation. */
export interface ChargeInput {
  entryAt: Date;
  /** Exit instant for a FINAL calculation; "now" for an accrual or estimate. */
  asOf: Date;
  /** IANA timezone of the SITE, never the server. Calendar maths depends on it. */
  timezone: string;
  ratePlan: RatePlanSnapshot;
}
