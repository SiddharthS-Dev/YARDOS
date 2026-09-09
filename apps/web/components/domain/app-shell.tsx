'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  Car,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Gavel,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  PanelsTopLeft,
  Radio,
  Receipt,
  Search,
  ShieldCheck,
  Sun,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Permission } from '@smartpark/contracts';

import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-context';
import { useSite } from '@/lib/site-context';
import { useTheme } from '@/lib/theme';
import { humanise } from '@/lib/format';
import { LoadingState } from '@/components/ui/primitives';
import { CommandPalette, useCommandPalette } from '@/components/domain/command-palette';

/**
 * The application shell.
 *
 * Navigation is grouped rather than flat, because nine sibling links tell an
 * operator nothing about how the system is organised. The groups follow the
 * vehicle's own journey - it arrives at the Gate, sits in the Yard, accrues
 * money in Financial, and leaves through Recovery - which is the same mental
 * model the product is built on.
 *
 * Items are filtered against the API's own permission catalogue. That is a
 * usability decision, never a security one: every endpoint re-checks, and the
 * shared catalogue means the two cannot drift apart. Deliberately absent are
 * Notifications, Settings and Audit - those modules have no controller, so a
 * nav entry would lead to a screen with nothing to show.
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any one of these admits the item. */
  permissions: string[];
  description: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Operations',
        icon: LayoutDashboard,
        permissions: [
          Permission['report:operations'],
          Permission['report:finance'],
          Permission['report:financier'],
        ],
        description: 'Capacity, ageing and exposure',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/gate',
        label: 'Gate',
        icon: Radio,
        permissions: [Permission['session:admit'], Permission['anpr:event:read']],
        description: 'Capture, identify and admit',
      },
      {
        href: '/yard',
        label: 'Live yard',
        icon: Truck,
        permissions: [Permission['session:read']],
        description: 'Zones, stays and allocation',
      },
      {
        href: '/vehicles',
        label: 'Vehicles',
        icon: Car,
        permissions: [Permission['vehicle:read']],
        description: 'Central vehicle repository',
      },
    ],
  },
  {
    label: 'Financial',
    items: [
      {
        href: '/billing',
        label: 'Invoices',
        icon: Receipt,
        permissions: [Permission['invoice:read']],
        description: 'Billing and settlement',
      },
      {
        href: '/billing?view=payments',
        label: 'Payments',
        icon: Wallet,
        permissions: [Permission['payment:read']],
        description: 'Receipts and reconciliation',
      },
    ],
  },
  {
    label: 'Recovery',
    items: [
      {
        href: '/auctions',
        label: 'Auctions',
        icon: Gavel,
        permissions: [Permission['auction:read']],
        description: 'Disposal pipeline',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        href: '/users',
        label: 'Users & roles',
        icon: Users,
        permissions: [Permission['user:read']],
        description: 'Access administration',
      },
    ],
  },
  {
    label: 'Portal',
    items: [
      {
        href: '/portal',
        label: 'My vehicles',
        icon: ShieldCheck,
        permissions: [Permission['report:financier']],
        description: 'Your financed portfolio',
      },
    ],
  },
];

