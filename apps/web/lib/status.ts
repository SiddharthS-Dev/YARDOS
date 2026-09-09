import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Clock,
  Flame,
  Play,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

/**
 * The semantic status vocabulary.
 *
 * Every domain status in the platform - and there are dozens, across sessions,
 * invoices, payments, releases, auctions, bids, registry lookups and financier
 * matching - resolves to one of nine meanings. That single mapping is why
 * `PAID`, `SETTLED`, `MATCHED` and `COMPLETED` cannot drift apart visually as
 * new screens are written.
 *
 * Each meaning carries a colour, an ICON and a WORD. Colour alone would fail
 * for a colour-blind operator, in greyscale, and on a sun-washed gate screen -
 * so it is never the only signal.
 */
export type StatusKind =
  | 'SUCCESS'
  | 'ACTIVE'
  | 'PENDING'
  | 'WARNING'
  | 'CRITICAL'
  | 'BLOCKED'
  | 'EXPIRED'
  | 'COMPLETED'
  | 'UNKNOWN';

export interface StatusVisual {
  kind: StatusKind;
  icon: LucideIcon;
  /** Tailwind classes for a filled badge. */
  badge: string;
  /** Tailwind class for standalone text or an icon. */
  text: string;
  /** Tailwind class for a dot or bar fill. */
  fill: string;
}

export const STATUS_VISUALS: Record<StatusKind, StatusVisual> = {
  SUCCESS: {
    kind: 'SUCCESS',
    icon: CheckCircle2,
    badge: 'bg-primary-soft text-primary-strong ring-1 ring-inset ring-primary/25',
    text: 'text-primary-strong',
    fill: 'bg-primary',
  },
  ACTIVE: {
    kind: 'ACTIVE',
    icon: Play,
    badge: 'bg-primary-soft text-primary-strong ring-1 ring-inset ring-primary/25',
    text: 'text-primary-strong',
    fill: 'bg-primary',
  },
  PENDING: {
    kind: 'PENDING',
    icon: Clock,
    badge: 'bg-blue-soft text-blue-strong ring-1 ring-inset ring-blue/25',
    text: 'text-blue-strong',
    fill: 'bg-blue',
  },
  WARNING: {
    kind: 'WARNING',
    icon: AlertTriangle,
    badge: 'bg-amber-soft text-amber-strong ring-1 ring-inset ring-amber/30',
    text: 'text-amber-strong',
    fill: 'bg-amber',
  },
  CRITICAL: {
    kind: 'CRITICAL',
    icon: Flame,
    badge: 'bg-danger-soft text-danger-strong ring-1 ring-inset ring-danger/30',
    text: 'text-danger-strong',
    fill: 'bg-danger',
  },
  BLOCKED: {
    kind: 'BLOCKED',
    icon: Ban,
    badge: 'bg-slate-soft text-slate-strong ring-1 ring-inset ring-slate/25',
    text: 'text-slate-strong',
    fill: 'bg-slate',
  },
  EXPIRED: {
    kind: 'EXPIRED',
    icon: XCircle,
    badge: 'bg-slate-soft text-slate-strong ring-1 ring-inset ring-slate/25',
    text: 'text-slate-strong',
    fill: 'bg-slate',
  },
  COMPLETED: {
    kind: 'COMPLETED',
    icon: CheckCircle2,
    badge: 'bg-slate-soft text-slate-strong ring-1 ring-inset ring-slate/25',
    text: 'text-slate-strong',
    fill: 'bg-slate',
  },
  UNKNOWN: {
    kind: 'UNKNOWN',
    icon: CircleHelp,
    badge: 'bg-slate-soft text-slate-strong ring-1 ring-inset ring-slate/25',
    text: 'text-ink-3',
    fill: 'bg-slate',
  },
};

/**
 * Domain status → meaning.
 *
 * Grouped by the module the status comes from, so adding one is obvious. An
 * unrecognised status resolves to UNKNOWN rather than being silently coloured
 * as success - an unmapped state must look unmapped.
 */
