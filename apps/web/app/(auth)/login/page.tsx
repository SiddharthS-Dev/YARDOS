'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Truck } from 'lucide-react';

import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/primitives';

export default function LoginPage() {
  const { signIn, user, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/gate');
  }, [loading, user, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace('/gate');
    } catch (caught) {
      // The server deliberately returns one message for every credential
      // failure so accounts cannot be enumerated; show it as given.
      if (caught instanceof ApiError) {
        setError({ message: caught.message, code: caught.code });
      } else {
        setError({ message: 'Could not reach the server.', code: 'NETWORK_ERROR' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-base-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-accent-500/15 ring-1 ring-inset ring-accent-500/30">
            <Truck className="h-6 w-6 text-accent-400" aria-hidden />
          </span>
          <h1 className="mt-3 text-lg font-semibold tracking-wide text-white">YARDOS</h1>
          <p className="mt-1 text-xs text-muted-500">Sri JP Smartpark operations console</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-panel border border-white/5 bg-base-850 p-5 shadow-panel"
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="label">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input"
                placeholder="you@srijpsmartpark.example"
              />
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input"
              />
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md bg-danger-500/10 px-3 py-2 ring-1 ring-inset ring-danger-500/20"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-400" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs text-danger-400">{error.message}</p>
                  {error.code === 'ACCOUNT_LOCKED' ? (
                    <p className="mt-1 text-2xs text-muted-500">
                      Contact your administrator to unlock the account.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
              Sign in
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-2xs leading-relaxed text-muted-600">
          Development build. Seeded data is fictional and all commercial values are
          placeholders pending Sri JP sign-off.
        </p>
      </div>
    </div>
  );
}
