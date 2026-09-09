'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';
import { STATUS_VISUALS, type StatusKind } from '@/lib/status';

/**
 * Page chrome.
 *
 * Every page states where it is, what it is, and what the one thing to do here
 * is. Action hierarchy is enforced by the component rather than left to each
 * screen: exactly one primary, then secondaries. Ten equal buttons is not a
 * design, it is an unmade decision.
 */

export function Breadcrumbs({
  trail,
}: {
  trail: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-2xs text-ink-3">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {crumb.href && !last ? (
                <Link href={crumb.href} className="transition-colors hover:text-ink">
                  {crumb.label}
                </Link>
              ) : (
                <span className={last ? 'text-ink-2' : undefined} aria-current={last ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
              {!last ? <ChevronRight className="h-3 w-3" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  primaryAction,
  actions,
  meta,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  /** Exactly one. The single most likely thing to do on this page. */
  primaryAction?: React.ReactNode;
  /** Everything else, visually subordinate. */
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('border-b border-line bg-surface px-4 py-3', className)}>
      {breadcrumbs ? <Breadcrumbs trail={breadcrumbs} /> : null}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
        </div>
        {primaryAction || actions ? (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {primaryAction}
          </div>
        ) : null}
      </div>
      {meta ? <div className="mt-2.5">{meta}</div> : null}
    </header>
  );
}

/**
 * A KPI that is a way in, not an ornament.
 *
 * Every tile links to the filtered list it summarises: "12 pending releases" is
 * only useful if it takes you to those twelve. A tile with no destination is a
 * number on a wall.
 */
export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  kind,
  href,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  /** Colours the figure when it means something. Omit for a plain count. */
  kind?: StatusKind;
  href?: string;
  loading?: boolean;
}) {
  const visual = kind ? STATUS_VISUALS[kind] : null;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wider text-ink-3">{label}</p>
        {Icon ? (
          <Icon className={cn('h-4 w-4 shrink-0', visual ? visual.text : 'text-ink-3')} aria-hidden />
        ) : null}
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-20 animate-pulse rounded bg-surface-3" aria-hidden />
      ) : (
        <p className={cn('mt-1.5 tabular text-2xl font-semibold', visual ? visual.text : 'text-ink')}>
          {value}
        </p>
      )}
      {hint ? <p className="mt-0.5 truncate text-2xs text-ink-3">{hint}</p> : null}
    </>
  );

  if (!href) return <div className="panel p-3.5">{body}</div>;

  return (
    <Link
      href={href}
      className="panel block p-3.5 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
    >
      {body}
    </Link>
  );
}

/** A labelled section within a page. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2">{title}</h2>
          {description ? <p className="mt-0.5 text-2xs text-ink-3">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Tabs that survive a reload and a shared link.
 *
 * State lives in the query string rather than in component state, because
 * "look at the financial tab of this vehicle" is a thing one operator sends
 * another.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: string; label: string; count?: number; icon?: LucideIcon }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('scroll-x border-b border-line', className)} role="tablist">
      <div className="flex min-w-max gap-0.5">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                selected
                  ? 'border-primary font-medium text-ink'
                  : 'border-transparent text-ink-3 hover:border-line-strong hover:text-ink-2',
              )}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
              {tab.label}
              {tab.count !== undefined ? (
                <span className="tabular rounded bg-surface-3 px-1.5 py-0.5 text-2xs text-ink-2">
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