const STATUS_MAP: Record<string, StatusKind> = {
  /* --- Parking session / visit ------------------------------------- */
  OPEN: 'ACTIVE',
  ON_HOLD: 'BLOCKED',
  CLOSED: 'COMPLETED',
  CANCELLED: 'EXPIRED',

  /* --- Vehicle ------------------------------------------------------ */
  IN_YARD: 'ACTIVE',
  EXITED: 'COMPLETED',
  SOLD: 'COMPLETED',
  EXPECTED: 'PENDING',
  UNKNOWN: 'UNKNOWN',

  /* --- Registry ----------------------------------------------------- */
  VERIFIED: 'SUCCESS',
  MANUALLY_VERIFIED: 'SUCCESS',
  NOT_REQUESTED: 'UNKNOWN',
  UNAVAILABLE: 'WARNING',
  FAILED: 'CRITICAL',

  /* --- Financier matching ------------------------------------------- */
  MATCHED: 'SUCCESS',
  UNMATCHED: 'WARNING',
  AMBIGUOUS: 'WARNING',

  /* --- Invoice ------------------------------------------------------ */
  DRAFT: 'PENDING',
  ISSUED: 'ACTIVE',
  PARTIALLY_PAID: 'WARNING',
  PAID: 'SUCCESS',
  VOID: 'EXPIRED',
  OVERDUE: 'CRITICAL',

  /* --- Payment ------------------------------------------------------ */
  INITIATED: 'PENDING',
  SUCCESS: 'SUCCESS',
  REFUNDED: 'COMPLETED',

  /* --- Release ------------------------------------------------------ */
  SUBMITTED: 'PENDING',
  ELIGIBILITY_FAILED: 'BLOCKED',
  AWAITING_PAYMENT: 'WARNING',
  AWAITING_APPROVAL: 'PENDING',
  APPROVED: 'ACTIVE',
  COMPLETED: 'SUCCESS',
  REJECTED: 'CRITICAL',

  /* --- Auction ------------------------------------------------------ */
  PUBLISHED: 'PENDING',
  BIDDING: 'ACTIVE',
  LISTED: 'PENDING',
  WINNER_SELECTED: 'ACTIVE',
  SETTLED: 'SUCCESS',
  UNSOLD: 'EXPIRED',

  /* --- Bid ---------------------------------------------------------- */
  ACCEPTED: 'ACTIVE',
  OUTBID: 'EXPIRED',
  WON: 'SUCCESS',
  LOST: 'EXPIRED',
  RETRACTED: 'EXPIRED',

  /* --- Settlement --------------------------------------------------- */
  RECEIVED: 'SUCCESS',
  PARTIAL: 'WARNING',
  DUE: 'PENDING',

  /* --- Bidder / KYC ------------------------------------------------- */
  REGISTERED: 'PENDING',
  SUSPENDED: 'BLOCKED',

  /* --- Devices, gates, spaces --------------------------------------- */
  ONLINE: 'SUCCESS',
  OFFLINE: 'CRITICAL',
  DEGRADED: 'WARNING',
  AVAILABLE: 'SUCCESS',
  OCCUPIED: 'ACTIVE',
  RESERVED: 'PENDING',
  BLOCKED: 'BLOCKED',
  MAINTENANCE: 'BLOCKED',

  /* --- ANPR events -------------------------------------------------- */
  PROCESSED: 'SUCCESS',
  NEEDS_REVIEW: 'WARNING',
  DUPLICATE: 'COMPLETED',
  REJECTED_LOW_CONFIDENCE: 'WARNING',

  /* --- Generic ------------------------------------------------------ */
  ACTIVE: 'ACTIVE',
  INACTIVE: 'EXPIRED',
  PENDING: 'PENDING',
  LOCKED: 'BLOCKED',
};

/** Resolves a domain status to its visual treatment. */
export function statusVisual(status: string | null | undefined): StatusVisual {
  if (!status) return STATUS_VISUALS.UNKNOWN;
  return STATUS_VISUALS[STATUS_MAP[status.toUpperCase()] ?? 'UNKNOWN'];
}

/** `AWAITING_APPROVAL` → `Awaiting approval`. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Ageing severity                                                     */
/* ------------------------------------------------------------------ */

export type AgeSeverity = 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL';

/**
 * Ageing bands.
 *
 * These thresholds mirror the buckets the reporting API already returns, so the
 * console and the ageing report cannot disagree about what "critical" means.
 * They are presentation only - no charge or release decision is taken from them.
 */
export function ageSeverity(days: number | null | undefined): AgeSeverity {
  if (days === null || days === undefined) return 'NORMAL';
  if (days > 30) return 'CRITICAL';
  if (days > 15) return 'WARNING';
  if (days > 7) return 'WATCH';
  return 'NORMAL';
}

export const AGE_SEVERITY_VISUAL: Record<AgeSeverity, { kind: StatusKind; label: string }> = {
  NORMAL: { kind: 'SUCCESS', label: 'Normal' },
  WATCH: { kind: 'PENDING', label: 'Watch' },
  WARNING: { kind: 'WARNING', label: 'Warning' },
  CRITICAL: { kind: 'CRITICAL', label: 'Critical' },
};

/* ------------------------------------------------------------------ */
/* Registry provenance                                                 */
/* ------------------------------------------------------------------ */

/**
 * Plain-language explanation of a registry state.
 *
 * The gate and Vehicle 360 both show this. The wording matters: a mock provider
 * must never read as though an external registry confirmed anything, and an
 * unavailable lookup must not read like a failure the operator caused.
 */
export function registryExplanation(status: string | null | undefined): string {
  switch ((status ?? '').toUpperCase()) {
    case 'VERIFIED':
      return 'Confirmed against the vehicle registry.';
    case 'MANUALLY_VERIFIED':
      return 'Confirmed manually by a member of staff, not by the registry.';
    case 'PENDING':
      return 'Registry lookup in progress. Admission does not wait for it.';
    case 'UNAVAILABLE':
      return 'Registry information is unavailable for this vehicle.';
    case 'FAILED':
      return 'The registry lookup failed. It will be retried automatically.';
    case 'NOT_REQUESTED':
      return 'No registry lookup has been requested yet.';
    default:
      return 'Registry state unknown.';
  }
}
