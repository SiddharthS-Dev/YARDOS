'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock,
  FlaskConical,
  Info,
  Radio,
  ScanLine,
  ShieldAlert,
  Truck,
} from 'lucide-react';

import { Permission } from '@smartpark/contracts';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import {
  formatConfidence,
  formatDateTime,
  formatPlate,
  formatRelative,
  formatTime,
  humanise,
} from '@/lib/format';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LiveDot,
  Panel,
  PanelHeader,
  SkeletonRows,
  StatusBadge,
} from '@/components/ui/primitives';
import {
  type AnprEventItem,
  type GateDecision,
  GATE_POLL_MS,
  useAnprDevices,
  useRecentCaptures,
  useResolveReview,
  useReviewQueue,
  useSimulateCapture,
} from '@/hooks/use-gate';
import { useVehicle } from '@/hooks/use-domain';

/**
 * The gate operator console.
 *
 * Designed for the highest-frequency user, and for speed of a single decision
 * rather than breadth. The layout answers three questions in order, left to
 * right: what did the camera see, who is it, and what do I do about it.
 *
 * Two behaviours matter more than the visuals:
 *
 *   The screen never blocks on enrichment. A capture appears immediately; the
 *   registry, financier and contract fill in asynchronously and are shown as
 *   "looking up" until they do. That mirrors the server, which admits vehicles
 *   without waiting for VAHAN.
 *
 *   Nothing is invented. Where the registry has no answer the field says so.
 *   The console never displays a guessed owner, financier or rate.
 */
export default function GatePage() {
  const { can } = useAuth();
  const devices = useAnprDevices();
  const captures = useRecentCaptures(undefined, 15);
  const reviewQueue = useReviewQueue();

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<GateDecision | null>(null);

  const events = captures.data?.items ?? [];

  // Follow the newest capture unless the operator has deliberately selected an
  // older one - they may be mid-way through investigating it.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned && events.length > 0 && events[0]) setSelectedEventId(events[0].id);
  }, [events, pinned]);

  const selected = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? events[0] ?? null,
    [events, selectedEventId],
  );

  const entryDevices = (devices.data ?? []).filter(
    (device) => device.direction === 'ENTRY' || device.direction === 'BIDIRECTIONAL',
  );
  const anyOnline = (devices.data ?? []).some((device) => device.status === 'ONLINE');
  const simulatorAvailable = (devices.data ?? []).some((device) => device.provider === 'mock');

  return (
    <div className="flex min-h-full flex-col">
      <GateHeader
        deviceCount={devices.data?.length ?? 0}
        online={anyOnline}
        polling={captures.isFetching}
        error={captures.isError}
        reviewCount={reviewQueue.data?.totalItems ?? 0}
      />

      <div className="grid flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,320px)]">
        {/* Column 1 — capture */}
        <div className="flex min-w-0 flex-col gap-3">
          <LiveCapturePanel capture={selected} loading={captures.isLoading} />

          {simulatorAvailable && can(Permission['anpr:event:review']) ? (
            <SimulatorPanel devices={entryDevices.map((d) => d.code)} onDecision={setLastDecision} />
          ) : null}

          <CaptureQueuePanel
            events={events}
            loading={captures.isLoading}
            error={captures.error}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelectedEventId(id);
              setPinned(true);
            }}
            pinned={pinned}
            onUnpin={() => setPinned(false)}
          />
        </div>

        {/* Column 2 — identity */}
        <div className="flex min-w-0 flex-col gap-3">
          <VehicleIdentityPanel capture={selected} />
          {lastDecision ? <DecisionPanel decision={lastDecision} onDismiss={() => setLastDecision(null)} /> : null}
        </div>

        {/* Column 3 — work queues */}
        <div className="flex min-w-0 flex-col gap-3 xl:col-span-1 lg:col-span-2 xl:col-auto">
          <ReviewQueuePanel
            events={reviewQueue.data?.items ?? []}
            loading={reviewQueue.isLoading}
            canReview={can(Permission['anpr:event:review'])}
          />
          <DeviceHealthPanel devices={devices.data ?? []} loading={devices.isLoading} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function GateHeader({
  deviceCount,
  online,
  polling,
  error,
  reviewCount,
}: {
  deviceCount: number;
  online: boolean;
  polling: boolean;
  error: boolean;
  reviewCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/5 bg-base-900 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-accent-400" aria-hidden />
        <h1 className="text-sm font-semibold tracking-wide text-white">Live gate</h1>
      </div>

      <span className="text-muted-700" aria-hidden>|</span>

      {/* Connection state is always visible: an operator must know whether what
          they are looking at is current. */}
      {error ? (
        <LiveDot tone="danger" label="Connection lost" />
      ) : online ? (
        <LiveDot tone="ok" label={polling ? 'Syncing' : 'Live'} />
      ) : (
        <LiveDot tone="warn" label="No camera online" />
      )}

      <span className="text-2xs text-muted-500">
        {deviceCount} camera{deviceCount === 1 ? '' : 's'} · refresh {GATE_POLL_MS / 1000}s
      </span>

      {reviewCount > 0 ? (
        <Badge tone="warn" className="ml-auto">
          {reviewCount} awaiting review
        </Badge>
      ) : null}
    </div>
  );
}

