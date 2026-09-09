'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  Car,
  Clock,
  Gavel,
  LogIn,
  LogOut,
  Radio,
  Receipt,
  Truck,
} from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { useSite } from '@/lib/site-context';
import { ApiError } from '@/lib/api';
import { formatAgeing, formatMoneyCompact, formatRelative } from '@/lib/format';
import {
  useAgeing,
  useDashboard,
  useOccupancy,
  useReleases,
  useRevenue,
  useSessions,
} from '@/hooks/use-domain';
import {
  Age,
  CapacityBar,
  EmptyState,
  ErrorState,
  LiveDot,
  Money,
  Panel,
  PanelHeader,
  SkeletonRows,
  StatusBadge,
  VehicleIdentifier,
} from '@/components/ui/primitives';
import { KpiTile, PageHeader, Section } from '@/components/ui/page';

/**
 * Operations overview.
 *
 * Composed as a control room rather than a metric grid. The question it answers
 * is not "how are we doing" but "what needs attention right now, and where do I
 * go to deal with it" - so every figure on this page is a link into the list it
 * summarises, and the sections are ordered by how urgently they are usually
 * acted on: what is happening at the gate, whether there is room, what has been
 * here too long, what is waiting to leave, what is owed.
 *
 * Every number comes from `/reports/*`, which the API scopes to the caller. A
 * financier user sees their own portfolio through the same components; nothing
 * here is computed in the browser.
 */
