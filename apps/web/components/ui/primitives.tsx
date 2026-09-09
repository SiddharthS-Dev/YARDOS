'use client';

import { AlertTriangle, Inbox, Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The console's shared primitives.
 *
 * Deliberately small and unopinionated — they exist so that a panel, a status
 * chip or an empty state looks identical everywhere, not to abstract away
 * layout. Screens compose these; they do not subclass them.
 */

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-panel border border-white/5 bg-base-850 shadow-panel',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  subtitle,
  action,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
          {Icon ? <Icon className="h-4 w-4 text-muted-400" aria-hidden /> : null}
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-400">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'accent';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-ok-500/12 text-ok-400 ring-ok-500/25',
  warn: 'bg-warn-500/12 text-warn-400 ring-warn-500/25',
  danger: 'bg-danger-500/12 text-danger-400 ring-danger-500/25',
  info: 'bg-info-500/12 text-info-400 ring-info-500/25',
  accent: 'bg-accent-500/12 text-accent-400 ring-accent-500/25',
  neutral: 'bg-white/5 text-muted-400 ring-white/10',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider ring-1 ring-inset',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Maps a domain status to a colour.
 *
 * Kept in one place so the same status never renders green on one screen and
 * amber on another — an operator reads state from colour, so inconsistency
 * here is a correctness problem, not a cosmetic one.
 */
export function toneForStatus(status: string | null | undefined): Tone {
  if (!status) return 'neutral';
  switch (status.toUpperCase()) {
    // Good / settled / available
    case 'ACTIVE': case 'OPEN': case 'PAID': case 'SETTLED': case 'RECEIVED':
    case 'APPROVED': case 'COMPLETED': case 'SUCCESS': case 'AVAILABLE':
    case 'ONLINE': case 'VERIFIED': case 'CLEAN': case 'WON': case 'PROCESSED':
      return 'ok';
    // Attention / in progress / occupied
    case 'PENDING': case 'PENDING_REVIEW': case 'PENDING_EXIT': case 'ON_HOLD':
    case 'UNDER_HOLD': case 'AWAITING_APPROVAL': case 'AWAITING_PAYMENT':
    case 'PARTIALLY_PAID': case 'PARTIALLY_RECEIVED': case 'SUBMITTED':
    case 'OCCUPIED': case 'DEGRADED': case 'VAHAN_PENDING': case 'SETTLEMENT_PENDING':
    case 'BIDDING_OPEN': case 'RELEASE_REQUESTED': case 'GENERATED': case 'ISSUED':
      return 'warn';
    // Failed / blocked / refused
    case 'FAILED': case 'REJECTED': case 'CANCELLED': case 'VOID': case 'BLOCKED':
    case 'OFFLINE': case 'SUSPENDED': case 'DISABLED': case 'LOCKED': case 'INFECTED':
    case 'VAHAN_FAILED': case 'DEFAULTED': case 'BLACKLISTED': case 'ELIGIBILITY_FAILED':
    case 'EXHAUSTED': case 'DEAD_LETTER':
      return 'danger';
    // Informational
    case 'PARKED': case 'SENT': case 'LISTED': case 'PUBLISHED': case 'SCHEDULED':
    case 'RESERVED': case 'WINNER_SELECTED': case 'BIDDING_CLOSED': case 'CLOSED':
    case 'RELEASE_APPROVED': case 'AUCTION_LISTED': case 'AUCTION_ELIGIBLE':
      return 'info';
    // Terminal / inert
    case 'EXITED': case 'SOLD': case 'DRAFT': case 'UNAVAILABLE': case 'NOT_REQUESTED':
    case 'UNMATCHED': case 'LOST': case 'OUTBID': case 'UNKNOWN': case 'PLANNED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="text-muted-500">—</span>;
  return (
    <Badge tone={toneForStatus(status)} className={className}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

/** A small pulsing dot for genuinely live indicators. Used sparingly. */
export function LiveDot({ tone = 'ok', label }: { tone?: Tone; label?: string }) {
  const colour =
    tone === 'ok' ? 'bg-ok-400' : tone === 'warn' ? 'bg-warn-400' : tone === 'danger' ? 'bg-danger-400' : 'bg-muted-400';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', colour, tone !== 'danger' && 'animate-pulse-soft')} />
      {label ? <span className="text-2xs uppercase tracking-wider text-muted-400">{label}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-500 text-white hover:bg-accent-400 disabled:bg-accent-600/40',
  secondary: 'bg-white/5 text-slate-200 hover:bg-white/10 ring-1 ring-inset ring-white/10',
  ghost: 'text-muted-400 hover:bg-white/5 hover:text-slate-200',
  danger: 'bg-danger-600 text-white hover:bg-danger-500 disabled:bg-danger-600/40',
};

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon: Icon,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-base-900',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' && 'px-2.5 py-1.5 text-xs',
        size === 'md' && 'px-3.5 py-2 text-sm',
        size === 'lg' && 'px-5 py-3 text-base',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* State displays                                                      */
/* ------------------------------------------------------------------ */

/**
 * Empty state.
 *
 * Requirement S51: say specifically what is absent and what to do next.
 * "No vehicles at the gate yet" beats "No data".
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <Icon className="h-7 w-7 text-muted-600" aria-hidden />
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-relaxed text-muted-400">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * Error state.
 *
 * Shows the server's message, which is written for an operator, plus the
 * correlation id so a support call can be traced. Never a stack trace.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  correlationId,
  onRetry,
}: {
  title?: string;
  message?: string;
  correlationId?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <AlertTriangle className="h-7 w-7 text-danger-400" aria-hidden />
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {message ? <p className="max-w-md text-xs leading-relaxed text-muted-400">{message}</p> : null}
      {correlationId ? (
        <p className="font-mono text-2xs text-muted-600">Reference: {correlationId}</p>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-10 text-muted-400">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="text-xs">{label}…</span>
    </div>
  );
}

/** Skeleton rows, so a table does not jump when data arrives. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2 p-4', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-8 animate-pulse rounded bg-white/5" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

/** A labelled value. The console's most-used building block. */
export function Field({
  label,
  children,
  mono = false,
  tone,
  className,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  tone?: 'muted' | 'strong';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-2xs uppercase tracking-wider text-muted-500">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-sm',
          mono && 'font-mono',
          tone === 'muted' ? 'text-muted-400' : 'text-slate-200',
          tone === 'strong' && 'font-semibold text-white',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon: Icon,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
  icon?: LucideIcon;
  href?: string;
}) {
  const accentBar =
    tone === 'ok' ? 'bg-ok-500' : tone === 'warn' ? 'bg-warn-500' : tone === 'danger' ? 'bg-danger-500'
      : tone === 'info' ? 'bg-info-500' : tone === 'accent' ? 'bg-accent-500' : 'bg-white/10';

  const content = (
    <div className="relative overflow-hidden rounded-panel border border-white/5 bg-base-850 p-4 shadow-panel transition-colors hover:bg-base-800">
      <span className={cn('absolute inset-y-0 left-0 w-0.5', accentBar)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs uppercase tracking-wider text-muted-500">{label}</p>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-600" aria-hidden /> : null}
      </div>
      <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-400">{hint}</p> : null}
    </div>
  );

  return href ? (
    <a href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 rounded-panel">
      {content}
    </a>
  ) : (
    content
  );
}

/** A horizontal utilisation bar. Colour tracks pressure, not brand. */
export function UtilisationBar({ percent, className }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const tone =
    clamped >= 90 ? 'bg-danger-500' : clamped >= 70 ? 'bg-warn-500' : 'bg-ok-500';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/5', className)}>
      <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${clamped}%` }} />
    </div>
  );
}
