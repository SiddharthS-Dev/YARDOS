'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck } from 'lucide-react';

import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { type AuthMessage, authMessageFor, passwordMeetsPolicy } from '@/lib/auth-errors';
import { Button, Panel } from '@/components/ui/primitives';
import { PageHeader } from '@/components/ui/page';
import {
  FormError,
  FormSuccess,
  PasswordField,
  PasswordRequirements,
} from '@/components/domain/auth-ui';

const ERROR_ID = 'change-password-error';
const RULES_ID = 'change-password-rules';

/**
 * Change your own password.
 *
 * `POST /auth/change-password` has existed since the identity module was
 * written and had no UI at all, so the only way to change a password was for an
 * administrator to reset it. This is the smallest genuinely-supported gap in
 * the authentication surface, so it is the one that gets built.
 *
 * The server requires the current password, applies its own policy, and revokes
 * every other refresh token on success - so a compromised session does not
 * survive the very action taken to stop it. Because this session's tokens are
 * revoked too, the user is signed out and must sign in again; that is the
 * server's behaviour, not a decision made here.
 */
export default function ChangePasswordPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  const [error, setError] = React.useState<AuthMessage | null>(null);
  const [serverProblems, setServerProblems] = React.useState<string[]>([]);
  const [succeeded, setSucceeded] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const context = React.useMemo(
    () => ({ email: user?.email, fullName: user?.fullName }),
    [user],
  );

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const sameAsCurrent = newPassword.length > 0 && newPassword === currentPassword;

  const canSubmit =
    currentPassword.length > 0 &&
    passwordMeetsPolicy(newPassword, context) &&
    !mismatch &&
    !sameAsCurrent &&
    !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setServerProblems([]);
    setSubmitting(true);

    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setSucceeded(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(authMessageFor(caught.code, caught.status));
        // The server is authoritative on the policy, and says exactly which
        // rules failed. Show its list rather than guessing from the code.
        const problems = (caught.details as { problems?: unknown } | undefined)?.problems;
        if (Array.isArray(problems)) {
          setServerProblems(problems.filter((item): item is string => typeof item === 'string'));
        }
      } else {
        setError(authMessageFor('NETWORK_ERROR'));
      }
      setCurrentPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  if (succeeded) {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader
          title="Password changed"
          breadcrumbs={[{ label: 'Account' }, { label: 'Password' }]}
        />
        <div className="flex-1 p-4">
          <Panel className="mx-auto max-w-md">
            <FormSuccess
              title="Your password has been changed"
              body="Every other session was signed out. Sign in again with your new password to continue."
            />
            <Button
              variant="primary"
              className="mt-4 w-full"
              icon={ShieldCheck}
              onClick={() => void signOut()}
            >
              Sign in again
            </Button>
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Change password"
        subtitle="Signing in again will be required afterwards."
        breadcrumbs={[{ label: 'Account' }, { label: 'Password' }]}
      />

      <div className="flex-1 p-4">
        <Panel className="mx-auto max-w-md">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <PasswordField
              id="current-password"
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              disabled={submitting}
              autoFocus
              invalid={Boolean(error)}
              describedBy={error ? ERROR_ID : undefined}
            />

            <div>
              <PasswordField
                id="new-password"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                disabled={submitting}
                describedBy={RULES_ID}
              />
              <PasswordRequirements password={newPassword} context={context} id={RULES_ID} />
              {sameAsCurrent ? (
                <p className="mt-1.5 text-2xs text-danger-strong">
                  The new password must differ from your current one.
                </p>
              ) : null}
            </div>

            <div>
              <PasswordField
                id="confirm-password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                disabled={submitting}
                invalid={mismatch}
                describedBy={mismatch ? 'confirm-mismatch' : undefined}
              />
              {mismatch ? (
                <p id="confirm-mismatch" className="mt-1.5 text-2xs text-danger-strong">
                  The two passwords do not match.
                </p>
              ) : null}
            </div>

            <FormError message={error} id={ERROR_ID} />

            {serverProblems.length > 0 ? (
              <ul className="space-y-1 rounded-md bg-danger-soft px-3 py-2 ring-1 ring-inset ring-danger/25">
                {serverProblems.map((problem) => (
                  <li key={problem} className="text-2xs text-danger-strong">
                    {problem}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex gap-2">
              <Button type="button" className="flex-1" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1"
                icon={KeyRound}
                loading={submitting}
                aria-busy={submitting}
                disabled={!canSubmit}
                disabledReason={
                  submitting ? undefined : 'Complete every field and satisfy the password policy.'
                }
              >
                {submitting ? 'Changing…' : 'Change password'}
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
