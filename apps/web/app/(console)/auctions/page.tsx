'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Gavel, Users } from 'lucide-react';

import type { Paginated } from '@smartpark/contracts';
import { useQuery } from '@tanstack/react-query';

import { ApiError, api, qs } from '@/lib/api';
import { formatDateTime, formatMoney, formatPlate, humanise } from '@/lib/format';
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

interface AuctionListItem {
  id: string;
  code: string;
  title: string;
  status: string;
  siteName: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  currency: string;
  defaultMinIncrement: string;
  lotCount: number;
  registrationCount: number;
}

interface AuctionDetail extends Omit<AuctionListItem, 'lotCount' | 'registrationCount'> {
  description: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  registrationDeposit: string | null;
  termsAndConditions: string | null;
  lots: Array<{
    id: string;
    lotNumber: number;
    status: string;
    vehicleId: string;
    registrationNumber: string;
    make: string | null;
    model: string | null;
    reservePrice: string;
    minIncrement: string;
    highestBidAmount: string | null;
    bidCount: number;
    winnerName: string | null;
    settlementStatus: string | null;
    currency: string;
  }>;
  registrations: Array<{
    bidderId: string;
    bidderName: string;
    status: string;
    depositPaid: string;
  }>;
}

/**
 * Auction console.
 *
 * Lists auctions and, for a selected one, its lots with their live bid state
 * and settlement position. The bid ladder itself lives on the lot view, where
 * superseded bids are shown rather than hidden — they are the auction's
 * evidence, and the database refuses to delete them.
 */
