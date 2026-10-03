import { useId, useState, type FormEvent } from 'react';
import { m } from 'motion/react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { surface } from '@/lib/motion';
import { settingsInput } from '@/lib/styles';
import type { AuthSession } from '@/lib/auth';

const PASSWORD_MIN = 8;

/**
 * The sign-in card, adapted from Kibo's Login Card (patterns/card/standard/card-standard-2): name and password, one
 * button. The first visit sets the Admin password instead (with a confirmation). "Forgot your password?" explains the
 * host-side reset, since there is no email to send a link to.
 */
export function SignIn({
  session,
  onSignedIn,
}: {
  session: Extract<AuthSession, { signedIn: false }>;
  onSignedIn: (session: AuthSession) => void;
}) {
  const id = useId();
  const setup = session.setupRequired;
  const [name, setName] = useState(session.name ?? 'Admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (setup && password.length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters.`);
    if (setup && password !== confirm) return setError('The two passwords differ.');
    setBusy(true);
    try {
      const body = { name: name.trim(), password };
      const { data, error: failure } = setup
        ? await api.POST('/api/auth/setup', { body })
        : await api.POST('/api/auth/login', { body });
      if (data) return onSignedIn(data);
      setPassword('');
      setConfirm('');
      setError((failure as { message?: string } | undefined)?.message ?? 'That did not work. Try again.');
    } catch {
      setError('Could not reach the dashboard.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4">
      <m.section
        aria-labelledby={`${id}-title`}
        className="w-full max-w-md rounded-xl border border-border bg-sidebar/30 shadow-sm"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={surface}
      >
        <header className="space-y-1.5 p-6 pb-4">
          <h1 id={`${id}-title`} className="font-semibold leading-none">
            {setup ? `Set the ${session.name ?? 'Admin'} password` : 'Sign in to Agent Swarm'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {setup
              ? 'First sign-in: choose the password for this dashboard. You will use it from now on.'
              : 'Enter your name and password to open the dashboard.'}
          </p>
        </header>
        {session.lockedDown && (
          <p
            role="alert"
            className="mx-6 mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
          >
            Sign-in is locked down after many failed attempts. Sign in from a trusted address, or have the host run{' '}
            <code className="break-all">scripts/unlock.ts</code>.
          </p>
        )}
        <form className="space-y-4 px-6 pb-6" onSubmit={submit} noValidate>
          <div className="space-y-2">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">
              Name
            </label>
            <input
              id={`${id}-name`}
              className={settingsInput}
              autoComplete="username"
              value={name}
              readOnly={setup}
              required
              onChange={event => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`${id}-password`} className="text-sm font-medium">
                {setup ? 'New password' : 'Password'}
              </label>
              {!setup && (
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                  aria-expanded={forgot}
                  aria-controls={`${id}-forgot`}
                  onClick={() => setForgot(open => !open)}
                >
                  Forgot your password?
                </button>
              )}
            </div>
            <input
              id={`${id}-password`}
              className={settingsInput}
              type="password"
              autoComplete={setup ? 'new-password' : 'current-password'}
              autoFocus
              required
              minLength={setup ? PASSWORD_MIN : undefined}
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </div>
          {setup && (
            <div className="space-y-2">
              <label htmlFor={`${id}-confirm`} className="text-sm font-medium">
                Repeat the password
              </label>
              <input
                id={`${id}-confirm`}
                className={settingsInput}
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={event => setConfirm(event.target.value)}
              />
            </div>
          )}
          {forgot && !setup && (
            <p id={`${id}-forgot`} className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              On the machine running the swarm, in its folder, run{' '}
              <code className="break-all text-foreground">
                docker compose exec backend bun scripts/reset-password.ts
              </code>
              . It signs everyone out; then reload this page and set a new password.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <Button className="w-full" type="submit" disabled={busy || !password}>
            {busy ? (setup ? 'Saving…' : 'Signing in…') : setup ? 'Set password and sign in' : 'Sign in'}
          </Button>
        </form>
      </m.section>
    </div>
  );
}
