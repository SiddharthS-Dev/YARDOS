'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AuthenticatedUserProfile, LoginResponse } from '@smartpark/contracts';
import { ApiError, api, tokenStore } from './api';

interface AuthState {
  user: AuthenticatedUserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResponse>('/auth/login', { email, password });
    tokenStore.set(result.accessToken, result.refreshToken);
    setUser(result.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refresh ?? undefined });
    } catch (error) {
      // A failed logout call must still clear the local session - otherwise a
      // network blip leaves the user apparently signed in on a shared terminal.
      if (!(error instanceof ApiError)) throw error;
    } finally {
      tokenStore.clear();
      setUser(null);
      router.push('/login');
    }
  }, [router]);

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
