'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Eye, EyeOff, Info, PanelsTopLeft } from 'lucide-react';

import { cn } from '@/lib/cn';
import { type AuthMessage, evaluatePassword, type PasswordContext } from '@/lib/auth-errors';

/**
 * Authentication chrome.
 *
 * Built from the same tokens, typography and primitives as the rest of the
 * console - there is deliberately no separate visual language for signing in.
 * The one thing these screens do differently is centre a narrow card, because
 * there is no navigation yet to anchor to.
 */

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-ground px-4 py-10 sm:py-14">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

/**
 * The product mark.
 *
 * YARDOS is the product; Sri JP is the organisation operating it. The
 * architecture is multi-tenant, so the branding must not imply the two are the
 * same thing.
 */
export function AuthHeader() {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <span
        className="grid h-11 w-11 place-items-center rounded-lg bg-primary-soft ring-1 ring-inset ring-primary/25"
        aria-hidden
      >
        <PanelsTopLeft className="h-6 w-6 text-primary-strong" />
      </span>
      <h1 className="mt-3 text-lg font-semibold tracking-tight text-ink">YARDOS</h1>
      <p className="mt-0.5 text-xs text-ink-3">Vehicle Yard Operating System</p>
    </div>
  );
}

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-1 text-xs text-ink-3">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The environment banner.
 *
 * Rendered only outside production, and derived from NODE_ENV rather than a
 * hard-coded string, so a production build cannot ship a "development" notice.
 */
export function EnvironmentNotice() {
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <aside className="mt-5 rounded-md bg-amber-soft px-3 py-2.5 ring-1 ring-inset ring-amber/25">
      <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-amber-strong">
        <Info className="h-3 w-3" aria-hidden />
        Development environment
      </p>
      <p className="mt-1 text-2xs leading-relaxed text-amber-strong/90">
        Seeded data is fictional. All commercial values are placeholders pending Sri JP sign-off.
      </p>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

/**
 * An authentication failure.
 *
 * `role="alert"` with `aria-live` so a screen reader announces it when it
 * arrives asynchronously - a silent failure is indistinguishable from a hung
 * request to someone not watching the screen.
 */
export function FormError({ message, id }: { message: AuthMessage | null; id?: string }) {
  return (
    <div role="alert" aria-live="polite" id={id}>
      {message ? (
        <div className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 ring-1 ring-inset ring-danger/25">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-strong" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-medium text-danger-strong">{message.title}</p>
            <p className="mt-0.5 text-xs text-danger-strong/90">{message.body}</p>
            {message.hint ? (
              <p className="mt-1 text-2xs text-danger-strong/75">{message.hint}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FormSuccess({ title, body }: { title: string; body?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-md bg-primary-soft px-3 py-2.5 ring-1 ring-inset ring-primary/25"
    >
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-strong" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-medium text-primary-strong">{title}</p>
        {body ? <p className="mt-0.5 text-xs text-primary-strong/90">{body}</p> : null}
      </div>
    </div>
  );
}

/**
 * A capability the backend does not have.
 *
 * Used where the brief expects a link - forgotten password, request access -
 * that would lead nowhere. Saying what to do instead is more useful than a
 * button that cannot work, and more honest than pretending.
 */
export function UnavailableHint({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs leading-relaxed text-ink-3">{children}</p>;
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

export function EmailField({
  value,
  onChange,
  disabled,
  autoFocus,
  describedBy,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <div>
      <label htmlFor="email" className="label">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        // `username` rather than `email`: password managers key their entry on
        // the username field, and using `email` here stops them offering to
        // fill the pair.
        autoComplete="username"
        inputMode="email"
        required
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="input"
      />
    </div>
  );
}

/**
 * A password input with a visibility toggle.
 *
 * The toggle is `type="button"` - as a bare <button> inside a form it would
 * default to submit, and revealing the password would post the form.
 */
export function PasswordField({
  id = 'password',
  label = 'Password',
  value,
  onChange,
  autoComplete,
  disabled,
  describedBy,
  invalid,
  autoFocus,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled?: boolean;
  describedBy?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className="input pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-ink-3 transition-colors hover:text-ink disabled:cursor-not-allowed"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * The live policy checklist.
 *
 * A UX aid only - the server re-validates and its `details.problems` is what
 * gets displayed on refusal, so this can never contradict the real decision.
 */
export function PasswordRequirements({
  password,
  context,
  id,
}: {
  password: string;
  context?: PasswordContext;
  id?: string;
}) {
  const results = evaluatePassword(password, context);

  return (
    <ul id={id} className="mt-2 space-y-1">
      {results.map(({ rule, passed }) => (
        <li key={rule.id} className="flex items-center gap-1.5 text-2xs">
          {passed ? (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" aria-hidden />
          ) : (
            <Circle className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
          )}
          <span className={cn(passed ? 'text-ink-2' : 'text-ink-3')}>{rule.label}</span>
          <span className="sr-only">{passed ? '(met)' : '(not met)'}</span>
        </li>
      ))}
    </ul>
  );
}