const COLLAPSE_KEY = 'yardos.sidebar.collapsed';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut, canAny } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const palette = useCommandPalette();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);

  React.useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Close the mobile drawer on navigation; leaving it open over the new page is
  // disorienting on a tablet at the gate.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* preference only */
    }
  };

  const groups = React.useMemo(
    () =>
      NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) => canAny(...item.permissions)),
      })).filter((group) => group.items.length > 0),
    [canAny],
  );

  if (loading) return <LoadingState label="Restoring your session" />;
  if (!user) return null;

  return (
    <div className="flex h-full">
      {/* Mobile scrim */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <Sidebar
        groups={groups}
        pathname={pathname}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapsed={toggleCollapsed}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenMobileNav={() => setMobileOpen(true)}
          onOpenSearch={() => palette.setOpen(true)}
          onSignOut={signOut}
        />
        <main className="min-h-0 flex-1 overflow-y-auto bg-ground">{children}</main>
      </div>

      <CommandPalette open={palette.open} onClose={palette.close} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function Sidebar({
  groups,
  pathname,
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
}: {
  groups: NavGroup[];
  pathname: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-line bg-surface transition-[width,transform] duration-200',
        'lg:static lg:translate-x-0',
        collapsed ? 'lg:w-[3.75rem]' : 'lg:w-56',
        'w-64',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-line px-3">
        <PanelsTopLeft className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        {!collapsed ? (
          <span className="truncate text-sm font-semibold tracking-tight text-ink">YARDOS</span>
        ) : null}
        <button
          type="button"
          onClick={onCloseMobile}
          className="ml-auto rounded p-1 text-ink-3 hover:bg-surface-2 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">
                {group.label}
              </p>
            ) : (
              <div className="mx-2 mb-2 border-t border-line" aria-hidden />
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const base = item.href.split('?')[0]!;
                const active = pathname === base || pathname.startsWith(`${base}/`);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      // The tooltip is the only label when collapsed.
                      title={collapsed ? `${item.label} — ${item.description}` : undefined}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-primary-soft font-medium text-primary-strong'
                          : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                        collapsed && 'justify-center',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      {collapsed ? <span className="sr-only">{item.label}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleCollapsed}
        className="hidden items-center gap-2 border-t border-line px-3 py-2 text-2xs text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink lg:flex"
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        {collapsed ? (
          <ChevronsRight className="h-4 w-4" aria-hidden />
        ) : (
          <>
            <ChevronsLeft className="h-4 w-4" aria-hidden />
            Collapse
          </>
        )}
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

function TopBar({
  onOpenMobileNav,
  onOpenSearch,
  onSignOut,
}: {
  onOpenMobileNav: () => void;
  onOpenSearch: () => void;
  onSignOut: () => void;
}) {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="rounded p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      <SiteSelector />

      {/* Search is a button, not an input: the real surface is the palette,
          and having one place to type avoids two competing search boxes. */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="mx-auto flex w-full max-w-md items-center gap-2 rounded-md border border-line-strong bg-ground px-3 py-1.5 text-left text-sm text-ink-3 transition-colors hover:border-line hover:bg-surface-2"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">Search vehicles…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs sm:block">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={toggle}
        className="rounded p-1.5 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? (
          <Sun className="h-4 w-4" aria-hidden />
        ) : (
          <Moon className="h-4 w-4" aria-hidden />
        )}
      </button>

      <UserMenu user={user} onSignOut={onSignOut} />
    </header>
  );
}

function SiteSelector() {
  const { siteId, setSiteId, sites, currentSite } = useSite();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A financier user has no site scope to switch between.
  if (sites.length === 0) return null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2"
      >
        <Building2 className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
        <span className="hidden max-w-[10rem] truncate sm:block">
          {currentSite ? currentSite.name : 'All sites'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label="Site"
          className="absolute left-0 top-full z-50 mt-1 w-72 animate-slide-up overflow-hidden rounded-md bg-surface py-1 shadow-raised"
        >
          <SiteOptionRow
            label="All sites"
            detail="Every site you have access to"
            selected={siteId === null}
            onSelect={() => {
              setSiteId(null);
              setOpen(false);
            }}
          />
          <li className="my-1 border-t border-line" aria-hidden />
          {sites.map((site) => (
            <SiteOptionRow
              key={site.id}
              label={site.name}
              detail={`${site.code} · ${site.occupied}/${site.capacity} occupied`}
              selected={siteId === site.id}
              onSelect={() => {
                setSiteId(site.id);
                setOpen(false);
              }}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SiteOptionRow({
  label,
  detail,
  selected,
  onSelect,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <Check
          className={cn('h-3.5 w-3.5 shrink-0', selected ? 'text-primary' : 'text-transparent')}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{label}</span>
          <span className="block truncate text-2xs text-ink-3">{detail}</span>
        </span>
      </button>
    </li>
  );
}

function UserMenu({
  user,
  onSignOut,
}: {
  user: { fullName: string; email: string; roles: string[]; financierName: string | null } | null;
  onSignOut: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const initials = user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-2"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-2xs font-semibold text-primary-strong"
          aria-hidden
        >
          {initials}
        </span>
        <span className="sr-only">Account menu for {user.fullName}</span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-ink-3 sm:block" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-64 animate-slide-up overflow-hidden rounded-md bg-surface py-1 shadow-raised"
        >
          <div className="border-b border-line px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{user.fullName}</p>
            <p className="truncate text-2xs text-ink-3">{user.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <span
                  key={role}
                  className="rounded bg-surface-3 px-1.5 py-0.5 text-2xs text-ink-2"
                >
                  {humanise(role)}
                </span>
              ))}
            </div>
            {user.financierName ? (
              <p className="mt-1.5 text-2xs text-ink-3">
                Portal access · {user.financierName}
              </p>
            ) : null}
          </div>

          <Link
            href="/account/password"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <KeyRound className="h-4 w-4" aria-hidden />
            Change password
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
