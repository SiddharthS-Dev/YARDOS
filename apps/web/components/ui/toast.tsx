'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { STATUS_VISUALS, type StatusKind } from '@/lib/status';

/**
 * Transient confirmations.
 *
 * Used for the outcome of an action the user just took - "Invoice issued",
 * "Payment recorded" - where a full page state would be heavy-handed.
 *
 * Toasts are NOT used for anything the user must act on. A failure that needs a
 * decision belongs on the screen, next to the thing that failed, where it can
 * still be read after the four seconds are up.
 */

export interface Toast {
  id: number;
  kind: Extract<StatusKind, 'SUCCESS' | 'WARNING' | 'CRITICAL' | 'PENDING'>;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId++;
      setToasts((current) => [...current, { ...toast, id }]);
      // Failures linger: the reader may have looked away when it appeared.
      const ttl = toast.kind === 'CRITICAL' ? 9000 : 4500;
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ kind: 'SUCCESS', title, description }),
      error: (title, description) => push({ kind: 'CRITICAL', title, description }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Announced politely so a screen reader hears the outcome without
          having its current sentence interrupted. */}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const visual = STATUS_VISUALS[toast.kind];
          const Icon = visual.icon;
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-lg bg-surface p-3 shadow-raised"
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', visual.text)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs text-ink-2">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="rounded p-0.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider.');
  return context;
}
