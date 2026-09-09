'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Car, Search } from 'lucide-react';

import { ApiError } from '@/lib/api';
import { formatAgeing, formatPlate, formatRelative, humanise } from '@/lib/format';
import {
  Badge,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonRows,
  StatusBadge,
} from '@/components/ui/primitives';
import { useVehicles } from '@/hooks/use-domain';

/**
 * The central vehicle repository.
 *
 * Search accepts a registration number in any format - the server normalises
 * it, so "TN 09 QQ 7788", "tn-09-qq-7788" and "TN09QQ7788" all find the same
 * vehicle.
 *
 * For a financier portal user the API narrows this list to their own financed
 * vehicles and masks owner names. That happens server-side; this screen simply
 * renders what it is given.
 */
export default function VehiclesPage() {
  const [search, setSearch] = useState('');
  const [onSiteOnly, setOnSiteOnly] = useState(false);
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const vehicles = useVehicles({
    search: search.trim() || undefined,
    onSiteOnly: onSiteOnly || undefined,
    unmatchedFinancier: unmatchedOnly || undefined,
    page,
    pageSize: 25,
  });

  return (
    <div className="space-y-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold tracking-wide text-white">Vehicles</h1>
        <p className="mt-0.5 text-xs text-muted-500">
          Every vehicle seen at any Sri JP location. One record per registration number.
        </p>
      </header>

      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-600" aria-hidden />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="input pl-9"
              placeholder="Registration number, make or model"
              aria-label="Search vehicles"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-400">
            <input
              type="checkbox"
              checked={onSiteOnly}
              onChange={(event) => {
                setOnSiteOnly(event.target.checked);
                setPage(1);
              }}
              className="h-3.5 w-3.5 rounded border-white/20 bg-base-900 text-accent-500 focus:ring-accent-400"
            />
            On site now
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-400">
            <input
              type="checkbox"
              checked={unmatchedOnly}
              onChange={(event) => {
                setUnmatchedOnly(event.target.checked);
                setPage(1);
              }}
              className="h-3.5 w-3.5 rounded border-white/20 bg-base-900 text-accent-500 focus:ring-accent-400"
            />
            No financier matched
          </label>

          {vehicles.data ? (
            <span className="ml-auto text-2xs text-muted-500">
              {vehicles.data.totalItems} vehicle{vehicles.data.totalItems === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      </Panel>

      <Panel padded={false}>
        {vehicles.isLoading ? (
          <SkeletonRows rows={8} />
        ) : vehicles.isError ? (
          <ErrorState
            message={vehicles.error instanceof ApiError ? vehicles.error.message : undefined}
            correlationId={vehicles.error instanceof ApiError ? vehicles.error.correlationId : undefined}
            onRetry={() => void vehicles.refetch()}
          />
        ) : (vehicles.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={Car}
            title={search ? `No vehicle matches "${search}"` : 'No vehicles yet'}
            description={
              search
                ? 'Registration numbers are matched in any format, so check the characters rather than the spacing.'
                : 'Vehicles appear here the first time a camera reads their plate at any Sri JP location.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Registration</th>
                  <th className="hidden sm:table-cell">Vehicle</th>
                  <th className="hidden lg:table-cell">Financier</th>
                  <th>Status</th>
                  <th className="hidden md:table-cell">Location</th>
                  <th className="hidden xl:table-cell">Registry</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.data?.items.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>
                      <Link
                        href={`/vehicles/${vehicle.id}`}
                        className="font-mono text-xs font-medium text-accent-400 hover:text-accent-300"
                      >
                        {formatPlate(vehicle.registrationNumber)}
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell">
                      <span className="text-xs text-slate-300">
                        {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}
                      </span>
                      <span className="ml-1.5 text-2xs text-muted-600">
                        {humanise(vehicle.vehicleClass)}
                      </span>
                    </td>
                    <td className="hidden max-w-[12rem] truncate lg:table-cell">
                      {vehicle.financierName ?? (
                        <Badge tone="warn">Unmatched</Badge>
                      )}
                    </td>
                    <td><StatusBadge status={vehicle.status} /></td>
                    <td className="hidden text-xs text-muted-400 md:table-cell">
                      {vehicle.siteName ?? '—'}
                    </td>
                    <td className="hidden xl:table-cell">
                      <StatusBadge status={vehicle.vahanVerificationStatus} />
                    </td>
                    <td className="whitespace-nowrap text-2xs text-muted-400">
                      {formatRelative(vehicle.lastSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {vehicles.data && vehicles.data.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
            <span className="text-2xs text-muted-500">
              Page {vehicles.data.page} of {vehicles.data.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!vehicles.data.hasPrevious}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded px-2 py-1 text-2xs text-muted-400 hover:bg-white/5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!vehicles.data.hasNext}
                onClick={() => setPage((current) => current + 1)}
                className="rounded px-2 py-1 text-2xs text-muted-400 hover:bg-white/5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