export default function OperationsOverviewPage() {
  const { user } = useAuth();
  const { siteId, currentSite } = useSite();
  const scope = siteId ?? undefined;

  const summary = useDashboard(scope);
  const occupancy = useOccupancy(scope);
  const ageing = useAgeing(scope);
  const revenue = useRevenue(scope);

  const oldest = useSessions({
    status: ['OPEN', 'ON_HOLD'],
    pageSize: 8,
    sortBy: 'entryAt',
    sortDir: 'asc',
    siteId: scope,
  });

  const pendingReleases = useReleases({
    status: ['SUBMITTED', 'AWAITING_APPROVAL', 'AWAITING_PAYMENT', 'APPROVED'],
    pageSize: 6,
    siteId: scope,
  });

  const recent = useSessions({ pageSize: 6, sortBy: 'entryAt', sortDir: 'desc', siteId: scope });

  const data = summary.data;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Operations overview"
        subtitle={
          currentSite
            ? `${currentSite.name} · live vehicle, yard and financial state`
            : 'All sites · live vehicle, yard and financial state'
        }
        meta={
          <div className="flex flex-wrap items-center gap-3 text-2xs text-ink-3">
            <LiveDot live={!summary.isError} label="Refreshes every 30 seconds" />
            {data ? <span>Generated {formatRelative(data.generatedAt)}</span> : null}
          </div>
        }
      />

      <div className="flex-1 space-y-5 p-4">
        {summary.isError ? (
          <Panel>
            <ErrorState
              title="Operational figures could not be loaded"
              message={summary.error instanceof ApiError ? summary.error.message : undefined}
              correlationId={
                summary.error instanceof ApiError ? summary.error.correlationId : undefined
              }
              onRetry={() => void summary.refetch()}
            />
          </Panel>
        ) : null}

        {/* ---------- What needs attention ---------------------------- */}
        <Section
          title="Requires attention"
          description="Each figure opens the list behind it"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <KpiTile
              label="In yard"
              value={data?.vehiclesInYard ?? '—'}
              icon={Car}
              href="/yard"
              loading={summary.isLoading}
              hint={`${data?.entriesToday ?? 0} in / ${data?.exitsToday ?? 0} out today`}
            />
            <KpiTile
              label="Ageing beyond threshold"
              value={data?.ageingBeyondThreshold ?? '—'}
              icon={Clock}
              kind={(data?.ageingBeyondThreshold ?? 0) > 0 ? 'WARNING' : undefined}
              href="/yard?ageing=critical"
              loading={summary.isLoading}
              hint="Long-standing vehicles"
            />
            <KpiTile
              label="Awaiting registry"
              value={data?.awaitingEnrichment ?? '—'}
              icon={Radio}
              kind={(data?.awaitingEnrichment ?? 0) > 0 ? 'PENDING' : undefined}
              href="/vehicles?registry=pending"
              loading={summary.isLoading}
              hint="Enrichment in progress"
            />
            <KpiTile
              label="Unpriced stays"
              value={data?.withoutContract ?? '—'}
              icon={AlertTriangle}
              kind={(data?.withoutContract ?? 0) > 0 ? 'WARNING' : undefined}
              href="/yard?rate=unresolved"
              loading={summary.isLoading}
              hint="No rate plan attached"
            />
            <KpiTile
              label="Pending releases"
              value={data?.pendingReleases ?? '—'}
              icon={LogOut}
              kind={(data?.pendingReleases ?? 0) > 0 ? 'PENDING' : undefined}
              href="/yard?view=releases"
              loading={summary.isLoading}
              hint="Awaiting approval or payment"
            />
            <KpiTile
              label="Capture review"
              value={data?.captureReviewQueue ?? '—'}
              icon={Radio}
              kind={(data?.captureReviewQueue ?? 0) > 0 ? 'WARNING' : undefined}
              href="/gate"
              loading={summary.isLoading}
              hint="Low-confidence reads"
            />
          </div>
        </Section>

        {/* ---------- Money -------------------------------------------- */}
        <Section title="Financial exposure" description="Derived from issued invoices">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <KpiTile
                label="Outstanding"
                value={data ? formatMoneyCompact(data.outstandingAmount) : '—'}
                icon={Receipt}
                kind={Number(data?.outstandingAmount ?? 0) > 0 ? 'WARNING' : 'SUCCESS'}
                href="/billing?outstanding=1"
                loading={summary.isLoading}
                hint={`${data?.outstandingInvoiceCount ?? 0} unsettled invoice(s)`}
              />
              <KpiTile
                label="Collected this month"
                value={data ? formatMoneyCompact(data.collectedThisMonth) : '—'}
                icon={Banknote}
                kind="SUCCESS"
                href="/billing?view=payments"
                loading={summary.isLoading}
              />
              <KpiTile
                label="Auction pipeline"
                value={data ? formatMoneyCompact(data.auctionPipelineValue) : '—'}
                icon={Gavel}
                href="/auctions"
                loading={summary.isLoading}
                hint={`${data?.openAuctions ?? 0} open auction(s)`}
              />
            </div>

            <FinancierExposure
              rows={revenue.data?.byFinancier ?? []}
              loading={revenue.isLoading}
              error={revenue.error}
              onRetry={() => void revenue.refetch()}
              canSeeFinanciers={!user?.financierId}
            />
          </div>
        </Section>

        {/* ---------- Capacity and ageing ------------------------------ */}
        <div className="grid gap-5 xl:grid-cols-2">
          <Section title="Yard capacity" description="Zone by zone, from live occupancy">
            <Panel padded={false}>
              {occupancy.isLoading ? (
                <SkeletonRows rows={5} />
              ) : occupancy.isError ? (
                <ErrorState
                  title="Capacity could not be loaded"
                  onRetry={() => void occupancy.refetch()}
                />
              ) : (occupancy.data?.sites.length ?? 0) === 0 ? (
                <EmptyState icon={Building2} title="No sites within your access" />
              ) : (
                <div className="divide-y divide-line">
                  {occupancy.data?.sites
                    .filter((site) => !siteId || site.siteId === siteId)
                    .map((site) => (
                      <SiteCapacity key={site.siteId} site={site} />
                    ))}
                </div>
              )}
            </Panel>
          </Section>

          <Section title="Ageing profile" description="How long vehicles have been on site">
            <Panel padded={false}>
              {ageing.isLoading ? (
                <SkeletonRows rows={5} />
              ) : ageing.isError ? (
                <ErrorState title="Ageing could not be loaded" onRetry={() => void ageing.refetch()} />
              ) : (ageing.data?.totalVehicles ?? 0) === 0 ? (
                <EmptyState icon={Clock} title="No vehicles on site" />
              ) : (
                <div className="p-4">
                  <AgeingBuckets
                    buckets={ageing.data!.buckets}
                    total={ageing.data!.totalVehicles}
                  />
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
                    <div>
                      <dt className="text-2xs uppercase tracking-wider text-ink-3">On site</dt>
                      <dd className="tabular mt-0.5 text-sm font-semibold text-ink">
                        {ageing.data!.totalVehicles}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-2xs uppercase tracking-wider text-ink-3">Average age</dt>
                      <dd className="tabular mt-0.5 text-sm font-semibold text-ink">
                        {formatAgeing(Math.round(ageing.data!.averageAgeDays))}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-2xs uppercase tracking-wider text-ink-3">Oldest</dt>
                      <dd className="mt-0.5">
                        <Age days={ageing.data!.oldestAgeDays} />
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </Panel>
          </Section>
        </div>

        {/* ---------- Queues ------------------------------------------- */}
        <div className="grid gap-5 xl:grid-cols-2">
          <Section
            title="Longest-standing vehicles"
            description="Oldest first — the disposal candidates"
            action={
              <Link href="/yard" className="text-2xs text-blue-strong hover:underline">
                Open live yard
              </Link>
            }
          >
            <Panel padded={false}>
              {oldest.isLoading ? (
                <SkeletonRows rows={5} />
              ) : (oldest.data?.items.length ?? 0) === 0 ? (
                <EmptyState icon={Truck} title="No vehicles currently on site" />
              ) : (
                <ul className="divide-y divide-line">
                  {oldest.data?.items.map((session) => (
                    <li key={session.id}>
                      <Link
                        href={`/vehicles/${session.vehicleId}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        <VehicleIdentifier
                          plate={session.registrationNumber}
                          make={session.make}
                          model={session.model}
                          className="min-w-0 flex-1"
                        />
                        <span className="hidden shrink-0 text-2xs text-ink-3 sm:block">
                          {session.siteName}
                        </span>
                        <Age days={session.ageingDays} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </Section>

          <Section
            title="Release queue"
            description="Vehicles waiting to leave, and what is blocking them"
          >
            <Panel padded={false}>
              {pendingReleases.isLoading ? (
                <SkeletonRows rows={5} />
              ) : (pendingReleases.data?.items.length ?? 0) === 0 ? (
                <EmptyState
                  icon={LogOut}
                  title="Nothing waiting to leave"
                  description="Releases appear here from request until the vehicle is off site."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {pendingReleases.data?.items.map((release) => (
                    <li key={release.id}>
                      <Link
                        href={`/yard/${release.sessionId}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        <VehicleIdentifier
                          plate={release.registrationNumber}
                          className="min-w-0 flex-1"
                        />
                        <StatusBadge status={release.status} size="sm" />
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </Section>
        </div>

        {/* ---------- Gate activity ------------------------------------ */}
        <Section
          title="Recent gate activity"
          action={
            <Link href="/gate" className="text-2xs text-blue-strong hover:underline">
              Open gate
            </Link>
          }
        >
          <Panel padded={false}>
            {recent.isLoading ? (
              <SkeletonRows rows={4} />
            ) : (recent.data?.items.length ?? 0) === 0 ? (
              <EmptyState icon={Radio} title="No movements recorded yet" />
            ) : (
              <ul className="divide-y divide-line">
                {recent.data?.items.map((session) => {
                  const exited = Boolean(session.exitAt);
                  return (
                    <li key={session.id}>
                      <Link
                        href={`/vehicles/${session.vehicleId}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        {exited ? (
                          <LogOut className="h-4 w-4 shrink-0 text-slate" aria-hidden />
                        ) : (
                          <LogIn className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                        )}
                        <VehicleIdentifier
                          plate={session.registrationNumber}
                          className="min-w-0 flex-1"
                        />
                        <span className="hidden shrink-0 text-2xs text-ink-3 md:block">
                          {session.siteName}
                        </span>
                        <span className="tabular shrink-0 text-2xs text-ink-3">
                          {formatRelative(session.exitAt ?? session.entryAt)}
                        </span>
                        <StatusBadge status={session.status} size="sm" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SiteCapacity({
  site,
}: {
  site: {
    siteId: string;
    siteCode: string;
    siteName: string;
    capacity: number;
    occupied: number;
    available: number;
    utilisationPercent: number;
    zones: Array<{
      zoneId: string;
      code: string;
      name: string;
      capacity: number;
      occupied: number;
      available: number;
      utilisationPercent: number;
    }>;
  };
}) {
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{site.siteName}</p>
          <p className="text-2xs text-ink-3">{site.siteCode}</p>
        </div>
        <p className="tabular shrink-0 text-xs text-ink-2">
          <span className="font-semibold text-ink">{site.occupied}</span>
          <span className="text-ink-3"> / {site.capacity}</span>
        </p>
      </div>

      <div className="mt-3 space-y-2.5">
        {site.zones.length === 0 ? (
          <p className="text-2xs text-ink-3">No zones configured.</p>
        ) : (
          site.zones.map((zone) => (
            <div key={zone.zoneId}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-ink-2">
                  <span className="identifier text-ink-3">{zone.code}</span> {zone.name}
                </span>
                <span className="tabular shrink-0 text-2xs text-ink-3">
                  {zone.occupied}/{zone.capacity} · {zone.utilisationPercent.toFixed(0)}%
                </span>
              </div>
              <CapacityBar
                className="mt-1"
                occupied={zone.occupied}
                available={zone.available}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AgeingBuckets({
  buckets,
  total,
}: {
  buckets: Array<{ label: string; minDays: number; maxDays: number | null; count: number }>;
  total: number;
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <ul className="space-y-2">
      {buckets.map((bucket) => {
        // Severity follows the bucket's own lower bound, so the bar and the
        // ageing badge elsewhere in the console cannot disagree.
        const tone =
          bucket.minDays > 30
            ? 'bg-danger'
            : bucket.minDays > 15
              ? 'bg-amber'
              : bucket.minDays > 7
                ? 'bg-blue'
                : 'bg-primary';

        return (
          <li key={bucket.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-ink-2">{bucket.label}</span>
              <span className="tabular text-2xs text-ink-3">
                {bucket.count}
                {total > 0 ? ` · ${((bucket.count / total) * 100).toFixed(0)}%` : ''}
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full ${tone}`}
                style={{ width: `${(bucket.count / max) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function FinancierExposure({
  rows,
  loading,
  error,
  onRetry,
  canSeeFinanciers,
}: {
  rows: Array<{
    financierId: string;
    financierName: string;
    invoiceCount: number;
    invoicedAmount: string;
    outstandingAmount: string;
  }>;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  canSeeFinanciers: boolean;
}) {
  const ranked = React.useMemo(
    () =>
      [...rows]
        .sort((a, b) => Number(b.outstandingAmount) - Number(a.outstandingAmount))
        .slice(0, 8),
    [rows],
  );

  const peak = Math.max(1, ...ranked.map((row) => Number(row.outstandingAmount)));

  return (
    <Panel padded={false}>
      <div className="px-4 pt-4">
        <PanelHeader
          title={canSeeFinanciers ? 'Outstanding by financier' : 'Your outstanding balance'}
          subtitle="Highest exposure first"
          icon={Building2}
        />
      </div>

      {loading ? (
        <SkeletonRows rows={5} />
      ) : error ? (
        <ErrorState title="Exposure could not be loaded" onRetry={onRetry} />
      ) : ranked.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nothing outstanding"
          description="Every issued invoice has been settled."
        />
      ) : (
        <ul className="divide-y divide-line">
          {ranked.map((row) => (
            <li key={row.financierId} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                  {row.financierName}
                </span>
                <Money amount={row.outstandingAmount} intent="outstanding" size="sm" />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-amber"
                    style={{ width: `${(Number(row.outstandingAmount) / peak) * 100}%` }}
                  />
                </div>
                <span className="tabular shrink-0 text-2xs text-ink-3">
                  {row.invoiceCount} inv
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
