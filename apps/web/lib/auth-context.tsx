'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import type { AuthenticatedUserProfile, LoginResponse } from '@smartpark/contracts';
import { ApiError, SESSION_EXPIRED_EVENT, api, tokenStore } from './api';

interface AuthState {
  user: AuthenticatedUserProfile | null;
  loading: boolean;
  /** Returns the profile so the caller can route on it without a second read. */
  signIn: (email: string, password: string) => Promise<AuthenticatedUserProfile>;
  signOut: () => Promise<void>;
  /**
   * Whether the signed-in user holds a permission.
   *
   * Used ONLY to decide what to render. It is not a security boundary: every
   * endpoint re-checks server-side, and the console deliberately uses the same
   * permission catalogue the API enforces so the two cannot drift.
   */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/** Site selection is per-user; it must not survive into the next session. */
const SITE_STORAGE_KEY = 'yardos.site';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();

  /**
   * Discards everything belonging to the outgoing user.
   *
   * The query cache matters as much as the token. Clearing tokens alone left
   * the previous user's vehicles, invoices and site context sitting in cache,
   * so signing in as somebody else rendered their predecessor's data until each
   * query happened to refetch. On a shared gate terminal, with two financier
   * users, that is a cross-tenant leak visible on screen.
   *
   * The theme preference is deliberately kept: it is a per-device display
   * setting and carries nothing tenant-specific.
   */
  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
    try {
      window.localStorage.removeItem(SITE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in a private window; the in-memory state is
      // already gone, which is the part that matters.
    }
  }, [queryClient]);

  // Restore the session on mount. A stored token may be expired, in which case
  // the client's refresh-and-retry either recovers it or we land signed out.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      tokenStore.load();
      if (!tokenStore.access && !tokenStore.refresh) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const profile = await api.get<AuthenticatedUserProfile>('/auth/me');
        if (!cancelled) setUser(profile);
      } catch {
        tokenStore.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A session that ended on its own.
   *
   * `lib/api.ts` raises this after a refresh attempt fails, because it is
   * framework-agnostic and must not import React or the router. Reacting here
   * keeps expiry handling in one place instead of in every screen.
   */
  useEffect(() => {
    const onExpired = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      clearSession();
      router.replace(`/login?reason=${reason === 'reused' ? 'session-ended' : 'session-expired'}`);
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [clearSession, router]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      // Anything cached from a previous occupant of this terminal goes before
      // the new session begins, not after its first render.
      queryClient.clear();

      const result = await api.post<LoginResponse>('/auth/login', { email, password });
      tokenStore.set(result.accessToken, result.refreshToken);
      setUser(result.user);
      return result.user;
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refresh ?? undefined });
    } catch (error) {
      // A failed logout call must still clear the local session - otherwise a
      // network blip leaves the user apparently signed in on a shared terminal.
      if (!(error instanceof ApiError)) throw error;
    } finally {
      clearSession();
      router.push('/login');
    }
  }, [clearSession, router]);

  const value = useMemo<AuthState>(() => {
    const permissions = new Set(user?.permissions ?? []);
    return {
      user,
      loading,
      signIn,
      signOut,
      can: (permission: string) => permissions.has(permission),
      canAny: (...list: string[]) => list.some((permission) => permissions.has(permission)),
    };
  }, [user, loading, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}
