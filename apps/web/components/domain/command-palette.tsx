'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Car,
  CornerDownLeft,
  Gavel,
  LayoutDashboard,
  Loader2,
  Radio,
  Receipt,
  Search,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Permission } from '@smartpark/contracts';

import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-context';
import { useVehicleSearch } from '@/hooks/use-domain';
import { formatAgeing, formatPlate } from '@/lib/format';
import { StatusBadge } from '@/components/ui/primitives';

/**
 * Global search and command palette.
 *
 * One surface, because to an operator they are the same gesture: press a key,
 * type, go somewhere. Splitting them would mean learning two shortcuts for
 * "find the thing".
 *
 * The search half is the most important interaction in a vehicle-centric
 * system, so it is built around how a plate is actually typed: separators are
 * ignored, so `TN 09 QQ 7788`, `tn09qq7788` and `TN-09-QQ-7788` all resolve to
 * the same vehicle. Results are the API's, narrowed by the caller's own scope -
 * a financier searching another financier's plate finds nothing, because the
 * server returns nothing.
 *
 * Navigation commands are filtered by the same permission catalogue the API
 * enforces, so the palette never offers a destination that would 403.
 */

const OPEN_KEY = 'k';
const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  href: string;
  permissions: string[];
}

const COMMANDS: Command[] = [
  {
    id: 'gate',
    label: 'Open gate operations',
    hint: 'Capture, identify and admit',
    icon: Radio,
    href: '/gate',
    permissions: [Permission['session:admit'], Permission['anpr:event:read']],
  },
  {
    id: 'yard',
    label: 'Open live yard',
    hint: 'Occupancy, zones and stays',
    icon: Truck,
    href: '/yard',
    permissions: [Permission['session:read']],
  },
  {
    id: 'vehicles',
    label: 'Open vehicles',
    hint: 'Central vehicle repository',
    icon: Car,
    href: '/vehicles',
    permissions: [Permission['vehicle:read']],
  },
  {
    id: 'dashboard',
    label: 'Open operations overview',
    hint: 'Capacity, ageing and exposure',
    icon: LayoutDashboard,
    href: '/dashboard',
    permissions: [Permission['report:operations'], Permission['report:finance']],
  },
  {
    id: 'billing',
    label: 'Open invoices and payments',
    hint: 'Billing and settlement',
    icon: Receipt,
    href: '/billing',
    permissions: [Permission['invoice:read'], Permission['payment:read']],
  },
  {
    id: 'auctions',
    label: 'Open auctions',
    hint: 'Disposal pipeline',
    icon: Gavel,
    href: '/auctions',
    permissions: [Permission['auction:read']],
  },
  {
    id: 'users',
    label: 'Open users and roles',
    hint: 'Access administration',
    icon: Users,
    href: '/users',
    permissions: [Permission['user:read']],
  },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Debounced so a fast typist does not fire a request per keystroke.
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setActive(0);
      // A frame later, so the input exists to receive focus.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const permitted = React.useMemo(
    () => COMMANDS.filter((command) => command.permissions.some((p) => user?.permissions.includes(p))),
    [user],
  );

  const matchingCommands = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return permitted;
    return permitted.filter(
      (command) =>
        command.label.toLowerCase().includes(term) || command.hint.toLowerCase().includes(term),
    );
  }, [permitted, query]);

  // A plate is typed with spaces and dashes; the index is not.
  const searchTerm = debounced.replace(/[^A-Za-z0-9]/g, '');
  const vehicles = useVehicleSearch(searchTerm.length >= MIN_QUERY ? searchTerm : '');
  const results = vehicles.data ?? [];

  const items = React.useMemo(
    () => [
      ...results.map((vehicle) => ({ type: 'vehicle' as const, vehicle })),
      ...matchingCommands.map((command) => ({ type: 'command' as const, command })),
    ],
    [results, matchingCommands],
  );

  React.useEffect(() => {
    setActive(0);
  }, [items.length]);

  const go = React.useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      router.push(item.type === 'vehicle' ? `/vehicles/${item.vehicle.id}` : item.command.href);
      onClose();
    },
    [items, router, onClose],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % Math.max(1, items.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + items.length) % Math.max(1, items.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  const searching = searchTerm.length >= MIN_QUERY && vehicles.isFetching;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 animate-fade-in bg-black/50" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="relative w-full max-w-2xl animate-slide-up overflow-hidden rounded-lg bg-surface shadow-raised"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          {searching ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" aria-hidden />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search a registration number, or jump to a screen"
            aria-label="Search a registration number, or jump to a screen"
            aria-controls="command-results"
            aria-activedescendant={items[active] ? `command-item-${active}` : undefined}
            className="w-full bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs text-ink-3 sm:block">
            Esc
          </kbd>
        </div>

        <ul id="command-results" role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 ? (
            <li className="px-4 py-8 text-center">
              <p className="text-sm text-ink-2">
                {searchTerm.length >= MIN_QUERY
                  ? `No vehicle matches "${query.trim()}"`
                  : 'Type at least two characters to search'}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                {searchTerm.length >= MIN_QUERY
                  ? 'Only vehicles within your access are searchable.'
                  : 'Registration numbers match in any format.'}
              </p>
            </li>
          ) : null}

          {items.map((item, index) => {
            const selected = index === active;

            if (item.type === 'vehicle') {
              const vehicle = item.vehicle;
              return (
                <li
                  key={`v-${vehicle.id}`}
                  id={`command-item-${index}`}
                  role="option"
                  aria-selected={selected}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(index)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      selected ? 'bg-surface-2' : 'hover:bg-surface-2',
                    )}
                  >
                    <Car className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="identifier text-sm font-semibold text-ink">
                          {formatPlate(vehicle.registrationNumber)}
                        </span>
                        <StatusBadge status={vehicle.status} size="sm" />
                      </span>
                      <span className="mt-0.5 block truncate text-2xs text-ink-3">
                        {[
                          [vehicle.make, vehicle.model].filter(Boolean).join(' ') || null,
                          vehicle.siteName,
                          vehicle.financierName,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'No further detail'}
                      </span>
                    </span>
                    {selected ? (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
                    ) : null}
                  </button>
                </li>
              );
            }

            const command = item.command;
            const Icon = command.icon;
            return (
              <li
                key={`c-${command.id}`}
                id={`command-item-${index}`}
                role="option"
                aria-selected={selected}
              >
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(index)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    selected ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{command.label}</span>
                    <span className="block truncate text-2xs text-ink-3">{command.hint}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-2xs text-ink-3">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-line px-1 py-0.5">↑</kbd>
            <kbd className="rounded border border-line px-1 py-0.5">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-line px-1 py-0.5">↵</kbd>
            open
          </span>
          {results.length > 0 ? (
            <span className="ml-auto">
              {results.length} vehicle{results.length === 1 ? '' : 's'}
              {results.length >= 20 ? ' (narrow the search for more)' : ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Wires Cmd/Ctrl+K, and `/` when the user is not already typing. */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === OPEN_KEY) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      // `/` is a search convention, but must not steal a keystroke from someone
      // filling in a form.
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { open, setOpen, close: React.useCallback(() => setOpen(false), []) };
}
