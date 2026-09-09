import type { AuthenticatedUserProfile } from '@smartpark/contracts';

/**
 * Authentication messaging.
 *
 * Every message is chosen from the API's stable error CODE, never from its
 * message text. Codes are part of the contract; prose is not, and branching on
 * it would break the moment someone rewords a server string.
 *
 * Two rules this module exists to enforce:
 *
 *   **No account enumeration.** A wrong password and an unknown email both
 *   produce INVALID_CREDENTIALS, and the console does not embellish either.
 *   ACCOUNT_LOCKED and ACCOUNT_NOT_ACTIVE do confirm an account exists, but the
 *   server only returns those AFTER a correct password, so the console is not
 *   the thing leaking.
 *
 *   **No internals.** An unrecognised code falls back to a generic message
 *   rather than rendering whatever the server said, so an unmapped internal
 *   error cannot surface to a user.
 */

export interface AuthMessage {
  /** Short heading. */
  title: string;
  /** What happened, in the user's terms. */
  body: string;
  /** What to do about it, when there is something useful to say. */
  hint?: string;
}

const MESSAGES: Record<string, AuthMessage> = {
  INVALID_CREDENTIALS: {
    title: 'Unable to sign in',
    body: 'The email address or password is incorrect.',
  },
  ACCOUNT_LOCKED: {
    title: 'Account locked',
    body: 'Too many failed sign-in attempts, so this account has been locked.',
    hint: 'It unlocks automatically after a short period, or your administrator can unlock it now.',
  },
  ACCOUNT_NOT_ACTIVE: {
    title: 'Account not active',
    body: 'This account is not active and cannot sign in.',
    hint: 'Contact your Sri JP administrator.',
  },
  RATE_LIMITED: {
    title: 'Too many attempts',
    body: 'Too many sign-in attempts have been made. Wait a moment and try again.',
  },
  TOKEN_EXPIRED: {
    title: 'Session expired',
    body: 'Please sign in again to continue.',
  },
  TOKEN_INVALID: {
    title: 'Session expired',
    body: 'Please sign in again to continue.',
  },
  REFRESH_TOKEN_REUSED: {
    title: 'Session ended',
    body: 'For your security this session was ended. Please sign in again.',
  },
  PASSWORD_POLICY_VIOLATION: {
    title: 'Password not accepted',
    body: 'The new password does not meet the password policy.',
  },
  FORBIDDEN: {
    title: 'Access restricted',
    body: "You don't have permission to access this area.",
  },
  NETWORK_ERROR: {
    title: 'Cannot reach YARDOS',
    body: 'Check your connection and try again.',
  },
};

const GENERIC: AuthMessage = {
  title: 'Something went wrong at our end',
  body: 'The request could not be completed. Try again in a moment.',
};

/**
 * Maps an API error onto what the user should read.
 *
 * `status` is used only to separate "our fault" from "your input": any 5xx
 * becomes the generic message regardless of code, because a server-side failure
 * should never be described to a user in the server's own words.
 */
export function authMessageFor(code: string | null | undefined, status?: number): AuthMessage {
  if (status !== undefined && status >= 500) return GENERIC;
  if (!code) return GENERIC;
  return MESSAGES[code] ?? GENERIC;
}

/** True when re-entering the same credentials could plausibly succeed. */
export function isRetryable(code: string | null | undefined): boolean {
  return code === 'NETWORK_ERROR' || code === 'RATE_LIMITED';
}

/* ------------------------------------------------------------------ */
/* Password policy                                                     */
/* ------------------------------------------------------------------ */

/**
 * A mirror of the server's `PasswordHasherService.validatePolicy`.
 *
 * Presentation only. The server re-validates every password and returns
 * `details.problems` when it refuses; that list is what the form displays, so
 * the authoritative reason is always the one shown. This checklist exists so a
 * user is not made to guess before submitting.
 *
 * If the server policy changes, this must change with it - hence the explicit
 * reference in the comment above rather than a vague "keep in sync".
 */
export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string, context?: PasswordContext) => boolean;
}

export interface PasswordContext {
  email?: string;
  fullName?: string;
}

/** Matches AUTH_PASSWORD_MIN_LENGTH, whose default is 12. */
export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'lower', label: 'A lowercase letter', test: (password) => /[a-z]/.test(password) },
  { id: 'upper', label: 'An uppercase letter', test: (password) => /[A-Z]/.test(password) },
  { id: 'digit', label: 'A digit', test: (password) => /[0-9]/.test(password) },
  { id: 'symbol', label: 'A symbol', test: (password) => /[^A-Za-z0-9]/.test(password) },
  {
    id: 'identity',
    label: 'Does not contain your name or email',
    test: (password, context) => {
      if (password.length === 0) return false;
      const lower = password.toLowerCase();

      const localPart = context?.email?.split('@')[0]?.toLowerCase();
      if (localPart && localPart.length >= 4 && lower.includes(localPart)) return false;

      for (const part of (context?.fullName ?? '').toLowerCase().split(/\s+/)) {
        if (part.length >= 4 && lower.includes(part)) return false;
      }
      return true;
    },
  },
];

/** Which rules a candidate password currently satisfies. */
export function evaluatePassword(
  password: string,
  context?: PasswordContext,
): Array<{ rule: PasswordRule; passed: boolean }> {
  return PASSWORD_RULES.map((rule) => ({ rule, passed: rule.test(password, context) }));
}

export function passwordMeetsPolicy(password: string, context?: PasswordContext): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password, context));
}

/* ------------------------------------------------------------------ */
/* Post-login destination                                              */
/* ------------------------------------------------------------------ */

/**
 * Where a user lands after signing in.
 *
 * Derived from the user's own permissions rather than hard-coded, because the
 * previous fixed redirect to /gate was wrong for a finance officer and actively
 * misleading for a financier, whose data lives only in the portal.
 *
 * Ordered by how specific the role is, not by preference: the financier check
 * comes first because it is the narrowest, and the generic dashboard last.
 */
export function landingRouteFor(profile: AuthenticatedUserProfile | null): string {
  if (!profile) return '/login';

  const permissions = new Set(profile.permissions);
  const has = (permission: string) => permissions.has(permission);

  if (profile.financierId && has('report:financier')) return '/portal';
  if (has('session:admit')) return '/gate';
  if (has('report:operations') || has('report:finance')) return '/dashboard';
  if (has('invoice:read')) return '/billing';
  if (has('vehicle:read')) return '/vehicles';

  return '/dashboard';
}