export default function AuctionsPage() {
  const [selected, setSelected] = useState<string | null>(null);

  const auctions = useQuery({
    queryKey: ['auctions', { pageSize: 25 }],
    queryFn: () => api.get<Paginated<AuctionListItem>>(`/auctions${qs({ pageSize: 25 })}`),
  });

  const detail = useQuery({
    queryKey: ['auctions', selected],
    queryFn: () => api.get<AuctionDetail>(`/auctions/${selected}`),
    enabled: Boolean(selected),
  });

  return (
    <div className="space-y-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold tracking-wide text-white">Auctions</h1>
        <p className="mt-0.5 text-xs text-muted-500">
          Disposal of long-standing vehicles. Bids are immutable once placed.
        </p>
      </header>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel padded={false}>
          <div className="px-4 pt-4">
            <PanelHeader title="Auctions" icon={Gavel} />
          </div>
          {auctions.isLoading ? (
            <SkeletonRows rows={5} />
          ) : auctions.isError ? (
            <ErrorState
              message={auctions.error instanceof ApiError ? auctions.error.message : undefined}
              correlationId={
                auctions.error instanceof ApiError ? auctions.error.correlationId : undefined
              }
              onRetry={() => void auctions.refetch()}
            />
          ) : (auctions.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={Gavel}
              title="No auctions yet"
              description="An auction administrator creates an auction, adds long-standing vehicles as lots, then publishes it."
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {auctions.data?.items.map((auction) => (
                <li key={auction.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(auction.id)}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.025] ${
                      selected === auction.id ? 'bg-accent-500/10' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-200">{auction.title}</p>
                        <p className="mt-0.5 font-mono text-2xs text-muted-500">{auction.code}</p>
                      </div>
                      <StatusBadge status={auction.status} />
                    </div>
                    <p className="mt-1.5 text-2xs text-muted-500">
                      {auction.lotCount} lot{auction.lotCount === 1 ? '' : 's'} ·{' '}
                      {auction.registrationCount} registered bidder
                      {auction.registrationCount === 1 ? '' : 's'} ·{' '}
                      {formatDateTime(auction.scheduledStartAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel padded={false} className="xl:sticky xl:top-3 xl:self-start">
          {!selected ? (
            <div className="p-4">
              <PanelHeader title="Auction detail" icon={Gavel} />
              <EmptyState title="Select an auction" description="Choose one to see its lots, bidding and settlement." />
            </div>
          ) : detail.isLoading ? (
            <SkeletonRows rows={8} />
          ) : detail.data ? (
            <>
              <div className="p-4">
                <PanelHeader
                  title={detail.data.title}
                  subtitle={`${detail.data.code}${detail.data.siteName ? ` · ${detail.data.siteName}` : ''}`}
                  icon={Gavel}
                  action={<StatusBadge status={detail.data.status} />}
                />
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <Field label="Opens">{formatDateTime(detail.data.scheduledStartAt)}</Field>
                  <Field label="Closes">{formatDateTime(detail.data.scheduledEndAt)}</Field>
                  <Field label="Min increment" mono>
                    {formatMoney(detail.data.defaultMinIncrement, detail.data.currency)}
                  </Field>
                  <Field label="Deposit" mono>
                    {detail.data.registrationDeposit
                      ? formatMoney(detail.data.registrationDeposit, detail.data.currency)
                      : 'None'}
                  </Field>
                </dl>
              </div>

              <div className="border-t border-white/5 px-4 py-2">
                <p className="text-2xs uppercase tracking-wider text-muted-500">Lots</p>
              </div>
              {detail.data.lots.length === 0 ? (
                <EmptyState title="No lots yet" description="Vehicles must be added before the auction can be published." />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lot</th>
                      <th>Vehicle</th>
                      <th className="text-right">Reserve</th>
                      <th className="text-right">High bid</th>
                      <th className="text-right">Bids</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.lots.map((lot) => (
                      <tr key={lot.id}>
                        <td className="font-mono text-xs text-muted-400">#{lot.lotNumber}</td>
                        <td>
                          <Link
                            href={`/vehicles/${lot.vehicleId}`}
                            className="font-mono text-xs text-accent-400 hover:text-accent-300"
                          >
                            {formatPlate(lot.registrationNumber)}
                          </Link>
                          <span className="ml-1.5 text-2xs text-muted-600">
                            {[lot.make, lot.model].filter(Boolean).join(' ')}
                          </span>
                        </td>
                        <td className="text-right font-mono text-2xs tabular-nums text-muted-400">
                          {formatMoney(lot.reservePrice, lot.currency)}
                        </td>
                        <td className="text-right font-mono text-xs tabular-nums">
                          {lot.highestBidAmount ? formatMoney(lot.highestBidAmount, lot.currency) : '—'}
                        </td>
                        <td className="text-right font-mono text-2xs tabular-nums text-muted-400">
                          {lot.bidCount}
                        </td>
                        <td>
                          <div className="flex flex-col gap-0.5">
                            <StatusBadge status={lot.status} />
                            {lot.winnerName ? (
                              <span className="truncate text-2xs text-muted-500">{lot.winnerName}</span>
                            ) : null}
                            {lot.settlementStatus ? (
                              <Badge tone={lot.settlementStatus === 'RECEIVED' ? 'ok' : 'warn'}>
                                {humanise(lot.settlementStatus)}
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="border-t border-white/5 px-4 py-2">
                <p className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-muted-500">
                  <Users className="h-3 w-3" aria-hidden />
                  Registered bidders
                </p>
              </div>
              {detail.data.registrations.length === 0 ? (
                <EmptyState
                  title="No bidders registered"
                  description="Bidders must complete KYC approval and lodge the deposit before they can bid."
                />
              ) : (
                <ul className="divide-y divide-white/5">
                  {detail.data.registrations.map((registration) => (
                    <li
                      key={registration.bidderId}
                      className="flex items-center justify-between gap-2 px-4 py-2"
                    >
                      <span className="truncate text-xs text-slate-300">{registration.bidderName}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-2xs text-muted-500">
                          {formatMoney(registration.depositPaid, detail.data?.currency)}
                        </span>
                        <StatusBadge status={registration.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
