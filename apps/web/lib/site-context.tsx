'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth-context';
import { useOccupancy } from '@/hooks/use-domain';

/**
 * The site the console is currently looking at.
 *
 * `null` means "every site this user may see" - which for Sri JP management is
 * the estate, and for a financier user is still only their own vehicles,
 * because the API narrows every query by financier regardless.
 *
 * Two things make this more than a dropdown:
 *
 *   Every query key that depends on site includes the site id, so switching
 *   site changes the key and the previous site's rows are never rendered under
 *   the new heading. Stale cross-site data on screen is not a cosmetic problem:
 *   an operator acting on a vehicle they believe is in front of them, that is
 *   actually 300km away, is a real operational error.
 *
 *   The list of sites comes from the occupancy report, which the API has
 *   already narrowed to the caller's own access. The console never assembles a
 *   site list of its own, so it cannot offer a site the user cannot open.
 */

export interface SiteOption {
  id: string;
  code: string;
  name: string;
  occupied: number;
  capacity: number;
  utilisationPercent: number;
}

interface SiteContextValue {
  siteId: string | null;
  setSiteId: (siteId: string | null) => void;
  sites: SiteOption[];
  currentSite: SiteOption | null;
  loading: boolean;
}

const SiteContext = React.createContext<SiteContextValue | null>(null);

const STORAGE_KEY = 'yardos.site';

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [siteId, setSiteIdState] = React.useState<string | null>(null);

  // Occupancy is already scoped to the caller; it doubles as the site list.
  const occupancy = useOccupancy();

  const sites = React.useMemo<SiteOption[]>(
    () =>
      (occupancy.data?.sites ?? []).map((site) => ({
        id: site.siteId,
        code: site.siteCode,
        name: site.siteName,
        occupied: site.occupied,
        capacity: site.capacity,
        utilisationPercent: site.utilisationPercent,
      })),
    [occupancy.data],
  );

  // Restore the last choice, but only if the user can still see that site -
  // access can be revoked between sessions.
  React.useEffect(() => {
    if (sites.length === 0) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && sites.some((site) => site.id === stored)) setSiteIdState(stored);
  }, [sites]);

  const setSiteId = React.useCallback(
    (next: string | null) => {
      setSiteIdState(next);
      try {
        if (next) window.localStorage.setItem(STORAGE_KEY, next);
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Persistence is a convenience; the switch itself must still work.
      }
      // Drop everything scoped to the previous site rather than letting a stale
      // row sit under the new site's heading until it happens to refetch.
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  // A financier portal user has no site switcher: their scope is their
  // portfolio, which spans whatever sites their vehicles happen to be in.
  const isFinancierUser = Boolean(user?.financierId);

  const value = React.useMemo<SiteContextValue>(
    () => ({
      siteId: isFinancierUser ? null : siteId,
      setSiteId,
      sites: isFinancierUser ? [] : sites,
      currentSite: sites.find((site) => site.id === siteId) ?? null,
      loading: occupancy.isLoading,
    }),
    [isFinancierUser, siteId, setSiteId, sites, occupancy.isLoading],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteContextValue {
  const context = React.useContext(SiteContext);
  if (!context) throw new Error('useSite must be used inside SiteProvider.');
  return context;
}
