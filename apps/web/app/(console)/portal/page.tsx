'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2, Car, Receipt, Search, ShieldCheck } from 'lucide-react';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  formatAgeing,
  formatDateTime,
  formatMoney,
  formatPlate,
  formatRelative,
} from '@/lib/format';
import {
  Badge,
  EmptyState,
  ErrorState,
  MetricCard,
  Panel,
  PanelHeader,
  SkeletonRows,
  StatusBadge,
} from '@/components/ui/primitives';
import { useDashboard, useInvoices, useSessions, useVehicles } from '@/hooks/use-domain';

/**
 * Financier portal.
 *
 * Everything here is narrowed by the API to the signed-in user's own
 * financier. That narrowing is a mandatory SQL predicate, not a filter applied
 * after loading, and a request for another financier's vehicle returns 404 —
 * so the portal cannot even confirm such a vehicle exists.
 *
 * Owner names arrive masked, because portal users do not hold
 * `vehicle:pii:read`. This screen renders what it is given and never unmasks.
 */
export default function FinancierPortalPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');

  const summary = useDashboard();
  const vehicles = useVehicles({ search: search.trim() || undefined, pageSize: 25 });
  const onSite = useSessions({
    status: ['OPEN', 'ON_HOLD'],
    pageSize: 10,
    sortBy: 'entryAt',
    sortDir: 'asc',
  });
  const invoices = useInvoices({ outstandingOnly: true, pageSize: 10 });

  return (
    <div className="space-y-3 p-3">
      <header className="flex flex-wrap items-center gap-3 px-1">
        <ShieldCheck className="h-4 w-4 text-accent-400" aria-hidden />
        <h1 className="text-base font-semibold tracking-wide text-white">My vehicles</h1>
        {user?.financierName ? (
          <Badge tone="info">
            <Building2 className="h-3 w-3" aria-hidden />
            {user.financierName}
          </Badge>
        ) : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Currently in a yard"
          value={summary.data?.vehiclesInYard ?? '—'}
          icon={Car}
          tone="accent"
        />
        <MetricCard
          label="Ageing over 90 days"
          value={summary.data?.ageingBeyondThreshold ?? '—'}
          icon={Car}
          tone={(summary.data?.ageingBeyondThreshold ?? 0) > 0 ? 'warn' : 'neutral'}
        />
        <MetricCard
          label="Outstanding"
          value={summary.data ? formatMoney(summary.data.outstandingAmount) : '—'}
          icon={Receipt}
          tone={Number(summary.data?.outstandingAmount ?? 0) > 0 ? 'warn' : 'ok'}
          hint={`${summary.data?.outstandingInvoiceCount ?? 0} unsettled invoice(s)`}
        />
      </section>

      <Panel>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-600"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="input pl-9"
            placeholder="Search your financed vehicles by registration number"
            aria-label="Search vehicles"
          />
        </div>
        <p className="mt-2 text-2xs text-muted-500">
          Registration numbers match in any format. Only vehicles financed by your organisation are
          searchable.
        </p>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel padded={false}>
          <div className="px-4 pt-4">
            <PanelHeader title="Your vehicles" icon={Car} />
          </div>
          {vehicles.isLoading ? (
            <SkeletonRows rows={6} />
          ) : vehicles.isError ? (
            <ErrorState
              message={vehicles.error instanceof ApiError ? vehicles.error.message : undefined}
              correlationId={
                vehicles.error instanceof ApiError ? vehicles.error.correlationId : undefined
              }
            />
          ) : (vehicles.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={Car}
              title={search ? `No match for "${search}"` : 'No vehicles recorded'}
              description={
                search
                  ? 'No vehicle financed by your organisation matches that registration number.'
                  : 'Vehicles appear here once one of your financed vehicles is seen at a Sri JP location.'
              }
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Registration</th>
                  <th className="hidden sm:table-cell">Vehicle</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.data?.items.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>
                      <Link
                        href={`/vehicles/${vehicle.id}`}
                        className="font-mono text-xs text-accent-400 hover:text-accent-300"
                      >
                        {formatPlate(vehicle.registrationNumber)}
                      </Link>
                    </td>
                    <td className="hidden text-xs text-muted-400 sm:table-cell">
                      {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td>
                      <StatusBadge status={vehicle.status} />
                    </td>
                    <td className="text-xs text-muted-400">{vehicle.siteName ?? '—'}</td>
                    <td className="text-2xs text-muted-400">{formatRelative(vehicle.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="space-y-3">
          <Panel padded={false}>
            <div className="px-4 pt-4">
              <PanelHeader
                title="Longest-standing vehicles"
                subtitle="Currently in a yard"
                icon={Car}
              />
            </div>
            {onSite.isLoading ? (
              <SkeletonRows rows={4} />
            ) : (onSite.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="None of your vehicles are in a yard" />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Registration</th>
                    <th>Site</th>
                    <th>Entered</th>
                    <th>Ageing</th>
                  </tr>
                </thead>
                <tbody>
                  {onSite.data?.items.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <Link
                          href={`/vehicles/${session.vehicleId}`}
                          className="font-mono text-xs text-accent-400 hover:text-accent-300"
                        >
                          {formatPlate(session.registrationNumber)}
                        </Link>
                      </td>
                      <td className="text-xs text-muted-400">{session.siteName}</td>
                      <td className="text-2xs text-muted-400">{formatDateTime(session.entryAt)}</td>
                      <td>
                        <span
                          className={
                            session.ageingDays > 90 ? 'text-xs text-warn-400' : 'text-xs text-muted-300'
                          }
                        >
                          {formatAgeing(session.ageingDays)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel padded={false}>
            <div className="px-4 pt-4">
              <PanelHeader title="Outstanding invoices" icon={Receipt} />
            </div>
            {invoices.isLoading ? (
              <SkeletonRows rows={4} />
            ) : (invoices.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                title="Nothing outstanding"
                description="All invoices raised to your organisation are settled."
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th className="hidden sm:table-cell">Vehicle</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.data?.items.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="font-mono text-xs text-slate-300">{invoice.invoiceNumber}</td>
                      <td className="hidden font-mono text-2xs text-muted-400 sm:table-cell">
                        {invoice.registrationNumber ? formatPlate(invoice.registrationNumber) : '—'}
                      </td>
                      <td className="text-right font-mono text-xs tabular-nums text-warn-400">
                        {formatMoney(invoice.balance, invoice.currency)}
                      </td>
                      <td>
                        <StatusBadge status={invoice.status} />
                        {invoice.isOverdue ? (
                          <Badge tone="danger" className="ml-1">
                            Overdue
                          </Badge>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
