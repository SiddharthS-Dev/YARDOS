'use client';

import { use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Car,
  ClipboardList,
  FileText,
  FlaskConical,
  History,
  MapPin,
  Receipt,
} from 'lucide-react';

import { ApiError } from '@/lib/api';
import {
  formatAgeing,
  formatDateTime,
  formatMoney,
  formatPlate,
  formatRelative,
  humanise,
} from '@/lib/format';
import {
  Badge,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  PanelHeader,
  SkeletonRows,
  StatusBadge,
} from '@/components/ui/primitives';
import {
  useSessionCharge,
  useVehicle,
  useVehicleTimeline,
} from '@/hooks/use-domain';

/**
 * Vehicle record.
 *
 * The reference view for a single vehicle: identity, ownership provenance,
 * where it is, what it has cost so far, and its complete history.
 *
 * Sensitive fields are role-controlled by the API, not by this screen. A
 * financier portal user receives masked owner names and cannot open a vehicle
 * outside their own book at all — that request returns 404.
 */
export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const vehicle = useVehicle(id);
  const timeline = useVehicleTimeline(id);
  const charge = useSessionCharge(vehicle.data?.activeSession?.id ?? null);

  if (vehicle.isLoading) {
    return (
      <div className="p-3">
        <Panel padded={false}><SkeletonRows rows={8} /></Panel>
      </div>
    );
  }

  if (vehicle.isError) {
    const error = vehicle.error;
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-3">
        <Panel>
          <ErrorState
            title={notFound ? 'Vehicle not found' : 'Could not load the vehicle'}
            message={
              notFound
                ? 'This vehicle does not exist, or it is outside the data you are permitted to see.'
                : error instanceof ApiError
                  ? error.message
                  : undefined
            }
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
            onRetry={notFound ? undefined : () => void vehicle.refetch()}
          />
        </Panel>
      </div>
    );
  }

  const data = vehicle.data;
  if (!data) return null;
  const session = data.activeSession;

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <Link href="/vehicles" className="text-muted-500 hover:text-slate-300" aria-label="Back to vehicles">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-mono text-lg font-semibold tracking-widest text-white">
          {formatPlate(data.registrationNumber)}
        </h1>
        <StatusBadge status={data.status} />
        {data.ownershipIsSimulated ? (
          <Badge tone="warn">
            <FlaskConical className="h-3 w-3" aria-hidden />
            Simulated registry data
          </Badge>
        ) : null}
        <span className="ml-auto text-2xs text-muted-500">
          Seen {data.totalVisits} time{data.totalVisits === 1 ? '' : 's'} · first {formatRelative(data.firstSeenAt)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {/* Identity */}
          <Panel>
            <PanelHeader title="Identity" icon={Car} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field label="Class">{humanise(data.vehicleClass)}</Field>
              <Field label="Make">{data.make ?? '—'}</Field>
              <Field label="Model">{data.model ?? '—'}</Field>
              <Field label="Variant">{data.variant ?? '—'}</Field>
              <Field label="Colour">{data.color ?? '—'}</Field>
              <Field label="Year">{data.manufacturingYear ?? '—'}</Field>
              <Field label="Fuel">{data.fuelType ? humanise(data.fuelType) : '—'}</Field>
              <Field label="Chassis (last 4)" mono>{data.chassisNumberLast4 ?? '—'}</Field>
              <Field label="Engine (last 4)" mono>{data.engineNumberLast4 ?? '—'}</Field>
            </dl>
          </Panel>

          {/* Ownership */}
          <Panel>
            <PanelHeader
              title="Ownership and finance"
              icon={Building2}
              action={<StatusBadge status={data.vahanVerificationStatus} />}
            />
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field label="Registered owner">{data.registeredOwnerName ?? 'Not available'}</Field>
              <Field label="Address">{data.registeredOwnerAddress ?? 'Not available'}</Field>
              <Field label="Financier">{data.financierName ?? 'No financier matched'}</Field>
              <Field label="Hypothecation">{humanise(data.hypothecationStatus)}</Field>
              <Field label="Match method">{humanise(data.financierMatchMethod)}</Field>
              <Field label="Match confidence">
                {data.financierMatchConfidence
                  ? `${(Number(data.financierMatchConfidence) * 100).toFixed(0)}%`
                  : '—'}
              </Field>
            </dl>

            <div className="mt-3 rounded-md bg-base-900 px-3 py-2 text-2xs leading-relaxed text-muted-500">
              {data.ownershipSource ? (
                <>
                  Source: <span className="text-muted-400">{data.ownershipSource}</span>
                  {data.ownershipRetrievedAt
                    ? ` · retrieved ${formatDateTime(data.ownershipRetrievedAt)}`
                    : ''}
                  {data.ownershipIsSimulated ? (
                    <span className="mt-1 block text-warn-400">
                      This record came from the development simulator. It is deliberately never
                      marked as registry-verified, and must not be relied on operationally.
                    </span>
                  ) : null}
                </>
              ) : (
                'No ownership record has been retrieved for this vehicle yet.'
              )}
            </div>
          </Panel>

          {/* Current stay */}
          <Panel>
            <PanelHeader
              title="Current stay"
              icon={MapPin}
              action={session ? <StatusBadge status={session.status} /> : undefined}
            />
            {session ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <Field label="Stay" mono>{session.sessionNumber}</Field>
                  <Field label="Site">{session.siteName}</Field>
                  <Field label="Zone / bay">
                    {session.zoneName
                      ? `${session.zoneName}${session.spaceCode ? ` · ${session.spaceCode}` : ''}`
                      : 'Not allocated'}
                  </Field>
                  <Field label="Entered">{formatDateTime(session.entryAt)}</Field>
                  <Field label="Ageing" tone="strong">
                    {formatAgeing(
                      Math.floor((Date.now() - new Date(session.entryAt).getTime()) / 86_400_000),
                    )}
                  </Field>
                  <Field label="Rate">
                    {session.rateUnresolved ? (
                      <Badge tone="warn">No rate applied</Badge>
                    ) : (
                      <Badge tone="ok">Contract rate</Badge>
                    )}
                  </Field>
                </dl>

                {/* Accrued charge, with the engine's own workings. */}
                <div className="mt-3 rounded-md bg-base-900 p-3">
                  <p className="text-2xs uppercase tracking-wider text-muted-500">Accrued charge</p>
                  {charge.isLoading ? (
                    <div className="mt-2 h-4 w-32 animate-pulse rounded bg-white/5" />
                  ) : charge.data?.breakdown ? (
                    <>
                      <p className="mt-1 font-mono text-xl font-semibold text-white">
                        {formatMoney(charge.data.breakdown.total, charge.data.breakdown.currency)}
                      </p>
                      <p className="mt-0.5 text-2xs text-muted-500">
                        {charge.data.breakdown.chargeableUnits} chargeable{' '}
                        {charge.data.breakdown.billingUnit.replace('_', ' ').toLowerCase()}s ·
                        subtotal {formatMoney(charge.data.breakdown.subtotal)} + tax{' '}
                        {formatMoney(charge.data.breakdown.taxTotal)}
                      </p>
                      <details className="mt-2 group">
                        <summary className="cursor-pointer list-none text-2xs uppercase tracking-wider text-muted-500 hover:text-muted-400">
                          How this was calculated
                        </summary>
                        <ol className="mt-2 space-y-1 border-l border-white/10 pl-3">
                          {charge.data.breakdown.explanation.map((line, index) => (
                            <li key={index} className="text-2xs leading-relaxed text-muted-400">{line}</li>
                          ))}
                        </ol>
                        <p className="mt-2 font-mono text-2xs text-muted-600">
                          engine {charge.data.breakdown.engineVersion} · hash{' '}
                          {charge.data.breakdown.inputsHash.slice(0, 16)}…
                        </p>
                      </details>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-warn-400">
                      {charge.data?.unavailableReason ?? 'No charge could be computed.'}
                    </p>
                  )}
                </div>

                <div className="mt-3">
                  <Link
                    href={`/yard/${session.id}`}
                    className="text-2xs text-accent-400 hover:text-accent-300"
                  >
                    Open the stay →
                  </Link>
                </div>
              </>
            ) : (
              <EmptyState
                icon={MapPin}
                title="Not currently on site"
                description="This vehicle has no open stay at any Sri JP location."
              />
            )}
          </Panel>
        </div>

        {/* Timeline */}
        <Panel padded={false} className="lg:sticky lg:top-3 lg:self-start">
          <div className="px-4 pt-4">
            <PanelHeader
              title="History"
              subtitle="Immutable, append-only"
              icon={History}
            />
          </div>
          {timeline.isLoading ? (
            <SkeletonRows rows={6} />
          ) : (timeline.data?.items.length ?? 0) === 0 ? (
            <EmptyState icon={ClipboardList} title="No events recorded" />
          ) : (
            <ol className="max-h-[36rem] overflow-y-auto px-4 pb-4">
              {timeline.data?.items.map((event, index) => (
                <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* Connector */}
                  {index < (timeline.data?.items.length ?? 0) - 1 ? (
                    <span className="absolute left-[5px] top-4 h-full w-px bg-white/8" aria-hidden />
                  ) : null}
                  <span
                    className="relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-base-600 ring-2 ring-base-850"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium leading-snug text-slate-200">{event.title}</p>
                    {event.description ? (
                      <p className="mt-0.5 text-2xs leading-relaxed text-muted-400">{event.description}</p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-2xs text-muted-600">
                      <span>{formatDateTime(event.occurredAt)}</span>
                      <span>·</span>
                      <span>{event.actorLabel ?? humanise(event.actorType)}</span>
                      {event.siteName ? (<><span>·</span><span>{event.siteName}</span></>) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
