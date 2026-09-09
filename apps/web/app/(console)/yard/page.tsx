'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Search, Truck } from 'lucide-react';

import { ApiError } from '@/lib/api';
import { formatAgeing, formatDateTime, formatPlate } from '@/lib/format';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonRows,
  StatusBadge,
} from '@/components/ui/primitives';
import { useSessions } from '@/hooks/use-domain';

/**
 * Yard operations: every stay, with the two work queues that matter surfaced
 * as filters — stays with no rate attached, and stays that have aged past the
 * review threshold.
 */
export default function YardPage() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [rateUnresolvedOnly, setRateUnresolvedOnly] = useState(
    searchParams.get('rateUnresolvedOnly') === 'true',
  );
  const [agedOnly, setAgedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const sessions = useSessions(
    {
      status: ['OPEN', 'ON_HOLD', 'PENDING_EXIT'],
      search: search.trim() || undefined,
      rateUnresolvedOnly: rateUnresolvedOnly || undefined,
      minAgeingDays: agedOnly ? 90 : undefined,
      page,
      pageSize: 25,
      sortBy: 'entryAt',
      sortDir: 'asc',
    },
    { refetchInterval: 20_000 },
  );

  return (
    <div className="space-y-3 p-3">
      <header className="px-1">
        <h1 className="text-base font-semibold tracking-wide text-white">Yard</h1>
        <p className="mt-0.5 text-xs text-muted-500">
          Vehicles currently on site, oldest first.
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
              placeholder="Stay number or registration number"
              aria-label="Search stays"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-400">
            <input
              type="checkbox"
              checked={rateUnresolvedOnly}
              onChange={(event) => { setRateUnresolvedOnly(event.target.checked); setPage(1); }}
              className="h-3.5 w-3.5 rounded border-white/20 bg-base-900 text-accent-500 focus:ring-accent-400"
            />
            No rate attached
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-400">
            <input
              type="checkbox"
              checked={agedOnly}
              onChange={(event) => { setAgedOnly(event.target.checked); setPage(1); }}
              className="h-3.5 w-3.5 rounded border-white/20 bg-base-900 text-accent-500 focus:ring-accent-400"
            />
            Over 90 days
          </label>

          {sessions.data ? (
            <span className="ml-auto text-2xs text-muted-500">
              {sessions.data.totalItems} stay{sessions.data.totalItems === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      </Panel>

      <Panel padded={false}>
        {sessions.isLoading ? (
          <SkeletonRows rows={8} />
        ) : sessions.isError ? (
          <ErrorState
            message={sessions.error instanceof ApiError ? sessions.error.message : undefined}
            correlationId={sessions.error instanceof ApiError ? sessions.error.correlationId : undefined}
            onRetry={() => void sessions.refetch()}
          />
        ) : (sessions.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={Truck}
            title={
              rateUnresolvedOnly
                ? 'No stays are missing a rate'
                : agedOnly
                  ? 'No vehicle has been here longer than 90 days'
                  : 'No vehicles on site'
            }
            description={
              rateUnresolvedOnly
                ? 'Every open stay has a contract rate attached.'
                : 'Vehicles appear here once admitted through a gate.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Registration</th>
                  <th className="hidden md:table-cell">Stay</th>
                  <th className="hidden lg:table-cell">Financier</th>
                  <th>Site / bay</th>
                  <th>Entered</th>
                  <th>Ageing</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data?.items.map((session) => (
                  <tr key={session.id}>
                    <td>
                      <Link
                        href={`/yard/${session.id}`}
                        className="font-mono text-xs font-medium text-accent-400 hover:text-accent-300"
                      >
                        {formatPlate(session.registrationNumber)}
                      </Link>
                      <span className="ml-2 text-2xs text-muted-600">
                        {[session.make, session.model].filter(Boolean).join(' ')}
                      </span>
                    </td>
                    <td className="hidden font-mono text-2xs text-muted-400 md:table-cell">
                      {session.sessionNumber}
                    </td>
                    <td className="hidden max-w-[10rem] truncate text-xs lg:table-cell">
                      {session.financierName ?? <Badge tone="warn">Unmatched</Badge>}
                    </td>
                    <td className="text-xs text-muted-400">
                      {session.siteName}
                      {session.spaceCode ? (
                        <span className="ml-1.5 font-mono text-2xs text-muted-500">
                          {session.spaceCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap text-2xs text-muted-400">
                      {formatDateTime(session.entryAt)}
                    </td>
                    <td className="whitespace-nowrap">
                      <span
                        className={
                          session.ageingDays > 180
                            ? 'text-xs font-medium text-danger-400'
                            : session.ageingDays > 90
                              ? 'text-xs font-medium text-warn-400'
                              : 'text-xs text-muted-300'
                        }
                      >
                        {formatAgeing(session.ageingDays)}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={session.status} />
                        {session.rateUnresolved ? (
                          <span title="No rate attached">
                            <AlertTriangle className="h-3.5 w-3.5 text-warn-400" aria-hidden />
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sessions.data && sessions.data.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
            <span className="text-2xs text-muted-500">
              Page {sessions.data.page} of {sessions.data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={!sessions.data.hasPrevious} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button size="sm" variant="ghost" disabled={!sessions.data.hasNext} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
