'use client';

import * as React from 'react';
import { AlertCircle, Inbox, Loader2, RefreshCw, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';
import {
  AGE_SEVERITY_VISUAL,
  STATUS_VISUALS,
  type StatusKind,
  ageSeverity,
  humanise,
  statusVisual,
} from '@/lib/status';
import { formatAgeing, formatMoney, formatPlate } from '@/lib/format';

/* ================================================================== */
/* Surfaces                                                            */
/* ================================================================== */

export function Panel({
  children,
  className,
  padded = true,
  as: Tag = 'section',
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return (
    <Tag className={cn('panel', padded && 'p-4', className)}>{children}</Tag>
  );
}

export function PanelHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden /> : null}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ================================================================== */
/* Status                                                              */
/* ================================================================== */

/**
 * A status badge.
 *
 * Renders colour, icon AND word, always. That triple is why the badge survives
 * greyscale printing, colour blindness and a sun-washed gate screen.
 */
export function StatusBadge({
  status,
  label,
  size = 'md',
  className,
}: {
  status: string | null | undefined;
  /** Overrides the humanised status text. */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const visual = statusVisual(status);
  const Icon = visual.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded font-medium whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-2xs' : 'px-2 py-0.5 text-xs',
        visual.badge,
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      {label ?? humanise(status)}
    </span>
  );
}

/** A neutral, non-status chip. Used for counts and categories. */
export function Chip({
  children,
  kind,
  className,
}: {
  children: React.ReactNode;
  kind?: StatusKind;
  className?: string;
}) {
  const visual = kind ? STATUS_VISUALS[kind] : null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium',
        visual ? visual.badge : 'bg-surface-3 text-ink-2 ring-1 ring-inset ring-line',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A live indicator. Pulses only while genuinely live. */
export function LiveDot({
  live = true,
  label,
  tone,
}: {
  live?: boolean;
  label?: string;
  /** @deprecated Legacy tone prop; anything other than `ok` reads as not live. */
  tone?: string;
}) {
  const isLive = tone === undefined ? live : tone === 'ok' || tone === 'accent';
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-ink-3">
      <span className="relative flex h-2 w-2" aria-hidden>
        {isLive ? (
          <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-primary/60" />
        ) : null}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            isLive ? 'bg-primary' : 'bg-slate',
          )}
        />
      </span>
      {label ? <span>{label}</span> : null}
      <span className="sr-only">{isLive ? 'Live' : 'Not live'}</span>
    </span>
  );
}

/* ================================================================== */
/* Domain display components                                           */
/* ================================================================== */

/**
 * A registration number, rendered as the identifier it is.
 *
 * Used everywhere a plate appears so the platform speaks about a vehicle in one
 * voice. Before this existed the same grouping logic was repeated in seven
 * files and drifted.
 */
