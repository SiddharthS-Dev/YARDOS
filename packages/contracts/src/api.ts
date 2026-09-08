/**
 * Cross-cutting API contract shapes: pagination, sorting, money and the
 * explainable charge-breakdown payload.
 *
 * Money rule for the whole platform: amounts cross the wire as decimal STRINGS
 * (e.g. "1234.5000"), never as JavaScript numbers. IEEE-754 doubles cannot
 * represent currency exactly, and an invoice that is off by a paisa is a defect.
 * The API stores NUMERIC(18,4) in PostgreSQL and computes with decimal.js.
 */

/** A monetary amount. `amount` is a decimal string; `currency` is ISO-4217. */
export interface Money {
  amount: string;
  currency: string;
}

export const DEFAULT_CURRENCY = 'INR';

/** Query parameters accepted by every collection endpoint. */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

/** The envelope returned by every collection endpoint. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function emptyPage<T>(pageSize: number = DEFAULT_PAGE_SIZE): Paginated<T> {
  return {
    items: [],
    page: 1,
    pageSize,
    totalItems: 0,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false,
  };
}

/* ------------------------------------------------------------------ */
/* Charge breakdown                                                    */
/* ------------------------------------------------------------------ */

/**
 * One explained line of a charge calculation.
 *
 * Requirement S14: never store only a final number. Every line records the slab
 * it came from, the units it consumed and the rate applied, so any invoice can
 * be re-derived and defended to a financier years later.
 */
export interface ChargeBreakdownLine {
  lineNo: number;
  kind: string;
  description: string;
  /** Inclusive ladder position where this line starts (1-based). */
  fromUnit: number | null;
  /** Inclusive ladder position where this line ends. */
  toUnit: number | null;
  /** Units consumed by this line. Decimal string. */
  units: string;
  /** Rate applied per unit, or the flat amount. Decimal string. */
  unitAmount: string;
  /** Line total. Decimal string. */
  amount: string;
}

/** The full, reproducible result of one charge calculation. */
export interface ChargeBreakdown {
  /** Version of the calculation algorithm. Bumped on any behaviour change. */
  engineVersion: string;
  currency: string;
  billingUnit: string;
  roundingMode: string;
  freeUnitPolicy: string;

  entryAt: string;
  asOf: string;
  /** Site-local IANA timezone the calendar arithmetic was performed in. */
  timezone: string;

  rawDurationMinutes: number;
  graceMinutes: number;
  /** Units before the free allowance is deducted. */
  totalUnits: string;
  freeUnits: string;
  /** Units actually charged. */
  chargeableUnits: string;

  lines: ChargeBreakdownLine[];
  taxLines: ChargeBreakdownLine[];

  subtotal: string;
  taxTotal: string;
  total: string;

  /** Human-readable narrative, rendered on invoices and in the console. */
  explanation: string[];

  /** Stable hash of all inputs; identical inputs must give an identical hash. */
  inputsHash: string;
  ratePlanId: string;
  ratePlanName: string;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export interface AuthenticatedUserProfile {
  id: string;
  email: string;
  fullName: string;
  status: string;
  organizationId: string;
  organizationName: string;
  /** null for Sri JP staff; set for financier-portal users. */
  financierId: string | null;
  financierName: string | null;
  roles: string[];
  permissions: string[];
  /** Empty when the user holds `site:access:all`. */
  siteIds: string[];
  allSiteAccess: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  tokenType: 'Bearer';
  user: AuthenticatedUserProfile;
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

export interface HealthComponent {
  name: string;
  status: 'up' | 'down' | 'degraded';
  detail?: string;
  latencyMs?: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptimeSeconds: number;
  components: HealthComponent[];
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/* Headers                                                             */
/* ------------------------------------------------------------------ */

export const HEADER_CORRELATION_ID = 'x-correlation-id';
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';
export const HEADER_ANPR_SIGNATURE = 'x-anpr-signature';
export const HEADER_ANPR_TIMESTAMP = 'x-anpr-timestamp';
export const HEADER_PAYMENT_SIGNATURE = 'x-payment-signature';