function LiveCapturePanel({
  capture,
  loading,
}: {
  capture: AnprEventItem | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Panel padded={false}>
        <SkeletonRows rows={4} />
      </Panel>
    );
  }

  if (!capture) {
    return (
      <Panel>
        <PanelHeader title="Latest capture" icon={Camera} />
        <EmptyState
          icon={ScanLine}
          title="No vehicles captured yet"
          description="Captures appear here the moment a camera reads a plate. Nothing has been read at your sites yet today."
        />
      </Panel>
    );
  }

  const confidence = Number.parseFloat(capture.confidence);
  const lowConfidence = capture.status === 'PENDING_REVIEW';
  const plate = capture.correctedPlate ?? capture.normalizedPlate;

  return (
    <Panel className={cn(lowConfidence && 'ring-1 ring-inset ring-warn-500/30')}>
      <PanelHeader
        title="Latest capture"
        subtitle={`${capture.deviceName} · ${capture.gateCode ?? 'gate'} · ${capture.direction.toLowerCase()}`}
        icon={Camera}
        action={<StatusBadge status={capture.status} />}
      />

      {/* The plate is the single most important thing on this screen. */}
      <div className="rounded-md bg-base-950 p-4 text-center ring-1 ring-inset ring-white/5">
        <p className="font-mono text-3xl font-bold tracking-[0.15em] text-white sm:text-4xl">
          {formatPlate(plate)}
        </p>
        {capture.correctedPlate && capture.correctedPlate !== capture.normalizedPlate ? (
          <p className="mt-1.5 text-2xs text-warn-400">
            Corrected by an operator from {formatPlate(capture.normalizedPlate)}
          </p>
        ) : (
          <p className="mt-1.5 font-mono text-2xs text-muted-600">
            raw reading: {capture.plateNumberRaw}
          </p>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Confidence">
          <span
            className={cn(
              'font-mono',
              confidence >= 0.9 ? 'text-ok-400' : confidence >= 0.75 ? 'text-warn-400' : 'text-danger-400',
            )}
          >
            {formatConfidence(capture.confidence)}
          </span>
        </Field>
        <Field label="Captured">{formatTime(capture.capturedAt)}</Field>
        <Field label="Site">{capture.siteName}</Field>
        <Field label="Received">{formatRelative(capture.receivedAt)}</Field>
      </dl>

      {lowConfidence ? (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-warn-500/10 px-3 py-2 ring-1 ring-inset ring-warn-500/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-400" aria-hidden />
          <p className="text-xs leading-relaxed text-warn-400">
            Confidence is below this camera&rsquo;s threshold, so the barrier was not opened. Confirm
            or correct the plate in the review queue.
          </p>
        </div>
      ) : null}

      {capture.processingError ? (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-danger-500/10 px-3 py-2 ring-1 ring-inset ring-danger-500/20">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-400" aria-hidden />
          <p className="text-xs leading-relaxed text-danger-400">{capture.processingError}</p>
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * Vehicle identity.
 *
 * Every field distinguishes three states: known, still being looked up, and
 * genuinely unavailable. That distinction is the point — an operator must
 * never mistake "we do not know yet" for "there is nothing".
 */
function VehicleIdentityPanel({ capture }: { capture: AnprEventItem | null }) {
  const vehicle = useVehicle(capture?.vehicleId ?? null);

  if (!capture) {
    return (
      <Panel>
        <PanelHeader title="Vehicle identification" icon={Truck} />
        <EmptyState
          icon={Truck}
          title="Nothing selected"
          description="Select a capture from the queue to see the vehicle behind it."
        />
      </Panel>
    );
  }

  if (!capture.vehicleId) {
    return (
      <Panel>
        <PanelHeader title="Vehicle identification" icon={Truck} action={<Badge tone="warn">Unresolved</Badge>} />
        <EmptyState
          icon={CircleSlash}
          title="Not yet resolved to a vehicle"
          description={
            capture.status === 'PENDING_REVIEW'
              ? 'This capture is awaiting manual review. Confirming the plate will resolve it to a vehicle record.'
              : 'This capture has not been matched to a vehicle record.'
          }
        />
      </Panel>
    );
  }

  if (vehicle.isLoading) {
    return (
      <Panel padded={false}>
        <SkeletonRows rows={6} />
      </Panel>
    );
  }

  if (vehicle.isError) {
    const error = vehicle.error;
    return (
      <Panel>
        <PanelHeader title="Vehicle identification" icon={Truck} />
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load the vehicle.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
          onRetry={() => void vehicle.refetch()}
        />
      </Panel>
    );
  }

  const data = vehicle.data;
  if (!data) return null;

  const session = data.activeSession;
  const registryPending = ['NOT_REQUESTED', 'PENDING'].includes(data.vahanVerificationStatus);
  const registryUnavailable = ['UNAVAILABLE', 'FAILED'].includes(data.vahanVerificationStatus);

  return (
    <Panel>
      <PanelHeader
        title="Vehicle identification"
        subtitle={`Seen ${data.totalVisits} time${data.totalVisits === 1 ? '' : 's'}`}
        icon={Truck}
        action={<StatusBadge status={data.status} />}
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Registration" mono tone="strong">
          {formatPlate(data.registrationNumber)}
        </Field>
        <Field label="Class">{humanise(data.vehicleClass)}</Field>

        <Field label="Make and model">
          {data.make || data.model ? (
            [data.make, data.model].filter(Boolean).join(' ')
          ) : registryPending ? (
            <LookingUp />
          ) : (
            <Unavailable />
          )}
        </Field>
        <Field label="Colour / year">
          {[data.color, data.manufacturingYear].filter(Boolean).join(' · ') || <Unavailable />}
        </Field>

        <Field label="Registered owner">
          {data.registeredOwnerName ?? (registryPending ? <LookingUp /> : <Unavailable />)}
        </Field>
        <Field label="Hypothecation">{humanise(data.hypothecationStatus)}</Field>
      </dl>

      {/* Registry provenance. Simulated data is labelled, always. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-base-900 px-3 py-2">
        <span className="text-2xs uppercase tracking-wider text-muted-500">Registry</span>
        <StatusBadge status={data.vahanVerificationStatus} />
        {data.ownershipIsSimulated ? (
          <Badge tone="warn">
            <FlaskConical className="h-3 w-3" aria-hidden />
            Simulated — not authoritative
          </Badge>
        ) : null}
        {registryPending ? <span className="text-2xs text-muted-500">Lookup in progress…</span> : null}
        {registryUnavailable ? (
          <span className="text-2xs text-muted-500">
            Registry data unavailable. Verify manually if the vehicle must be identified.
          </span>
        ) : null}
      </div>

      {/* Financier and contract. Never guessed. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-base-900 p-3">
          <p className="text-2xs uppercase tracking-wider text-muted-500">Financier</p>
          {data.financierName ? (
            <>
              <p className="mt-1 truncate text-sm font-medium text-slate-200">{data.financierName}</p>
              <p className="mt-1 text-2xs text-muted-500">
                {humanise(data.financierMatchMethod)}
                {data.financierMatchConfidence
                  ? ` · confidence ${(Number(data.financierMatchConfidence) * 100).toFixed(0)}%`
                  : ''}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-400">
                {registryPending ? 'Looking up…' : 'No financier matched'}
              </p>
              {!registryPending ? (
                <p className="mt-1 text-2xs text-muted-600">
                  No contract rate can apply until a financier is confirmed.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="rounded-md bg-base-900 p-3">
          <p className="text-2xs uppercase tracking-wider text-muted-500">Stay and rate</p>
          {session ? (
            <>
              <p className="mt-1 font-mono text-sm text-slate-200">{session.sessionNumber}</p>
              <p className="mt-1 text-2xs text-muted-500">
                {session.zoneName ? `${session.zoneName}${session.spaceCode ? ` · ${session.spaceCode}` : ''}` : 'No bay allocated'}
              </p>
              {session.rateUnresolved ? (
                <p className="mt-1.5 inline-flex items-center gap-1 text-2xs text-warn-400">
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  No rate applied — finance must attach a contract
                </p>
              ) : (
                <p className="mt-1.5 inline-flex items-center gap-1 text-2xs text-ok-400">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  Contract rate applied
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-400">Not currently on site</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/vehicles/${data.id}`}>
          <Button size="sm" variant="secondary" icon={ChevronRight}>
            Open vehicle record
          </Button>
        </Link>
        {session ? (
          <Link href={`/yard/${session.id}`}>
            <Button size="sm" variant="ghost">
              View stay
            </Button>
          </Link>
        ) : null}
      </div>
    </Panel>
  );
}

function LookingUp() {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-400">
      <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-info-400" />
      Looking up…
    </span>
  );
}

function Unavailable() {
  return <span className="text-muted-600">Not available</span>;
}

function CaptureQueuePanel({
  events,
  loading,
  error,
  selectedId,
  onSelect,
  pinned,
  onUnpin,
}: {
  events: AnprEventItem[];
  loading: boolean;
  error: unknown;
  selectedId: string | null;
  onSelect: (id: string) => void;
  pinned: boolean;
  onUnpin: () => void;
}) {
  return (
    <Panel padded={false} className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <PanelHeader
          title="Recent captures"
          icon={Clock}
          action={
            pinned ? (
              <Button size="sm" variant="ghost" onClick={onUnpin}>
                Follow live
              </Button>
            ) : null
          }
        />
      </div>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load captures.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      ) : events.length === 0 ? (
        <EmptyState
          icon={ScanLine}
          title="No captures yet"
          description="Plate reads from your sites will appear here as they happen."
        />
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Plate</th>
                <th className="hidden sm:table-cell">Camera</th>
                <th>Conf.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  onClick={() => onSelect(event.id)}
                  className={cn(
                    'cursor-pointer',
                    event.id === selectedId && 'bg-accent-500/10 hover:bg-accent-500/10',
                  )}
                >
                  <td className="whitespace-nowrap font-mono text-2xs text-muted-400">
                    {formatTime(event.capturedAt)}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs text-slate-200">
                    {formatPlate(event.correctedPlate ?? event.normalizedPlate)}
                  </td>
                  <td className="hidden truncate text-2xs text-muted-400 sm:table-cell">
                    {event.gateCode ?? event.deviceCode}
                  </td>
                  <td className="whitespace-nowrap font-mono text-2xs text-muted-400">
                    {formatConfidence(event.confidence)}
                  </td>
                  <td>
                    <StatusBadge status={event.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function DecisionPanel({ decision, onDismiss }: { decision: GateDecision; onDismiss: () => void }) {
  const tone =
    decision.outcome === 'ADMITTED' || decision.outcome === 'EXIT_AUTHORISED'
      ? 'ok'
      : decision.outcome === 'EXIT_BLOCKED' || decision.outcome === 'NOT_ON_SITE'
        ? 'danger'
        : 'warn';

  const Icon =
    tone === 'ok' ? CheckCircle2 : tone === 'danger' ? ShieldAlert : AlertTriangle;

  return (
    <Panel
      className={cn(
        'animate-slide-in ring-1 ring-inset',
        tone === 'ok' && 'ring-ok-500/30',
        tone === 'warn' && 'ring-warn-500/30',
        tone === 'danger' && 'ring-danger-500/30',
      )}
    >
      <PanelHeader
        title="Gate decision"
        icon={Icon}
        action={
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      />

      <div className="flex items-start gap-2">
        <Badge tone={tone}>{decision.outcome.replace(/_/g, ' ')}</Badge>
        <p className="text-sm leading-relaxed text-slate-200">{decision.message}</p>
      </div>

      {decision.blockers.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {decision.blockers.map((blocker) => (
            <li key={blocker} className="flex items-start gap-2 text-xs text-warn-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {blocker}
            </li>
          ))}
        </ul>
      ) : null}

      {/* The trace is what the system actually did, in order. Shown because an
          operator asked to explain a decision should not have to call support. */}
      <details className="mt-3 group">
        <summary className="cursor-pointer list-none text-2xs uppercase tracking-wider text-muted-500 hover:text-muted-400">
          <span className="inline-flex items-center gap-1">
            <Info className="h-3 w-3" aria-hidden />
            What the system did ({decision.trace.length} steps)
          </span>
        </summary>
        <ol className="mt-2 space-y-1 border-l border-white/10 pl-3">
          {decision.trace.map((step, index) => (
            <li key={index} className="text-2xs leading-relaxed text-muted-400">
              {step}
            </li>
          ))}
        </ol>
      </details>
    </Panel>
  );
}

function ReviewQueuePanel({
  events,
  loading,
  canReview,
}: {
  events: AnprEventItem[];
  loading: boolean;
  canReview: boolean;
}) {
  const resolve = useResolveReview();
  const [active, setActive] = useState<AnprEventItem | null>(null);
  const [plate, setPlate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function open(event: AnprEventItem) {
    setActive(event);
    setPlate(event.normalizedPlate);
    setNotes('');
    setError(null);
  }

  async function submit(reject: boolean) {
    if (!active) return;
    setError(null);
    try {
      await resolve.mutateAsync({
        anprEventId: active.id,
        correctedPlate: plate,
        notes: notes || (reject ? 'Rejected by operator.' : 'Confirmed by operator.'),
        reject,
      });
      setActive(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not resolve the capture.');
    }
  }

  return (
    <Panel padded={false}>
      <div className="px-4 pt-4">
        <PanelHeader
          title="Review queue"
          subtitle="Low-confidence captures that did not open a barrier"
          icon={AlertTriangle}
        />
      </div>

      {loading ? (
        <SkeletonRows rows={3} />
      ) : events.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing awaiting review"
          description="Every capture has been read with enough confidence to process automatically."
        />
      ) : (
        <ul className="divide-y divide-white/5">
          {events.map((event) => (
            <li key={event.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-slate-200">{event.plateNumberRaw}</p>
                  <p className="mt-0.5 text-2xs text-muted-500">
                    {formatConfidence(event.confidence)} · {event.gateCode ?? event.deviceCode} ·{' '}
                    {formatRelative(event.capturedAt)}
                  </p>
                </div>
                {canReview ? (
                  <Button size="sm" variant="secondary" onClick={() => open(event)}>
                    Resolve
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {active ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-panel border border-white/10 bg-base-850 p-5 shadow-raised">
            <h3 className="text-sm font-semibold text-white">Resolve capture</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-400">
              Read the plate from the image and confirm or correct it. Every override records you,
              the original reading and your correction.
            </p>

            <div className="mt-4 rounded-md bg-base-950 p-3 text-center ring-1 ring-inset ring-white/5">
              <p className="text-2xs uppercase tracking-wider text-muted-500">Camera read</p>
              <p className="mt-1 font-mono text-lg text-slate-300">{active.plateNumberRaw}</p>
              <p className="mt-1 text-2xs text-warn-400">
                confidence {formatConfidence(active.confidence)}
              </p>
            </div>

            <div className="mt-4">
              <label htmlFor="plate" className="label">Confirmed registration number</label>
              <input
                id="plate"
                value={plate}
                onChange={(event) => setPlate(event.target.value.toUpperCase())}
                className="input font-mono tracking-widest"
                autoFocus
              />
            </div>

            <div className="mt-3">
              <label htmlFor="notes" className="label">Notes (audited)</label>
              <input
                id="notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="input"
                placeholder="Plate partially obscured; read from the overview image."
              />
            </div>

            {error ? (
              <p className="mt-3 rounded-md bg-danger-500/10 px-3 py-2 text-xs text-danger-400 ring-1 ring-inset ring-danger-500/20">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
              <Button variant="danger" loading={resolve.isPending} onClick={() => void submit(true)}>
                Reject capture
              </Button>
              <Button variant="primary" loading={resolve.isPending} onClick={() => void submit(false)}>
                Confirm and process
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function DeviceHealthPanel({ devices, loading }: { devices: ReturnType<typeof useAnprDevices>['data']; loading: boolean }) {
  if (loading) {
    return (
      <Panel padded={false}>
        <SkeletonRows rows={3} />
      </Panel>
    );
  }

  const list = devices ?? [];

  return (
    <Panel padded={false}>
      <div className="px-4 pt-4">
        <PanelHeader title="Cameras" icon={Camera} />
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="No cameras configured"
          description="An administrator must register ANPR devices against a gate before captures can arrive."
        />
      ) : (
        <ul className="divide-y divide-white/5">
          {list.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-200">{device.code}</p>
                <p className="mt-0.5 truncate text-2xs text-muted-500">
                  {device.siteName} · {device.direction.toLowerCase()}
                  {device.provider === 'mock' ? ' · simulator' : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <StatusBadge status={device.status} />
                <span className="text-2xs text-muted-600">
                  {device.lastEventAt ? formatRelative(device.lastEventAt) : 'no captures'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Development capture simulator.
 *
 * Rendered only when the configured ANPR provider is the simulator, and the
 * endpoint behind it refuses to run against a live provider. It drives the
 * real ingestion path — de-duplication, confidence threshold, the gate
 * workflow — so what is exercised here is what runs in production.
 */
function SimulatorPanel({
  devices,
  onDecision,
}: {
  devices: string[];
  onDecision: (decision: GateDecision) => void;
}) {
  const simulate = useSimulateCapture();
  const [deviceCode, setDeviceCode] = useState(devices[0] ?? '');
  const [plate, setPlate] = useState('');
  const [confidence, setConfidence] = useState(0.97);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceCode && devices[0]) setDeviceCode(devices[0]);
  }, [devices, deviceCode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await simulate.mutateAsync({
        deviceCode,
        plateNumber: plate,
        confidence,
      });
      if (result.decision) onDecision(result.decision);
      else if (result.reviewReason) {
        onDecision({
          outcome: 'REVIEW_REQUIRED',
          vehicleId: null,
          sessionId: null,
          registrationNumber: plate,
          message: result.reviewReason,
          blockers: ['Capture requires manual review before the barrier opens.'],
          trace: ['Capture recorded and queued for review.'],
          rateResolved: false,
          financierName: null,
          contractCode: null,
        });
      }
      setPlate('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not simulate the capture.');
    }
  }

  return (
    <Panel className="border-dashed border-warn-500/25 bg-warn-500/[0.03]">
      <PanelHeader
        title="Simulate an arrival"
        subtitle="Development only — the ANPR simulator is the configured provider"
        icon={FlaskConical}
      />
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[9rem] flex-1">
          <label htmlFor="sim-device" className="label">Camera</label>
          <select
            id="sim-device"
            value={deviceCode}
            onChange={(event) => setDeviceCode(event.target.value)}
            className="input"
          >
            {devices.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </div>

        <div className="min-w-[9rem] flex-1">
          <label htmlFor="sim-plate" className="label">Plate</label>
          <input
            id="sim-plate"
            value={plate}
            onChange={(event) => setPlate(event.target.value.toUpperCase())}
            className="input font-mono"
            placeholder="TN 09 QQ 7788"
            required
          />
        </div>

        <div className="w-28">
          <label htmlFor="sim-conf" className="label">Confidence</label>
          <input
            id="sim-conf"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={confidence}
            onChange={(event) => setConfidence(Number(event.target.value))}
            className="input font-mono"
          />
        </div>

        <Button type="submit" variant="primary" loading={simulate.isPending} icon={ScanLine}>
          Capture
        </Button>
      </form>

      <p className="mt-2 text-2xs leading-relaxed text-muted-500">
        Set confidence below 0.85 to exercise the review queue. Sending the same plate twice within
        the de-duplication window is recognised as one arrival.
      </p>

      {error ? (
        <p className="mt-2 rounded-md bg-danger-500/10 px-3 py-2 text-xs text-danger-400 ring-1 ring-inset ring-danger-500/20">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
