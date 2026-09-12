/**
 * Authentication messaging and routing.
 *
 * Two of these properties are security properties rather than niceties:
 * the console must not help anyone work out whether an account exists, and it
 * must not put a financier on a screen built for Sri JP staff. Both are easy to
 * break with a well-meaning edit, so both are pinned.
 */

import type { AuthenticatedUserProfile } from '@smartpark/contracts';

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  authMessageFor,
  evaluatePassword,
  isRetryable,
  landingRouteFor,
  passwordMeetsPolicy,
} from './auth-errors';

describe('authMessageFor', () => {
  it('gives the same answer for a wrong password and an unknown email', () => {
    // The server returns INVALID_CREDENTIALS for both. The console must not
    // add anything that lets the two be told apart.
    const message = authMessageFor('INVALID_CREDENTIALS', 401);

    expect(message.title).toBe('Unable to sign in');
    expect(message.body).toBe('The email address or password is incorrect.');
    expect(message.hint).toBeUndefined();
  });

  it('never hints that an email is unrecognised', () => {
    const rendered = Object.values(authMessageFor('INVALID_CREDENTIALS', 401)).join(' ').toLowerCase();

    for (const leak of ['not found', 'no account', 'unknown', "doesn't exist", 'does not exist', 'unregistered']) {
      expect(rendered).not.toContain(leak);
    }
  });

  it.each<[string, string]>([
    ['ACCOUNT_LOCKED', 'Account locked'],
    ['ACCOUNT_NOT_ACTIVE', 'Account not active'],
    ['RATE_LIMITED', 'Too many attempts'],
    ['TOKEN_EXPIRED', 'Session expired'],
    ['TOKEN_INVALID', 'Session expired'],
    ['REFRESH_TOKEN_REUSED', 'Session ended'],
    ['NETWORK_ERROR', 'Cannot reach YARDOS'],
    ['FORBIDDEN', 'Access restricted'],
  ])('maps %s to "%s"', (code, title) => {
    expect(authMessageFor(code).title).toBe(title);
  });

  it('tells a locked-out user how the lock clears', () => {
    // Without this the only remaining action looks like "try again", which is
    // exactly what caused the lock.
    expect(authMessageFor('ACCOUNT_LOCKED').hint).toMatch(/unlock/i);
  });

  it('does not report a bad input as a server fault', () => {
    // VALIDATION_FAILED comes from the request DTO, before the service's own
    // policy check. Verified against the running API: a password under 8
    // characters returns VALIDATION_FAILED, while 8 or more that fails the
    // policy returns PASSWORD_POLICY_VIOLATION. Both are the caller's input,
    // and neither should read as "something went wrong at our end".
    const validation = authMessageFor('VALIDATION_FAILED', 400);

    expect(validation.title).toBe('Check what you entered');
    expect(validation.title).not.toBe('Something went wrong at our end');
    expect(authMessageFor('PASSWORD_POLICY_VIOLATION', 400).title).toBe('Password not accepted');
  });

  it('falls back to a generic message for an unmapped code', () => {
    // A new backend error must never surface its own wording to a user.
    const message = authMessageFor('SOME_NEW_INTERNAL_CODE');
    expect(message.title).toBe('Something went wrong at our end');
  });

  it('treats every 5xx as ours, whatever the code says', () => {
    expect(authMessageFor('INVALID_CREDENTIALS', 503).title).toBe('Something went wrong at our end');
    expect(authMessageFor('ACCOUNT_LOCKED', 500).title).toBe('Something went wrong at our end');
  });

  it('handles a missing code', () => {
    expect(authMessageFor(null).title).toBe('Something went wrong at our end');
    expect(authMessageFor(undefined).title).toBe('Something went wrong at our end');
  });

  it('never renders an empty message', () => {
    for (const code of [
      'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED', 'ACCOUNT_NOT_ACTIVE', 'RATE_LIMITED',
      'TOKEN_EXPIRED', 'TOKEN_INVALID', 'REFRESH_TOKEN_REUSED', 'NETWORK_ERROR',
      'FORBIDDEN', 'PASSWORD_POLICY_VIOLATION', 'VALIDATION_FAILED', 'UNRECOGNISED',
    ]) {
      const message = authMessageFor(code);
      expect(message.title.length).toBeGreaterThan(3);
      expect(message.body.length).toBeGreaterThan(10);
    }
  });
});

