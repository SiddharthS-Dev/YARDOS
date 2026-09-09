'use client';

import Link from 'next/link';
import {
  Banknote,
  Building2,
  Car,
  Clock,
  Gavel,
  LogIn,
  LogOut,
  ScanLine,
  TriangleAlert,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ApiError } from '@/lib/api';
import { formatDateTime, formatMoney, formatMoneyCompact } from '@/lib/format';
import {
  EmptyState,
  ErrorState,
  MetricCard,
  Panel,
  PanelHeader,
  SkeletonRows,
  UtilisationBar,
} from '@/components/ui/primitives';
import {
  useActivity,
  useAgeing,
  useDashboard,
  useOccupancy,
  useRevenue,
} from '@/hooks/use-domain';

/**
 * Management dashboard.
 *
 * Every figure comes from a reporting endpoint that derives it from persisted
 * state. Nothing is hardcoded and nothing is padded: where there is no data
 * the panel says so rather than drawing a plausible-looking line.
 */
export default function DashboardPage() {
  const summary = useDashboard();
  const occupancy = useOccupancy();
  const ageing = useAgeing();
  const activity = useActivity(30);
  const revenue = useRevenue();

  return (
    <div className="space-y-3 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h1 className="text-base font-semibold tracking-wide text-white">Operations dashboard</h1>
        {summary.data ? (
          <p className="text-2xs text-muted-500">
            As at {formatDateTime(summary.data.generatedAt)}
          </p>
        ) : null}
      </header>

      {summary.isError ? (
        <Panel>
          <ErrorState
            message={
              summary.error instanceof ApiError ? summary.error.message : 'Could not load the dashboard.'
            }
            correlationId={summary.error instanceof ApiError ? summary.error.correlationId : undefined}
            onRetry={() => void summary.refetch()}
          />
        </Panel>
      ) : summary.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-panel bg-base-850" />
          ))}
        </div>
      ) : summary.data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Vehicles in yard"
              value={summary.data.vehiclesInYard}
              icon={Car}
              tone="accent"
              href="/yard"
            />
            <MetricCard
              label="Entries today"
              value={summary.data.entriesToday}
              icon={LogIn}
              tone="ok"
            />
            <MetricCard
              label="Exits today"
              value={summary.data.exitsToday}
              icon={LogOut}
              tone="info"
            />
            <MetricCard
              label="Ageing over 90 days"
              value={summary.data.ageingBeyondThreshold}
              icon={Clock}
              tone={summary.data.ageingBeyondThreshold > 0 ? 'warn' : 'neutral'}
              hint="Candidates for review or auction"
            />
          </section>

          {/* Work queues. These are the things somebody has to act on. */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Awaiting capture review"
              value={summary.data.captureReviewQueue}
              icon={ScanLine}
              tone={summary.data.captureReviewQueue > 0 ? 'warn' : 'neutral'}
              hint="Low-confidence plate reads"
              href="/gate"
            />
            <MetricCard
              label="Stays without a rate"
              value={summary.data.withoutContract}
              icon={TriangleAlert}
              tone={summary.data.withoutContract > 0 ? 'warn' : 'neutral'}
              hint="Finance must attach a contract"
              href="/yard?rateUnresolvedOnly=true"
            />
            <MetricCard
              label="Releases in progress"
              value={summary.data.pendingReleases}
              icon={LogOut}
              tone={summary.data.pendingReleases > 0 ? 'info' : 'neutral'}
              href="/billing"
            />
            <MetricCard
              label="Open auctions"
              value={summary.data.openAuctions}
              icon={Gavel}
              tone={summary.data.openAuctions > 0 ? 'info' : 'neutral'}
              hint={
                Number(summary.data.auctionPipelineValue) > 0
                  ? `${formatMoneyCompact(summary.data.auctionPipelineValue)} at reserve`
                  : undefined
              }
              href="/auctions"
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <MetricCard
              label="Outstanding receivables"
              value={formatMoneyCompact(summary.data.outstandingAmount)}
              icon={Banknote}
              tone={Number(summary.data.outstandingAmount) > 0 ? 'warn' : 'ok'}
              hint={`${summary.data.outstandingInvoiceCount} unsettled invoice${summary.data.outstandingInvoiceCount === 1 ? '' : 's'}`}
              href="/billing?outstandingOnly=true"
            />
            <MetricCard
              label="Collected this month"
              value={formatMoneyCompact(summary.data.collectedThisMonth)}
              icon={Banknote}
              tone="ok"
            />
          </section>
        </>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Entries and exits */}
        <Panel>
          <PanelHeader
            title="Entries and exits"
            subtitle="Last 30 days"
            icon={LogIn}
          />
          {activity.isLoading ? (
            <SkeletonRows rows={4} />
          ) : (activity.data?.series.length ?? 0) === 0 ? (
            <EmptyState title="No movement recorded" description="Entries and exits will chart here once vehicles start moving." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activity.data?.series ?? []} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="#1e2c48" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#1e2c48' }}
                    tickFormatter={(value: string) => value.slice(5)}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f1729',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Line type="monotone" dataKey="entries" stroke="#34d399" strokeWidth={2} dot={false} name="Entries" />
                  <Line type="monotone" dataKey="exits" stroke="#60a5fa" strokeWidth={2} dot={false} name="Exits" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        {/* Ageing */}
        <Panel>
          <PanelHeader
            title="Vehicle ageing"
            subtitle={
              ageing.data
                ? `${ageing.data.totalVehicles} on site · average ${ageing.data.averageAgeDays} days · oldest ${ageing.data.oldestAgeDays} days`
                : undefined
            }
            icon={Clock}
          />
          {ageing.isLoading ? (
            <SkeletonRows rows={4} />
          ) : (ageing.data?.totalVehicles ?? 0) === 0 ? (
            <EmptyState title="No vehicles on site" description="Ageing is measured across vehicles currently in a yard." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ageing.data?.buckets ?? []} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="#1e2c48" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#1e2c48' }}
                  />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    contentStyle={{
                      background: '#0f1729',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Vehicles" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Occupancy */}
        <Panel padded={false}>
          <div className="px-4 pt-4">
            <PanelHeader title="Site occupancy" icon={Building2} />
          </div>
          {occupancy.isLoading ? (
            <SkeletonRows rows={4} />
          ) : (occupancy.data?.sites.length ?? 0) === 0 ? (
            <EmptyState title="No sites in scope" description="You do not have access to any site yet." />
          ) : (
            <ul className="divide-y divide-white/5">
              {occupancy.data?.sites.map((site) => (
                <li key={site.siteId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{site.siteName}</p>
                      <p className="mt-0.5 text-2xs text-muted-500">
                        {site.siteCode} · {site.status.toLowerCase()}
                        {site.parkingMode === 'PUBLIC_PARKING' ? ' · Phase 2' : ''}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-sm tabular-nums text-slate-300">
                      {site.occupied}
                      <span className="text-muted-600">/{site.capacity}</span>
                    </p>
                  </div>
                  <UtilisationBar percent={site.utilisationPercent} className="mt-2" />
                  {site.zones.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {site.zones.map((zone) => (
                        <span
                          key={zone.zoneId}
                          className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-2xs text-muted-400"
                          title={zone.name}
                        >
                          {zone.code} {zone.occupied}/{zone.capacity}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Receivables by financier */}
        <Panel padded={false}>
          <div className="px-4 pt-4">
            <PanelHeader
              title="Receivables by financier"
              subtitle={
                revenue.data
                  ? `${formatMoney(revenue.data.outstandingAmount)} outstanding across ${revenue.data.outstandingCount} invoice(s)`
                  : undefined
              }
              icon={Banknote}
            />
          </div>
          {revenue.isLoading ? (
            <SkeletonRows rows={4} />
          ) : (revenue.data?.byFinancier.length ?? 0) === 0 ? (
            <EmptyState
              title="No invoices raised yet"
              description="Receivables appear once stays are released and invoiced."
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Financier</th>
                  <th className="text-right">Invoices</th>
                  <th className="text-right">Invoiced</th>
                  <th className="text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {revenue.data?.byFinancier.map((row) => (
                  <tr key={row.financierId}>
                    <td className="max-w-[12rem] truncate">{row.financierName}</td>
                    <td className="text-right font-mono tabular-nums text-muted-400">{row.invoiceCount}</td>
                    <td className="text-right font-mono tabular-nums">{formatMoneyCompact(row.invoicedAmount)}</td>
                    <td
                      className={
                        Number(row.outstandingAmount) > 0
                          ? 'text-right font-mono tabular-nums text-warn-400'
                          : 'text-right font-mono tabular-nums text-muted-500'
                      }
                    >
                      {formatMoneyCompact(row.outstandingAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="border-t border-white/5 px-4 py-2">
            <Link href="/billing" className="text-2xs text-accent-400 hover:text-accent-300">
              Open billing →
            </Link>
          </div>
        </Panel>
      </div>

      <p className="px-1 pb-2 text-2xs leading-relaxed text-muted-600">
        All monetary values are computed server-side by the charge engine. Rates and tax are
        development placeholders pending Sri JP finance sign-off (open items OI-02, OI-03, OI-05).
      </p>
    </div>
  );
}
