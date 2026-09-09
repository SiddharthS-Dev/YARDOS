'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { type AuthMessage, authMessageFor, landingRouteFor } from '@/lib/auth-errors';
import { Button, LoadingState } from '@/components/ui/primitives';
import {
  AuthCard,
  AuthHeader,
  AuthLayout,
  EmailField,
  EnvironmentNotice,
  FormError,
  PasswordField,
  UnavailableHint,
} from '@/components/domain/auth-ui';

const ERROR_ID = 'signin-error';

/**
 * Sign in.
 *
 * The only authentication entry point the backend supports. There is no
 * self-service password reset, no invitation activation and no access request
 * endpoint - see docs/AUTH-BACKEND-GAPS.md - so this page states the real
 * alternative rather than offering links that would lead nowhere.
 */
export default function LoginPage() {
  return (
    <React.Suspense fallback={<LoadingState label="Loading" />}>
      <LoginScreen />
    </React.Suspense>
  );
}

function LoginScreen() {
  const { signIn, user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<AuthMessage | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Arriving here because a session ended is a different situation from
  // arriving here to sign in, and deserves different words.
  const reason = searchParams.get('reason');
  React.useEffect(() => {
    if (reason === 'session-expired') setError(authMessageFor('TOKEN_EXPIRED'));
    else if (reason === 'session-ended') setError(authMessageFor('REFRESH_TOKEN_REUSED'));
  }, [reason]);

  // Already signed in - do not show a sign-in form to someone who has a session.
  React.useEffect(() => {
    if (!loading && user) router.replace(landingRouteFor(user));
  }, [loading, user, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      const profile = await signIn(email.trim(), password);
      router.replace(landingRouteFor(profile));
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(authMessageFor(caught.code, caught.status));
      } else {
        setError(authMessageFor('NETWORK_ERROR'));
      }
      // The email is kept - retyping it after a typo in the password is
      // pointless friction. The password is cleared, because leaving a failed
      // one in the field on a shared gate terminal is not acceptable.
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Checking your session" />;

  return (
    <AuthLayout>
      <AuthHeader />

      <AuthCard title="Sign in">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <EmailField
            value={email}
            onChange={setEmail}
            disabled={submitting}
            autoFocus
            invalid={Boolean(error)}
            describedBy={error ? ERROR_ID : undefined}
          />

          <PasswordField
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={submitting}
            invalid={Boolean(error)}
            describedBy={error ? ERROR_ID : undefined}
          />

          <FormError message={error} id={ERROR_ID} />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            aria-busy={submitting}
            className="w-full"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {/* Not a link: there is no self-service reset endpoint, and a button
            that cannot work is worse than none. See GAP 1. */}
        <div className="mt-4 border-t border-line pt-3">
          <UnavailableHint>
            <span className="font-medium text-ink-2">Forgotten your password?</span> Contact your
            Sri JP administrator to have it reset.
          </UnavailableHint>
        </div>
      </AuthCard>

      {/* Enterprise platform: accounts are provisioned, not self-registered.
          There is no access-request endpoint either. See GAP 3. */}
      <p className="mt-4 text-center text-2xs leading-relaxed text-ink-3">
        Need access? YARDOS accounts are provisioned by your organisation&apos;s administrator.
      </p>

      <EnvironmentNotice />
    </AuthLayout>
  );
}
