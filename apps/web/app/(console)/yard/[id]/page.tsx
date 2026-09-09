'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Lock,
  LogOut,
  MapPin,
  Receipt,
  Unlock,
  XCircle,
} from 'lucide-react';

import { Permission } from '@smartpark/contracts';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatAgeing, formatDateTime, formatMoney, formatPlate, humanise } from '@/lib/format';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  PanelHeader,
  SkeletonRows,
  StatusBadge,
} from '@/components/ui/primitives';
import {
  useEligibility,
  useRelease,
  useReleaseActions,
  useReleases,
  useSession,
  useSessionAction,
  useSessionCharge,
} from '@/hooks/use-domain';

/**
 * A single stay, and the actions available on it.
 *
 * Actions are both permission-aware and state-aware: an operator is never
 * shown a button the server would reject. The release panel is the centre of
 * the screen because it is the workflow that ends the stay and generates the
 * money.
 */
export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const session = useSession(id);
  const charge = useSessionCharge(id);
  const actions = useSessionAction(id);

  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (session.isLoading) {
    return <div className="p-3"><Panel padded={false}><SkeletonRows rows={8} /></Panel></div>;
  }
  if (session.isError || !session.data) {
    const error = session.error;
    return (
      <div className="p-3">
        <Panel>
          <ErrorState
            title={error instanceof ApiError && error.status === 404 ? 'Stay not found' : 'Could not load the stay'}
            message={error instanceof ApiError ? error.message : undefined}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        </Panel>
      </div>
    );
  }

  const data = session.data;
  const isOpen = ['OPEN', 'ON_HOLD', 'PENDING_EXIT'].includes(data.status);

  async function run(action: 'hold' | 'liftHold' | 'attachRate') {
    setError(null);
    if (!reason.trim()) {
      setError('A reason is required and is recorded in the audit trail.');
      return;
    }
    try {
      await actions[action].mutateAsync(reason);
      setReason('');
      void session.refetch();
      void charge.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The action failed.');
    }
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <Link href="/yard" className="text-muted-500 hover:text-slate-300" aria-label="Back to yard">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-mono text-lg font-semibold tracking-widest text-white">
          {formatPlate(data.registrationNumber)}
        </h1>
        <StatusBadge status={data.status} />
        {data.rateUnresolved ? <Badge tone="warn">No rate attached</Badge> : null}
        <span className="ml-auto font-mono text-2xs text-muted-500">{data.sessionNumber}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="Stay" icon={MapPin} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field label="Site">{data.siteName}</Field>
              <Field label="Zone / bay">
                {data.zoneName ? `${data.zoneName}${data.spaceCode ? ` · ${data.spaceCode}` : ''}` : 'Not allocated'}
              </Field>
              <Field label="Mode">{humanise(data.parkingMode)}</Field>
              <Field label="Entered">{formatDateTime(data.entryAt)}</Field>
              <Field label="Ageing" tone="strong">{formatAgeing(data.ageingDays)}</Field>
              <Field label="Admitted by">{humanise(data.admissionMethod)}</Field>
              <Field label="Financier">
                <Link href={`/vehicles/${data.vehicleId}`} className="text-accent-400 hover:text-accent-300">
                  {data.financierName ?? 'Unmatched'}
                </Link>
              </Field>
              <Field label="Contract">{data.contractCode ?? '—'}</Field>
              <Field label="Rate plan">{data.ratePlanCode ?? '—'}</Field>
            </dl>

            {data.holdReason ? (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-warn-500/10 px-3 py-2 ring-1 ring-inset ring-warn-500/20">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-400" aria-hidden />
                <p className="text-xs leading-relaxed text-warn-400">
                  <span className="font-medium">Hold in force.</span> {data.holdReason}
                </p>
              </div>
            ) : null}
          </Panel>

          {/* Charge */}
          <Panel>
            <PanelHeader title="Charge" subtitle="Computed by the charge engine" icon={Receipt} />
            {charge.isLoading ? (
              <SkeletonRows rows={3} />
            ) : charge.data?.breakdown ? (
              <>
                <p className="font-mono text-2xl font-semibold text-white">
                  {formatMoney(charge.data.breakdown.total, charge.data.breakdown.currency)}
                </p>
                <p className="mt-1 text-2xs text-muted-500">
                  subtotal {formatMoney(charge.data.breakdown.subtotal)} + tax{' '}
                  {formatMoney(charge.data.breakdown.taxTotal)} ·{' '}
                  {charge.data.breakdown.chargeableUnits} chargeable{' '}
                  {charge.data.breakdown.billingUnit.replace('_', ' ').toLowerCase()}s
                </p>

                <table className="data-table mt-3">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th className="text-right">Units</th>
                      <th className="text-right">Rate</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charge.data.breakdown.lines.map((line) => (
                      <tr key={line.lineNo}>
                        <td className="text-xs">{line.description}</td>
                        <td className="text-right font-mono text-2xs tabular-nums text-muted-400">
                          {Number(line.units).toFixed(0)}
                        </td>
                        <td className="text-right font-mono text-2xs tabular-nums text-muted-400">
                          {formatMoney(line.unitAmount)}
                        </td>
                        <td className="text-right font-mono text-xs tabular-nums">{formatMoney(line.amount)}</td>
                      </tr>
                    ))}
                    {charge.data.breakdown.taxLines.map((line) => (
                      <tr key={`tax-${line.lineNo}`}>
                        <td className="text-xs text-muted-400">{line.description}</td>
                        <td />
                        <td />
                        <td className="text-right font-mono text-xs tabular-nums text-muted-400">
                          {formatMoney(line.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="mt-2 font-mono text-2xs text-muted-600">
                  engine {charge.data.breakdown.engineVersion} · hash{' '}
                  {charge.data.breakdown.inputsHash.slice(0, 20)}…
                </p>
              </>
            ) : (
              <EmptyState
                icon={AlertTriangle}
                title="No charge can be computed"
                description={charge.data?.unavailableReason ?? 'No rate plan is attached to this stay.'}
                action={
                  can(Permission['charge:recalculate']) && data.rateUnresolved ? (
                    <p className="text-2xs text-muted-500">Attach a rate below to price this stay.</p>
                  ) : undefined
                }
              />
            )}
          </Panel>

          {/* Operational actions */}
          {isOpen ? (
            <Panel>
              <PanelHeader title="Actions" subtitle="Every action requires a reason and is audited" />
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="input"
                placeholder="Reason (recorded in the audit trail)"
              />
              {error ? (
                <p className="mt-2 rounded-md bg-danger-500/10 px-3 py-2 text-xs text-danger-400 ring-1 ring-inset ring-danger-500/20">
                  {error}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {can(Permission['session:hold']) && data.status === 'OPEN' ? (
                  <Button size="sm" icon={Lock} loading={actions.hold.isPending} onClick={() => void run('hold')}>
                    Place hold
                  </Button>
                ) : null}
                {can(Permission['session:hold']) && data.status === 'ON_HOLD' ? (
                  <Button size="sm" icon={Unlock} loading={actions.liftHold.isPending} onClick={() => void run('liftHold')}>
                    Lift hold
                  </Button>
                ) : null}
                {can(Permission['charge:recalculate']) && data.rateUnresolved ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={Receipt}
                    loading={actions.attachRate.isPending}
                    onClick={() => void run('attachRate')}
                  >
                    Attach contract rate
                  </Button>
                ) : null}
              </div>
            </Panel>
          ) : null}
        </div>

        <ReleasePanel sessionId={id} sessionOpen={isOpen} />
      </div>
    </div>
  );
}

/**
 * Release workflow.
 *
 * Shows the eligibility checks the server actually ran, then the step the
 * release is at. The authorisation code is displayed exactly once, when it is
 * issued — it is stored only as a hash and cannot be recovered.
 */
function ReleasePanel({ sessionId, sessionOpen }: { sessionId: string; sessionOpen: boolean }) {
  const { can, user } = useAuth();
  const eligibility = useEligibility(sessionOpen ? sessionId : null);
  const releases = useReleases({ pageSize: 5 });
  const actions = useReleaseActions();

  const existing = releases.data?.items.find(
    (release) => release.sessionId === sessionId && release.status !== 'COMPLETED' && release.status !== 'CANCELLED' && release.status !== 'REJECTED',
  );
  const detail = useRelease(existing?.id ?? null);

  const [reason, setReason] = useState('');
  const [partyType, setPartyType] = useState<'FINANCIER' | 'CUSTOMER'>('FINANCIER');
  const [customerName, setCustomerName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function request() {
    setError(null);
    try {
      await actions.request.mutateAsync({
        sessionId,
        reason,
        requestedForPartyType: partyType,
        ...(partyType === 'CUSTOMER' ? { requestedForName: customerName } : {}),
      });
      setReason('');
      void releases.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not raise the release request.');
    }
  }

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    if (!existing) return;
    setError(null);
    try {
      const outcome = await actions.decide.mutateAsync({ releaseId: existing.id, decision, remarks });
      setRemarks('');
      if (outcome.authorizationCode) setIssuedCode(outcome.authorizationCode);
      void releases.refetch();
      void detail.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The decision could not be recorded.');
    }
  }

  async function complete() {
    if (!existing) return;
    setError(null);
    try {
      const outcome = await actions.complete.mutateAsync({
        releaseId: existing.id,
        authorizationCode: authCode || undefined,
      });
      setResult(
        outcome.invoiceNumber
          ? `Vehicle exited. Invoice ${outcome.invoiceNumber} raised.`
          : 'Vehicle exited.',
      );
      setAuthCode('');
      setIssuedCode(null);
      void releases.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The release could not be completed.');
    }
  }

  if (!sessionOpen && !existing) {
    return (
      <Panel>
        <PanelHeader title="Release" icon={LogOut} />
        <EmptyState icon={CheckCircle2} title="This stay is closed" description="The vehicle has already left." />
      </Panel>
    );
  }

  return (
    <Panel className="lg:sticky lg:top-3 lg:self-start">
      <PanelHeader
        title="Release"
        icon={LogOut}
        action={existing ? <StatusBadge status={existing.status} /> : undefined}
      />

      {result ? (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-ok-500/10 px-3 py-2 ring-1 ring-inset ring-ok-500/20">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-400" aria-hidden />
          <p className="text-xs text-ok-400">{result}</p>
        </div>
      ) : null}

      {/* Eligibility, as the server evaluated it. */}
      {!existing && eligibility.data ? (
        <div className="mb-3 space-y-1.5 rounded-md bg-base-900 p-3">
          <p className="text-2xs uppercase tracking-wider text-muted-500">
            Eligibility · {eligibility.data.eligible ? 'clear' : 'blocked'}
          </p>
          {eligibility.data.checks.map((check) => (
            <div key={check.code} className="flex items-start gap-2">
              {check.passed ? (
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-ok-400" aria-hidden />
              ) : (
                <XCircle className={`mt-0.5 h-3 w-3 shrink-0 ${check.blocking ? 'text-danger-400' : 'text-warn-400'}`} aria-hidden />
              )}
              <p className={`text-2xs leading-relaxed ${check.passed ? 'text-muted-400' : check.blocking ? 'text-danger-400' : 'text-warn-400'}`}>
                <span className="font-medium">{check.label}.</span> {check.detail}
              </p>
            </div>
          ))}
          {eligibility.data.finalChargeTotal ? (
            <p className="pt-1 text-2xs text-muted-400">
              Estimated final charge{' '}
              <span className="font-mono text-slate-300">
                {formatMoney(eligibility.data.finalChargeTotal, eligibility.data.currency)}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mb-3 rounded-md bg-danger-500/10 px-3 py-2 text-xs text-danger-400 ring-1 ring-inset ring-danger-500/20">
          {error}
        </p>
      ) : null}

      {/* Step 1: request */}
      {!existing && can(Permission['release:request']) ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="party" className="label">Collected by</label>
            <select
              id="party"
              value={partyType}
              onChange={(event) => setPartyType(event.target.value as 'FINANCIER' | 'CUSTOMER')}
              className="input"
            >
              <option value="FINANCIER">Financier</option>
              <option value="CUSTOMER">Customer</option>
            </select>
          </div>
          {partyType === 'CUSTOMER' ? (
            <div>
              <label htmlFor="cust" className="label">Customer name</label>
              <input id="cust" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="input" />
            </div>
          ) : null}
          <div>
            <label htmlFor="rel-reason" className="label">Reason (audited)</label>
            <input
              id="rel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="input"
              placeholder="Financier has settled and arranged collection."
            />
          </div>
          <Button
            variant="primary"
            className="w-full"
            loading={actions.request.isPending}
            disabled={reason.trim().length < 5}
            onClick={() => void request()}
          >
            Request release
          </Button>
        </div>
      ) : null}

      {/* Step 2: decision */}
      {existing && (existing.status === 'AWAITING_APPROVAL' || existing.status === 'AWAITING_PAYMENT') ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Request" mono>{existing.requestNumber}</Field>
            <Field label="Requested">{formatDateTime(existing.requestedAt)}</Field>
          </dl>

          {can(Permission['release:approve']) ? (
            existing.requestedById === user?.id ? (
              <p className="rounded-md bg-warn-500/10 px-3 py-2 text-2xs leading-relaxed text-warn-400 ring-1 ring-inset ring-warn-500/20">
                You raised this request, so you cannot approve it. Segregation of duty requires a
                different approver.
              </p>
            ) : (
              <>
                <div>
                  <label htmlFor="remarks" className="label">Remarks (audited)</label>
                  <input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="input" />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    className="flex-1"
                    loading={actions.decide.isPending}
                    disabled={remarks.trim().length < 3}
                    onClick={() => void decide('APPROVED')}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    loading={actions.decide.isPending}
                    disabled={remarks.trim().length < 3}
                    onClick={() => void decide('REJECTED')}
                  >
                    Reject
                  </Button>
                </div>
              </>
            )
          ) : (
            <p className="text-2xs text-muted-500">Awaiting approval by an authorised user.</p>
          )}
        </div>
      ) : null}

      {/* The code, shown exactly once. */}
      {issuedCode ? (
        <div className="mt-3 rounded-md bg-ok-500/10 p-3 text-center ring-1 ring-inset ring-ok-500/25">
          <p className="text-2xs uppercase tracking-wider text-ok-400">Gate authorisation code</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-white">{issuedCode}</p>
          <p className="mt-1 text-2xs leading-relaxed text-muted-400">
            Shown once only. Only a hash is stored, so it cannot be recovered — write it down or
            hand it to the gate now.
          </p>
        </div>
      ) : null}

      {/* Step 3: complete at the gate */}
      {existing && existing.status === 'APPROVED' && can(Permission['release:execute']) ? (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="code" className="label">Gate authorisation code</label>
            <input
              id="code"
              value={authCode}
              onChange={(event) => setAuthCode(event.target.value)}
              className="input text-center font-mono text-lg tracking-[0.3em]"
              placeholder="000000"
              inputMode="numeric"
            />
          </div>
          <Button
            variant="primary"
            className="w-full"
            icon={LogOut}
            loading={actions.complete.isPending}
            onClick={() => void complete()}
          >
            Record exit and raise invoice
          </Button>
          <p className="text-2xs leading-relaxed text-muted-500">
            This closes the stay, freezes the final charge to the actual exit time, raises the
            invoice and frees the bay.
          </p>
        </div>
      ) : null}

      {/* Outcome */}
      {detail.data?.invoiceNumber ? (
        <div className="mt-3 rounded-md bg-base-900 p-3">
          <p className="text-2xs uppercase tracking-wider text-muted-500">Invoice</p>
          <Link
            href={`/billing?search=${detail.data.invoiceNumber}`}
            className="mt-1 flex items-center gap-1.5 font-mono text-sm text-accent-400 hover:text-accent-300"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            {detail.data.invoiceNumber}
          </Link>
          <p className="mt-1 text-2xs text-muted-500">
            {formatMoney(detail.data.invoiceTotal)} · balance {formatMoney(detail.data.invoiceBalance)} ·{' '}
            {detail.data.invoiceStatus}
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