export function VehicleIdentifier({
  plate,
  make,
  model,
  vehicleClass,
  status,
  size = 'md',
  className,
}: {
  plate: string | null | undefined;
  make?: string | null;
  model?: string | null;
  vehicleClass?: string | null;
  status?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const descriptor = [vehicleClass ? humanise(vehicleClass) : null, make, model]
    .filter(Boolean)
    .join(' · ');

  return (
    <span className={cn('inline-flex min-w-0 flex-col gap-0.5', className)}>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'identifier font-semibold text-ink',
            size === 'lg' && 'text-2xl',
            size === 'md' && 'text-sm',
            size === 'sm' && 'text-xs',
          )}
        >
          {formatPlate(plate)}
        </span>
        {status ? <StatusBadge status={status} size="sm" /> : null}
      </span>
      {descriptor ? (
        <span className={cn('truncate text-ink-3', size === 'lg' ? 'text-sm' : 'text-2xs')}>
          {descriptor}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A monetary amount.
 *
 * The console never computes one - this renders a decimal string the API
 * produced. `intent` colours the figure by what it means operationally, not by
 * its sign: an outstanding balance is amber even though it is a positive number.
 */
export function Money({
  amount,
  currency = 'INR',
  intent = 'neutral',
  size = 'md',
  className,
}: {
  amount: string | number | null | undefined;
  currency?: string;
  intent?: 'neutral' | 'outstanding' | 'paid' | 'pending' | 'negative';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const intentClass = {
    neutral: 'text-ink',
    outstanding: 'text-amber-strong',
    paid: 'text-primary-strong',
    pending: 'text-blue-strong',
    negative: 'text-danger-strong',
  }[intent];

  return (
    <span
      className={cn(
        'tabular font-mono',
        size === 'lg' && 'text-xl font-semibold',
        size === 'md' && 'text-sm',
        size === 'sm' && 'text-xs',
        intentClass,
        className,
      )}
    >
      {formatMoney(amount, currency)}
    </span>
  );
}

/**
 * A vehicle's age on site, with severity.
 *
 * Severity is shown by an icon and a word as well as colour, because "this one
 * has been here too long" is exactly the signal an operator must not miss.
 */
export function Age({
  days,
  showSeverity = true,
  className,
}: {
  days: number | null | undefined;
  showSeverity?: boolean;
  className?: string;
}) {
  const severity = ageSeverity(days);
  const { kind, label } = AGE_SEVERITY_VISUAL[severity];
  const visual = STATUS_VISUALS[kind];
  const Icon = visual.icon;

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('tabular font-mono text-xs', severity === 'NORMAL' ? 'text-ink-2' : visual.text)}>
        {formatAgeing(days)}
      </span>
      {showSeverity && severity !== 'NORMAL' ? (
        <span className={cn('inline-flex items-center gap-0.5 text-2xs font-medium', visual.text)}>
          <Icon className="h-3 w-3" aria-hidden />
          {label}
        </span>
      ) : null}
    </span>
  );
}

/* ================================================================== */
/* Actions                                                             */
/* ================================================================== */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    icon?: LucideIcon;
    /** Shown as a tooltip and to screen readers when the button is disabled. */
    disabledReason?: string;
  }
>(function Button(
  { variant = 'secondary', size = 'md', loading, icon: Icon, disabledReason, className, children, disabled, ...props },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type="button"
      disabled={isDisabled}
      title={isDisabled && disabledReason ? disabledReason : undefined}
      aria-describedby={undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'px-2.5 py-1 text-xs',
        size === 'md' && 'px-3 py-1.5 text-sm',
        size === 'lg' && 'px-5 py-2.5 text-base',
        variant === 'primary' && 'bg-primary text-white hover:bg-primary-strong',
        variant === 'secondary' &&
          'bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'bg-danger text-white hover:bg-danger-strong',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5'} aria-hidden />
      ) : null}
      {children}
      {isDisabled && disabledReason ? <span className="sr-only">{disabledReason}</span> : null}
    </button>
  );
});

/* ================================================================== */
/* Data display                                                        */
/* ================================================================== */

export function Field({
  label,
  children,
  mono,
  tone,
  className,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  /** @deprecated Legacy tone prop, kept while screens migrate. */
  tone?: string;
  className?: string;
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-primary-strong'
      : tone === 'warn'
        ? 'text-amber-strong'
        : tone === 'danger'
          ? 'text-danger-strong'
          : tone === 'info'
            ? 'text-blue-strong'
            : 'text-ink';

  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-2xs font-semibold uppercase tracking-wider text-ink-3">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-sm', toneClass, mono && 'tabular font-mono')}>
        {children}
      </dd>
    </div>
  );
}

/**
 * A capacity bar.
 *
 * Segmented by meaning rather than a single percentage fill, because "80% full"
 * and "80% full with 12 bays blocked" are different operational situations.
 */
export function CapacityBar({
  occupied,
  available,
  blocked = 0,
  className,
}: {
  occupied: number;
  available: number;
  blocked?: number;
  className?: string;
}) {
  const total = Math.max(1, occupied + available + blocked);
  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div
      className={cn('flex h-2 w-full overflow-hidden rounded-full bg-surface-3', className)}
      role="img"
      aria-label={`${occupied} occupied, ${available} available${blocked ? `, ${blocked} blocked` : ''}`}
    >
      <div className="bg-primary" style={{ width: pct(occupied) }} />
      {blocked > 0 ? <div className="bg-slate" style={{ width: pct(blocked) }} /> : null}
      <div className="bg-transparent" style={{ width: pct(available) }} />
    </div>
  );
}

/* ================================================================== */
/* States: loading, empty, error                                       */
/* ================================================================== */

/** A shimmer block shaped like the content it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded bg-surface-3',
        'bg-[linear-gradient(90deg,transparent,rgb(var(--line)/0.6),transparent)] bg-[length:200%_100%]',
        className,
      )}
      aria-hidden
    />
  );
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2 p-4', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function SkeletonTiles({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)} aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <Icon className="h-7 w-7 text-ink-3" aria-hidden />
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs text-ink-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * An error a user can act on.
 *
 * Says what happened, why it may have happened, and what to do next. The
 * correlation id is shown because it is the one thing that makes a support
 * conversation short. Stack traces are never surfaced.
 */
