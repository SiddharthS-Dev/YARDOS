'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { AuthProvider } from '@/lib/auth-context';
import { SiteProvider } from '@/lib/site-context';
import { ThemeProvider } from '@/lib/theme';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';

/**
 * Client providers.
 *
 * Query defaults are tuned for an operations console rather than a content
 * site: data is refetched when a window regains focus (an operator returning
 * to the tab must not act on a stale yard state), and authorisation failures
 * are never retried, because retrying a 403 just produces three 403s.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              if (error instanceof ApiError) {
                // Client errors will not resolve themselves.
                if (error.status >= 400 && error.status < 500) return false;
              }
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          {/* Site context depends on auth (it reads the caller's own scoped
              occupancy) and on the query client, so it nests inside both. */}
          <SiteProvider>
            <ToastProvider>{children}</ToastProvider>
          </SiteProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
