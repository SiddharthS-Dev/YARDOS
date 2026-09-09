'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Building2,
  Car,
  ChevronDown,
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Receipt,
  ShieldCheck,
  Truck,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Permission } from '@smartpark/contracts';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-context';
import { LoadingState } from '@/components/ui/primitives';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any one of these admits the item. */
  permissions: string[];
  description: string;
}

/**
 * Navigation.
 *
 * Each item declares the permissions that admit it, using the SAME catalogue
 * the API enforces. Hiding an item is a usability decision, never a security
 * one - every endpoint re-checks - but it means an operator is not offered
 * actions that would fail.
 */
const NAV: NavItem[] = [
  {
    href: '/gate',
    label: 'Live gate',
    icon: Radio,
    permissions: [Permission['session:admit'], Permission['anpr:event:read']],
    description: 'Capture, identify and admit',
  },
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    permissions: [
      Permission['report:operations'],
      Permission['report:finance'],
      Permission['report:financier'],
    ],
    description: 'Occupancy, ageing and revenue',
  },
  {
    href: '/vehicles',
    label: 'Vehicles',
    icon: Car,
    permissions: [Permission['vehicle:read']],
    description: 'Central vehicle repository',
  },
  {
    href: '/yard',
    label: 'Yard',
    icon: Truck,
    permissions: [Permission['session:read']],
    description: 'Stays, zones and bays',
  },
  {
    href: '/billing',
    label: 'Billing',
    icon: Receipt,
    permissions: [Permission['invoice:read']],
    description: 'Invoices, payments and releases',
  },
  {
    href: '/auctions',
    label: 'Auctions',
    icon: Gavel,
    permissions: [Permission['auction:read']],
    description: 'Lots, bidding and settlement',
  },
  {
    href: '/portal',
    label: 'My vehicles',
    icon: ShieldCheck,
    permissions: [Permission['financier:portal:search']],
    description: 'Financier portal',
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut, canAny } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Unauthenticated users go to sign-in. The route group is client-rendered,
  // so this is the guard; the API is the real boundary.
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Close the mobile drawer on navigation, or it obscures the page just opened.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState label="Restoring your session" />
      </div>
    );
  }
  if (!user) return null;

  const visibleNav = NAV.filter((item) => canAny(...item.permissions));

  return (
    <div className="flex h-full flex-col bg-base-950">
      <TopBar
        organisationName={user.organizationName}
        userName={user.fullName}
        roles={user.roles}
        financierName={user.financierName}
        onSignOut={() => void signOut()}
        onToggleNav={() => setMobileNavOpen((open) => !open)}
        mobileNavOpen={mobileNavOpen}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar items={visibleNav} pathname={pathname} className="hidden lg:flex" />

        {/* Mobile drawer */}
        {mobileNavOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileNavOpen(false)}
            />
            <Sidebar
              items={visibleNav}
              pathname={pathname}
              className="absolute inset-y-0 left-0 flex w-64 animate-slide-in shadow-raised"
            />
          </div>
        ) : null}

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TopBar({
  organisationName,
  userName,
  roles,
  financierName,
  onSignOut,
  onToggleNav,
  mobileNavOpen,
}: {
  organisationName: string;
  userName: string;
  roles: string[];
  financierName: string | null;
  onSignOut: () => void;
  onToggleNav: () => void;
  mobileNavOpen: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/5 bg-base-900 px-3 sm:px-4">
      <button
        type="button"
        onClick={onToggleNav}
        className="rounded p-1.5 text-muted-400 hover:bg-white/5 hover:text-slate-200 lg:hidden"
        aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
      >
        {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      <Link href="/gate" className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded bg-accent-500/15 ring-1 ring-inset ring-accent-500/30">
          <Truck className="h-4 w-4 text-accent-400" aria-hidden />
        </span>
        <span className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-wide text-white">YARDOS</span>
          <span className="mt-0.5 hidden text-2xs text-muted-500 sm:block">{organisationName}</span>
        </span>
      </Link>

      <div className="ml-auto flex items-center gap-2">
        {/* A financier user is always shown whose data they are looking at,
            so the scoping is never ambiguous. */}
        {financierName ? (
          <span className="hidden items-center gap-1.5 rounded bg-info-500/10 px-2 py-1 text-2xs font-medium uppercase tracking-wider text-info-400 ring-1 ring-inset ring-info-500/20 sm:inline-flex">
            <Building2 className="h-3 w-3" aria-hidden />
            {financierName}
          </span>
        ) : null}

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/5"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-base-700 text-2xs font-semibold text-slate-300">
              {initials(userName)}
            </span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-xs font-medium text-slate-200">{userName}</span>
              <span className="text-2xs text-muted-500">{roles.map(prettyRole).join(', ')}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-500" aria-hidden />
          </button>

          {menuOpen ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-1 w-56 animate-slide-in rounded-panel border border-white/10 bg-base-850 p-1 shadow-raised">
                <div className="border-b border-white/5 px-3 py-2">
                  <p className="truncate text-xs font-medium text-slate-200">{userName}</p>
                  <p className="mt-0.5 truncate text-2xs text-muted-500">
                    {roles.map(prettyRole).join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="mt-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden />
                  Sign out
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Sidebar({
  items,
  pathname,
  className,
}: {
  items: NavItem[];
  pathname: string;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        'w-60 shrink-0 flex-col gap-0.5 border-r border-white/5 bg-base-900 p-2',
        className,
      )}
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'group flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors',
              active
                ? 'bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-500/20'
                : 'text-muted-400 hover:bg-white/5 hover:text-slate-200',
            )}
          >
            <item.icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium leading-tight">{item.label}</span>
              <span
                className={cn(
                  'mt-0.5 truncate text-2xs',
                  active ? 'text-accent-400/60' : 'text-muted-600',
                )}
              >
                {item.description}
              </span>
            </span>
          </Link>
        );
      })}

      <p className="mt-auto px-2.5 py-2 text-2xs leading-relaxed text-muted-600">
        Development build. Rates and tax values are placeholders pending Sri JP sign-off.
      </p>
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function prettyRole(role: string): string {
  return role
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}
