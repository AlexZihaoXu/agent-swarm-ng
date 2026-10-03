import { useId, useState, type FormEvent } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { useSignedIn } from '@/lib/auth';
import { settingsCard, settingsInput } from '@/lib/styles';

const PASSWORD_MIN = 8;

/** Settings → Account: who is signed in, change the password (signs out other browsers), sign out. */
export function AccountSettings() {
  const id = useId();
  const { name, signOut } = useSignedIn();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function change(event: FormEvent) {
    event.preventDefault();
    if (password.length < PASSWORD_MIN) return setMessage(`Use at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setMessage('The two new passwords differ.');
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await api.POST('/api/auth/password', { body: { current, password } });
      if (!data) return setMessage((error as { message?: string } | undefined)?.message ?? 'Could not change it.');
      setCurrent('');
      setPassword('');
      setConfirm('');
      setMessage('Changed. Other browsers are signed out.');
    } catch {
      setMessage('Could not reach the dashboard.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id={`${id}-title`} className="text-lg font-semibold">
            Account
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as <b className="text-foreground">{name}</b>.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-0"
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </div>
      <form className={`${settingsCard} space-y-3`} onSubmit={change} aria-labelledby={`${id}-change`}>
        <h4 id={`${id}-change`} className="text-sm font-semibold">
          Change password
        </h4>
        {/* Password managers pair the new password with this account. */}
        <input type="text" autoComplete="username" value={name} readOnly hidden />
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['current', 'Current password', current, setCurrent, 'current-password'],
              ['new', 'New password', password, setPassword, 'new-password'],
              ['confirm', 'Repeat new password', confirm, setConfirm, 'new-password'],
            ] as const
          ).map(([key, label, value, set, autoComplete]) => (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`${id}-${key}`} className="text-sm text-muted-foreground">
                {label}
              </label>
              <input
                id={`${id}-${key}`}
                className={settingsInput}
                type="password"
                autoComplete={autoComplete}
                value={value}
                onChange={event => set(event.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={busy || !current || !password}>
            {busy ? 'Changing…' : 'Change password'}
          </Button>
          {message && (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
