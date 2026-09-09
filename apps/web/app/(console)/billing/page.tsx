'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Banknote, CheckCircle2, FileText, Receipt, Search } from 'lucide-react';

import { Permission } from '@smartpark/contracts';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDate, formatMoney, formatPlate, humanise } from '@/lib/format';
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
import { useBillingActions, useInvoice, useInvoices } from '@/hooks/use-domain';

/**
 * Billing.
 *
 * The invoice detail deliberately shows two things most billing screens omit:
 * the rule that decided WHO was billed, and the charge engine's own narrative
 * for HOW the amount was reached. Both exist so a finance officer can answer a
 * financier's query without leaving the screen or calling support.
 */
export default function BillingPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const invoices = useInvoices({
    search: search.trim() || undefined,
    outstandingOnly: outstandingOnly || undefined,
    overdueOnly: overdueOnly || undefined,
    page,
    pageSize: 25,
  });

  return (
    <div className="space-y-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold tracking-wide text-white">Billing</h1>
        <p className="mt-0.5 text-xs text-muted-500">
          Invoices, payments and receivables. Amounts are computed server-side by the charge engine.
        </p>
      </header>

      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-600" aria-hidden />
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              className="input pl-9"
              placeholder="Invoice number, party or registration number"
              aria-label="Search invoices"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-400">
            <input
              type="checkbox"
              checked={outstandingOnly}
              onChange={(event) => { setOutstandingOnly(event.target.checked); setPage(1); }}
              className="h-3.5 w-3.5 rounded border-white/20 bg-base-900 text-accent-500 focus:ring-accent-400"
            />
            Outstanding only
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-400">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => { setOverdueOnly(event.target.checked); setPage(1); }}
              className="h-3.5 w-3.5 rounded border-white/20 bg-base-900 text-accent-500 focus:ring-accent-400"
            />
            Overdue only
          </label>
          {invoices.data ? (
            <span className="ml-auto text-2xs text-muted-500">
              {invoices.data.totalItems} invoice{invoices.data.totalItems === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel padded={false}>
          {invoices.isLoading ? (
            <SkeletonRows rows={8} />
          ) : invoices.isError ? (
            <ErrorState
              message={invoices.error instanceof ApiError ? invoices.error.message : undefined}
              correlationId={invoices.error instanceof ApiError ? invoices.error.correlationId : undefined}
              onRetry={() => void invoices.refetch()}
            />
          ) : (invoices.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={Receipt}
              title={outstandingOnly ? 'Nothing outstanding' : 'No invoices yet'}
              description={
                outstandingOnly
                  ? 'Every issued invoice has been settled.'
                  : 'Invoices are raised when a vehicle is released, from the frozen final charge.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th className="hidden lg:table-cell">Billed to</th>
                    <th className="hidden md:table-cell">Vehicle</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.data?.items.map((invoice) => (
                    <tr
                      key={invoice.id}
                      onClick={() => setSelected(invoice.id)}
                      className={selected === invoice.id ? 'cursor-pointer bg-accent-500/10' : 'cursor-pointer'}
                    >
                      <td>
                        <span className="font-mono text-xs text-accent-400">{invoice.invoiceNumber}</span>
                        {invoice.type !== 'PARKING' ? (
                          <Badge tone="info" className="ml-1.5">{humanise(invoice.type)}</Badge>
                        ) : null}
                        {invoice.isOverdue ? <Badge tone="danger" className="ml-1.5">Overdue</Badge> : null}
                      </td>
                      <td className="hidden max-w-[12rem] truncate text-xs lg:table-cell">
                        {invoice.billingPartyName}
                      </td>
                      <td className="hidden font-mono text-2xs text-muted-400 md:table-cell">
                        {invoice.registrationNumber ? formatPlate(invoice.registrationNumber) : '—'}
                      </td>
                      <td className="text-right font-mono text-xs tabular-nums">
                        {formatMoney(invoice.total, invoice.currency)}
                      </td>
                      <td
                        className={
                          Number(invoice.balance) > 0
                            ? 'text-right font-mono text-xs tabular-nums text-warn-400'
                            : 'text-right font-mono text-xs tabular-nums text-muted-500'
                        }
                      >
                        {formatMoney(invoice.balance, invoice.currency)}
                      </td>
                      <td><StatusBadge status={invoice.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {invoices.data && invoices.data.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
              <span className="text-2xs text-muted-500">
                Page {invoices.data.page} of {invoices.data.totalPages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={!invoices.data.hasPrevious} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <Button size="sm" variant="ghost" disabled={!invoices.data.hasNext} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          ) : null}
        </Panel>

        <InvoiceDetailPanel invoiceId={selected} canIssue={can(Permission['invoice:issue'])} canPay={can(Permission['payment:record'])} />
      </div>
    </div>
  );
}

function InvoiceDetailPanel({
  invoiceId,
  canIssue,
  canPay,
}: {
  invoiceId: string | null;
  canIssue: boolean;
  canPay: boolean;
}) {
  const invoice = useInvoice(invoiceId);
  const actions = useBillingActions();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!invoiceId) {
    return (
      <Panel className="xl:sticky xl:top-3 xl:self-start">
        <PanelHeader title="Invoice" icon={FileText} />
        <EmptyState title="Select an invoice" description="Choose a row to see its lines, workings and payments." />
      </Panel>
    );
  }
  if (invoice.isLoading) {
    return <Panel padded={false} className="xl:sticky xl:top-3 xl:self-start"><SkeletonRows rows={8} /></Panel>;
  }
  if (!invoice.data) return null;

  const data = invoice.data;

  async function issue() {
    setError(null);
    try {
      await actions.issue.mutateAsync(data.id);
      void invoice.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not issue the invoice.');
    }
  }

  async function pay() {
    setError(null);
    try {
      await actions.recordPayment.mutateAsync({
        invoiceId: data.id,
        amount,
        method,
        reference: reference || undefined,
        // Deterministic per invoice+amount+reference, so a double-click cannot
        // credit the invoice twice.
        idempotencyKey: `ui:${data.id}:${amount}:${reference}`,
      });
      setAmount('');
      setReference('');
      void invoice.refetch();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not record the payment.');
    }
  }

  const payable = ['ISSUED', 'SENT', 'PARTIALLY_PAID'].includes(data.status);

  return (
    <Panel className="xl:sticky xl:top-3 xl:self-start">
      <PanelHeader
        title={data.invoiceNumber}
        subtitle={`${humanise(data.type)} · ${data.siteName}`}
        icon={FileText}
        action={<StatusBadge status={data.status} />}
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Billed to">{data.billingPartyName}</Field>
        <Field label="Party type">{humanise(data.billingPartyType)}</Field>
        <Field label="Issued">{formatDate(data.issueDate)}</Field>
        <Field label="Due">{formatDate(data.dueDate)}</Field>
        <Field label="Vehicle" mono>
          {data.registrationNumber ? formatPlate(data.registrationNumber) : '—'}
        </Field>
        <Field label="Stay" mono>{data.sessionNumber ?? '—'}</Field>
      </dl>

      {/* Why this party. */}
      {data.billingRuleCode ? (
        <div className="mt-3 rounded-md bg-base-900 px-3 py-2">
          <p className="text-2xs uppercase tracking-wider text-muted-500">Billing rule applied</p>
          <p className="mt-0.5 text-xs text-slate-300">
            <span className="font-mono text-accent-400">{data.billingRuleCode}</span> — {data.billingRuleName}
          </p>
        </div>
      ) : null}

      <table className="data-table mt-3">
        <tbody>
          {data.lines.map((line) => (
            <tr key={line.lineNo}>
              <td className="text-xs">{line.description}</td>
              <td className="text-right font-mono text-xs tabular-nums">{formatMoney(line.amount, data.currency)}</td>
            </tr>
          ))}
          {data.taxLines.map((line) => (
            <tr key={line.sequence}>
              <td className="text-xs text-muted-400">{line.name}</td>
              <td className="text-right font-mono text-xs tabular-nums text-muted-400">
                {formatMoney(line.amount, data.currency)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="text-xs font-semibold text-white">Total</td>
            <td className="text-right font-mono text-sm font-semibold tabular-nums text-white">
              {formatMoney(data.total, data.currency)}
            </td>
          </tr>
          <tr>
            <td className="text-xs text-muted-400">Paid</td>
            <td className="text-right font-mono text-xs tabular-nums text-ok-400">
              {formatMoney(data.amountPaid, data.currency)}
            </td>
          </tr>
          <tr>
            <td className="text-xs font-medium text-slate-300">Balance</td>
            <td
              className={
                Number(data.balance) > 0
                  ? 'text-right font-mono text-sm font-semibold tabular-nums text-warn-400'
                  : 'text-right font-mono text-sm font-semibold tabular-nums text-ok-400'
              }
            >
              {formatMoney(data.balance, data.currency)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* How the amount was reached. */}
      {data.chargeExplanation.length > 0 ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-2xs uppercase tracking-wider text-muted-500 hover:text-muted-400">
            How this amount was calculated
          </summary>
          <ol className="mt-2 space-y-1 border-l border-white/10 pl-3">
            {data.chargeExplanation.map((line, index) => (
              <li key={index} className="text-2xs leading-relaxed text-muted-400">{line}</li>
            ))}
          </ol>
          {data.chargeInputsHash ? (
            <p className="mt-2 font-mono text-2xs text-muted-600">
              engine {data.chargeEngineVersion} · hash {data.chargeInputsHash.slice(0, 20)}…
            </p>
          ) : null}
        </details>
      ) : null}

      {data.payments.length > 0 ? (
        <div className="mt-3">
          <p className="text-2xs uppercase tracking-wider text-muted-500">Payments</p>
          <ul className="mt-1 space-y-1">
            {data.payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-2 text-2xs">
                <span className="text-muted-400">
                  {humanise(payment.method)}
                  {payment.reference ? ` · ${payment.reference}` : ''}
                </span>
                <span className="font-mono text-slate-300">{formatMoney(payment.amount, data.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-md bg-danger-500/10 px-3 py-2 text-xs text-danger-400 ring-1 ring-inset ring-danger-500/20">
          {error}
        </p>
      ) : null}

      {data.status === 'GENERATED' && canIssue ? (
        <Button variant="primary" className="mt-3 w-full" loading={actions.issue.isPending} onClick={() => void issue()}>
          Issue invoice
        </Button>
      ) : null}

      {payable && canPay ? (
        <div className="mt-3 space-y-2 rounded-md bg-base-900 p-3">
          <p className="text-2xs uppercase tracking-wider text-muted-500">Record a payment</p>
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="input font-mono"
              placeholder={data.balance}
              aria-label="Amount"
            />
            <select value={method} onChange={(event) => setMethod(event.target.value)} className="input w-40">
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="UPI">UPI</option>
              <option value="CHEQUE">Cheque</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
            </select>
          </div>
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className="input"
            placeholder="UTR / cheque / receipt reference"
            aria-label="Reference"
          />
          <Button
            variant="primary"
            className="w-full"
            icon={Banknote}
            loading={actions.recordPayment.isPending}
            disabled={!amount}
            onClick={() => void pay()}
          >
            Record payment
          </Button>
        </div>
      ) : null}

      {data.status === 'PAID' ? (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-ok-500/10 px-3 py-2 ring-1 ring-inset ring-ok-500/20">
          <CheckCircle2 className="h-3.5 w-3.5 text-ok-400" aria-hidden />
          <p className="text-xs text-ok-400">Settled in full.</p>
        </div>
      ) : null}
    </Panel>
  );
}