export function ErrorState({
  title = 'This could not be loaded',
  message,
  reason,
  correlationId,
  onRetry,
  action,
  className,
}: {
  title?: string;
  message?: string;
  reason?: string;
  correlationId?: string;
  onRetry?: () => void;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)} role="alert">
      <AlertCircle className="h-7 w-7 text-danger" aria-hidden />
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {message ? <p className="mt-1 max-w-md text-xs text-ink-2">{message}</p> : null}
      {reason ? <p className="mt-1 max-w-md text-xs text-ink-3">{reason}</p> : null}
      <div className="mt-4 flex items-center gap-2">
        {onRetry ? (
          <Button icon={RefreshCw} onClick={onRetry} size="sm">
            Try again
          </Button>
        ) : null}
        {action}
      </div>
      {correlationId ? (
        <p className="mt-3 text-2xs text-ink-3">
          Reference <span className="identifier">{correlationId}</span>
        </p>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-10 text-xs text-ink-3" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/**
 * A capability the backend does not yet expose.
 *
 * Shown instead of a screen that would have nothing real to display. Being
 * explicit is the honest alternative to a plausible-looking page of invented
 * data, and to a navigation entry that leads nowhere.
 */
export function NotAvailableState({
  feature,
  dependency,
  className,
}: {
  feature: string;
  dependency: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <AlertCircle className="h-7 w-7 text-ink-3" aria-hidden />
      <p className="mt-3 text-sm font-medium text-ink">{feature} is not available yet</p>
      <p className="mt-1 max-w-md text-xs text-ink-3">{dependency}</p>
    </div>
  );
}

/* ================================================================== */
/* Compatibility layer                                                 */
/* ================================================================== */
/*
 * These keep the screens that have not yet been reworked compiling while the
 * console is migrated to the new design system one screen at a time. They are
 * deliberately thin wrappers over the new components rather than a second
 * implementation, so there is no possibility of the two drifting.
 *
 * Every one of them is deleted once the last screen using it is reworked; see
 * docs/UI-IMPLEMENTATION-STATUS.md for what still depends on them.
 */

/** @deprecated Use `StatusBadge` or `Chip`. */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'accent';

const TONE_TO_KIND: Record<Tone, StatusKind> = {
  ok: 'SUCCESS',
  warn: 'WARNING',
  danger: 'CRITICAL',
  info: 'PENDING',
  neutral: 'UNKNOWN',
  accent: 'ACTIVE',
};

/** @deprecated Use `Chip` with a `kind`, or `StatusBadge` for a real status. */
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
    <Chip kind={TONE_TO_KIND[tone]} className={className}>
      {children}
    </Chip>
  );
}

/** @deprecated Use `statusVisual` from `@/lib/status`. */
export function toneForStatus(status: string | null | undefined): Tone {
  const kind = statusVisual(status).kind;
  if (kind === 'SUCCESS' || kind === 'ACTIVE') return 'ok';
  if (kind === 'WARNING') return 'warn';
  if (kind === 'CRITICAL') return 'danger';
  if (kind === 'PENDING') return 'info';
  return 'neutral';
}

/** @deprecated Use `KpiTile` from `@/components/ui/kpi`. */
export function MetricCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = 'neutral',
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: React.ReactNode;
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const visual = STATUS_VISUALS[TONE_TO_KIND[tone]];
  const Wrapper: React.ElementType = href ? 'a' : 'div';
  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn('panel block p-3.5', href && 'transition-colors hover:bg-surface-2', className)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wider text-ink-3">{label}</p>
        {Icon ? <Icon className={cn('h-4 w-4', tone === 'neutral' ? 'text-ink-3' : visual.text)} aria-hidden /> : null}
      </div>
      <p className={cn('mt-1.5 tabular text-2xl font-semibold', tone === 'neutral' ? 'text-ink' : visual.text)}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-2xs text-ink-3">{hint}</p> : null}
    </Wrapper>
  );
}

/** @deprecated Use `CapacityBar`, which segments by meaning. */
export function UtilisationBar({ percent, className }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-3', className)}
      role="img"
      aria-label={`${clamped.toFixed(0)} percent utilised`}
    >
      <div
        className={cn('h-full rounded-full', clamped > 90 ? 'bg-danger' : clamped > 75 ? 'bg-amber' : 'bg-primary')}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
