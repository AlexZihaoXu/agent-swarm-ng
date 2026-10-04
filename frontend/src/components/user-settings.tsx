import { useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { noAutofill, secretField } from '@/lib/no-autofill';
import { settingsCard, settingsInput } from '@/lib/styles';

type User = operations['listUsers']['responses'][200]['content']['application/json']['users'][number];
const PASSWORD_MIN = 8;
const failureMessage = (error: unknown, fallback: string) =>
  (error as { message?: string } | undefined)?.message ?? fallback;
/** "", or a whole number of GiB from 1 (empty: no cap). */
const parseCap = (text: string) => (text.trim() ? Number(text) : null);
const validCap = (text: string) => !text.trim() || (/^\d+$/.test(text.trim()) && Number(text) >= 1);

/**
 * Settings → Users (admin only, docs/users.md#accounts): create users with a password you choose (each gets "<name>'s
 * Organization"), set a new password, cap their computers' RAM, disable or delete them. Same section composition and
 * dense table as Settings → Security.
 */
export function UserSettings() {
  const id = useId();
  const [users, setUsers] = useState<User[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [cap, setCap] = useState('');
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleting, setDeleting] = useState<User | null>(null);

  const load = async (signal?: AbortSignal) => {
    const { data } = await api.GET('/api/users', { signal });
    if (data) setUsers(data.users);
  };
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const run = async (work: () => Promise<{ data?: unknown; error?: unknown }>, done: string, fallback: string) => {
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await work();
      if (!data) return (setMessage(failureMessage(error, fallback)), false);
      await load();
      setMessage(done);
      return true;
    } catch {
      setMessage(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const update = (
    user: User,
    body: { password?: string; disabled?: boolean; memoryLimitGiB?: number | null },
    done: string,
  ) =>
    run(() => api.PATCH('/api/users/{id}', { params: { path: { id: user.id } }, body }), done, 'Could not change it.');

  async function add(event: FormEvent) {
    event.preventDefault();
    if (password.length < PASSWORD_MIN) return setMessage(`Use a password of at least ${PASSWORD_MIN} characters.`);
    const ok = await run(
      () => api.POST('/api/users', { body: { name: name.trim(), password, memoryLimitGiB: parseCap(cap) } }),
      `Added ${name.trim()}, with ${name.trim()}'s Organization.`,
      'Could not add the user.',
    );
    if (ok) {
      setName('');
      setPassword('');
      setCap('');
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <div>
        <h3 id={`${id}-title`} className="text-lg font-semibold">
          Users
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          People who sign in here. Each sees only their own organizations; you see all of them. Cap the RAM their
          computers may have in total.
        </p>
      </div>
      <div className={`${settingsCard} space-y-4`}>
        {users && (
          <div className="relative w-full overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="h-8 border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Organizations</th>
                  <th className="px-3 py-2 font-medium">RAM (GiB)</th>
                  <th className="px-3 py-2 font-medium">Active</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-1.5">
                      {user.name}
                      {user.admin && <span className="ml-1.5 text-xs text-muted-foreground">admin</span>}
                    </td>
                    <td className="max-w-48 truncate px-3 py-1.5 text-xs text-muted-foreground">
                      {user.organizations.map(org => org.name).join(', ') || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums">
                      {user.admin ? (
                        <span className="text-muted-foreground">{user.memoryUsedGiB} · no cap</span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          {user.memoryUsedGiB} of
                          <label htmlFor={`${id}-cap-${user.id}`} className="sr-only">
                            RAM cap of {user.name} (GiB, empty for none)
                          </label>
                          <input
                            id={`${id}-cap-${user.id}`}
                            inputMode="numeric"
                            placeholder="no cap"
                            className="h-8 w-20 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none hover:border-border focus-visible:border-border focus-visible:ring-1 focus-visible:ring-ring"
                            value={caps[user.id] ?? user.memoryLimitGiB?.toString() ?? ''}
                            onChange={event => setCaps(current => ({ ...current, [user.id]: event.target.value }))}
                            onBlur={async () => {
                              const draft = caps[user.id];
                              if (draft !== undefined && validCap(draft) && parseCap(draft) !== user.memoryLimitGiB)
                                await update(user, { memoryLimitGiB: parseCap(draft) }, 'RAM cap changed.');
                              else if (draft !== undefined && !validCap(draft))
                                setMessage('A RAM cap is a whole number of GiB, or empty for none.');
                              setCaps(({ [user.id]: _, ...rest }) => rest);
                            }}
                          />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {!user.admin && (
                        <>
                          <Switch
                            id={`${id}-active-${user.id}`}
                            checked={!user.disabled}
                            disabled={busy}
                            onCheckedChange={active =>
                              void update(
                                user,
                                { disabled: !active },
                                active ? `${user.name} can sign in again.` : `${user.name} is disabled and signed out.`,
                              )
                            }
                          />
                          <label htmlFor={`${id}-active-${user.id}`} className="sr-only">
                            {user.name} may sign in
                          </label>
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      {!user.admin && (
                        <span className="inline-flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="min-h-11 sm:min-h-0"
                            disabled={busy}
                            onClick={() => {
                              setResetting(user);
                              setNewPassword('');
                            }}
                          >
                            Set password
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="min-h-11 sm:min-h-0"
                            disabled={busy}
                            onClick={() => setDeleting(user)}
                          >
                            Delete
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {resetting && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async event => {
              event.preventDefault();
              if (newPassword.length < PASSWORD_MIN)
                return setMessage(`Use a password of at least ${PASSWORD_MIN} characters.`);
              if (
                await update(resetting, { password: newPassword }, `New password set; ${resetting.name} is signed out.`)
              )
                setResetting(null);
            }}
          >
            <div className="min-w-56 flex-1 space-y-1.5">
              <label htmlFor={`${id}-reset`} className="text-sm text-muted-foreground">
                New password for {resetting.name}
              </label>
              <input
                id={`${id}-reset`}
                {...secretField(true)}
                className={settingsInput}
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
              />
            </div>
            <Button type="submit" size="sm" className="min-h-11 sm:min-h-10" disabled={busy || !newPassword}>
              Set
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-10"
              onClick={() => setResetting(null)}
            >
              Cancel
            </Button>
          </form>
        )}
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="text-sm text-muted-foreground">
              New user’s name
            </label>
            <input
              id={`${id}-name`}
              {...noAutofill}
              className={settingsInput}
              maxLength={64}
              value={name}
              onChange={event => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-password`} className="text-sm text-muted-foreground">
              Password
            </label>
            <input
              id={`${id}-password`}
              {...secretField(true)}
              className={settingsInput}
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-cap`} className="text-sm text-muted-foreground">
              RAM cap (GiB)
            </label>
            <input
              id={`${id}-cap`}
              inputMode="numeric"
              placeholder="no cap"
              className={settingsInput}
              value={cap}
              onChange={event => setCap(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className="min-h-11 sm:min-h-10"
            disabled={busy || !name.trim() || !password || !validCap(cap)}
          >
            Add user
          </Button>
        </form>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={open => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this user'}?`}
        description={
          <>
            They are signed out and can no longer sign in. Their organizations, with everything in them, become yours.
            Their API endpoints, ChatGPT login and Discord accounts are removed: agents that used those endpoints need a
            new model.
          </>
        }
        confirmLabel="Delete user"
        busyLabel="Deleting…"
        onConfirm={async () => {
          const user = deleting!;
          const { data, error } = await api.DELETE('/api/users/{id}', { params: { path: { id: user.id } } });
          if (!data) throw new Error(failureMessage(error, 'Could not delete the user.'));
          await load();
          setMessage(`${user.name} is deleted; their organizations are yours.`);
        }}
      />
    </section>
  );
}