describe('isRetryable', () => {
  it('marks transient failures as worth retrying', () => {
    expect(isRetryable('NETWORK_ERROR')).toBe(true);
    expect(isRetryable('RATE_LIMITED')).toBe(true);
  });

  it('does not invite a retry of a wrong password', () => {
    expect(isRetryable('INVALID_CREDENTIALS')).toBe(false);
    expect(isRetryable('ACCOUNT_NOT_ACTIVE')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('password policy mirror', () => {
  it('requires the same minimum length as the server default', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it('accepts a password that satisfies every server rule', () => {
    expect(passwordMeetsPolicy('Kx7$mBqw2Ldz', {})).toBe(true);
  });

  it.each<[string, string]>([
    ['Kx7$mBq', 'too short'],
    ['KX7$MBQW2LDZ', 'no lowercase'],
    ['kx7$mbqw2ldz', 'no uppercase'],
    ['Kx$mBqwzLdzQ', 'no digit'],
    ['Kx7mBqw2LdzQ', 'no symbol'],
  ])('rejects %s (%s)', (password) => {
    expect(passwordMeetsPolicy(password, {})).toBe(false);
  });

  it('rejects a password containing the email local-part', () => {
    // Mirrors the server check: a password with the account identity in it is
    // trivially guessable.
    expect(passwordMeetsPolicy('Priya$2026xyzQ', { email: 'priya@example.com' })).toBe(false);
  });

  it('rejects a password containing part of the name', () => {
    expect(passwordMeetsPolicy('Management$1Qz', { fullName: 'Priya Management' })).toBe(false);
  });

  it('ignores short name fragments, as the server does', () => {
    // The server only considers parts of 4+ characters, so "de" or "van"
    // must not disqualify an otherwise good password.
    expect(passwordMeetsPolicy('Kx7$mBqw2Ldz', { fullName: 'An Li' })).toBe(true);
  });

  it('reports every rule, so the checklist can show progress', () => {
    // With no email or name supplied there is nothing for the password to
    // contain, so the identity rule passes - matching the server, which only
    // applies those checks when it has an identity to compare against.
    const results = evaluatePassword('kx7', {});

    expect(results).toHaveLength(PASSWORD_RULES.length);
    expect(results.filter((r) => r.passed).map((r) => r.rule.id)).toEqual([
      'lower',
      'digit',
      'identity',
    ]);
  });

  it('does not mark an empty password as satisfying the identity rule', () => {
    // An empty field is not "safely free of your name" - it is just empty, and
    // showing a green tick against nothing is misleading.
    const identity = evaluatePassword('', { email: 'a@b.com' }).find((r) => r.rule.id === 'identity');
    expect(identity?.passed).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('landingRouteFor', () => {
  const profile = (overrides: Partial<AuthenticatedUserProfile>): AuthenticatedUserProfile =>
    ({
      id: 'u1',
      email: 'user@example.com',
      fullName: 'Test User',
      status: 'ACTIVE',
      organizationId: 'org1',
      organizationName: 'Sri JP',
      financierId: null,
      financierName: null,
      roles: [],
      permissions: [],
      siteIds: [],
      allSiteAccess: false,
      mfaEnabled: false,
      lastLoginAt: null,
      ...overrides,
    }) as AuthenticatedUserProfile;

  it('sends a financier user to their portal, never the estate dashboard', () => {
    // The portal is the only screen scoped to one financier's portfolio.
    // Landing them anywhere else shows headline figures that are not theirs.
    const route = landingRouteFor(
      profile({ financierId: 'fin1', permissions: ['report:financier', 'vehicle:read'] }),
    );
    expect(route).toBe('/portal');
  });

  it('does not send Sri JP staff to the portal even with the financier report permission', () => {
    // financierId is what makes someone a portal user, not the permission.
    const route = landingRouteFor(
      profile({ financierId: null, permissions: ['report:financier', 'report:operations'] }),
    );
    expect(route).toBe('/dashboard');
  });

  it('sends a gate operator to the gate', () => {
    expect(landingRouteFor(profile({ permissions: ['session:admit', 'vehicle:read'] }))).toBe('/gate');
  });

  it('sends management to the overview', () => {
    expect(landingRouteFor(profile({ permissions: ['report:operations'] }))).toBe('/dashboard');
  });

  it('sends a finance officer somewhere they can actually work', () => {
    expect(landingRouteFor(profile({ permissions: ['invoice:read', 'payment:read'] }))).toBe('/billing');
  });

  it('falls back to vehicles for a read-only viewer', () => {
    expect(landingRouteFor(profile({ permissions: ['vehicle:read'] }))).toBe('/vehicles');
  });

  it('never returns an empty route for a user with no permissions', () => {
    expect(landingRouteFor(profile({ permissions: [] }))).toBe('/dashboard');
  });

  it('sends nobody anywhere but login', () => {
    expect(landingRouteFor(null)).toBe('/login');
  });

  it('prefers the most specific role when several apply', () => {
    // A gate operator who can also read invoices belongs at the gate.
    const route = landingRouteFor(
      profile({ permissions: ['session:admit', 'invoice:read', 'vehicle:read'] }),
    );
    expect(route).toBe('/gate');
  });
});
