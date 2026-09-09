'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/primitives';

/**
 * Overlays.
 *
 * Two kinds, used for different jobs (and never interchangeably):
 *
 *   A DRAWER is for looking at something without losing your place - a vehicle
 *   quick view, a bid ladder, a bay's occupant. It slides from the side, the
 *   list behind it stays visible, and dismissing it costs nothing.
 *
 *   A MODAL is for a decision. It takes the centre of the screen and blocks the
 *   page precisely because the choice should not be made absent-mindedly. It is
 *   reserved for destructive or irreversible actions.
 *
 * Both trap focus, restore it on close, and close on Escape. A dialog that
 * leaks focus to the page behind it is unusable by keyboard.
 */

/* ------------------------------------------------------------------ */
/* Focus management                                                    */
/* ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useDialogBehaviour(open: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  const restoreTo = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    // Move focus in, so the first Tab lands inside rather than in the page.
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !ref.current) return;

      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      // Wrap, so Tab cannot walk out of the dialog into the page behind it.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 'md',
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useDialogBehaviour(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 animate-fade-in bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex h-full w-full flex-col bg-surface shadow-raised animate-slide-up',
          width === 'sm' && 'max-w-md',
          width === 'md' && 'max-w-xl',
          width === 'lg' && 'max-w-3xl',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer ? (
          <footer className="border-t border-line bg-surface-2 px-4 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useDialogBehaviour(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className="relative w-full max-w-lg animate-slide-up rounded-lg bg-surface shadow-raised"
      >
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-line bg-surface-2 px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirmation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Confirmation for an action that cannot be taken back.
 *
 * Deliberately verbose: it states the consequence rather than asking "are you
 * sure?". `consequences` is a list because releasing a vehicle does several
 * things at once - closes the stay, frees the bay, raises an invoice - and an
 * operator authorising it should see all of them.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  summary,
  consequences,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  loading,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  summary?: React.ReactNode;
  consequences?: string[];
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {summary ? <div className="text-sm text-ink-2">{summary}</div> : null}

      {consequences && consequences.length > 0 ? (
        <div className="mt-3 rounded-md bg-surface-2 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
            What happens next
          </p>
          <ul className="mt-1.5 space-y-1">
            {consequences.map((item) => (
              <li key={item} className="flex gap-2 text-xs text-ink-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {children}
    </Modal>
  );
}
