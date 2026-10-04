import { useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '@/api/client';
import type { operations } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { noAutofill } from '@/lib/no-autofill';
import { settingsCard, settingsInput } from '@/lib/styles';

type Security = operations['getSecurity']['responses'][200]['content']['application/json'];
const failureMessage = (error: unknown, fallback: string) =>
  (error as { message?: string } | undefined)?.message ?? fallback;

/**
 * Settings → Security (docs/login.md#known-addresses-and-lockdown): known client addresses — a label for the audit and access logs and
 * whether the address is trusted (it may sign in during a lockdown) — and
 * the lockdown itself. Same section composition and dense table as the rest of Settings and the audit log.
 */
export function SecuritySettings({ onNavigate }: { onNavigate: (path: string) => void }) {
  const id = useId();
  const [state, setState] = useState<Security | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    void api
      .GET('/api/security', { signal: controller.signal })
      .then(({ data }) => data && setState(data))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const run = async (work: () => Promise<{ data?: Security; error?: unknown }>, done: string, fallback: string) => {
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await work();
      if (!data) return setMessage(failureMessage(error, fallback));
      setState(data);
      setMessage(done);
      return true;
    } catch {
      setMessage(fallback);
    } finally {
      setBusy(false);
    }
  };

  async function add(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () => api.POST('/api/security/addresses', { body: { address: address.trim(), label: label.trim(), trusted } }),
      'Added.',
      'Could not add the address.',
    );
    if (ok) {
      setAddress('');
      setLabel('');
      setTrusted(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id={`${id}-title`} className="text-lg font-semibold">
            Security
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Name the addresses you sign in from, and trust your own: trusted addresses can still sign in during a
            lockdown.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-0"
          onClick={() => onNavigate('/settings/access')}
        >
          Open the access log
        </Button>
      </div>
      <div className={`${settingsCard} space-y-4`}>
        {state?.lockdown && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
          >
            <p>
              <b>Sign-in is locked down</b> since {new Date(state.lockdown.since).toLocaleString()} after{' '}
              {state.lockdown.failures} failed sign-ins. Only trusted addresses can sign in.
            </p>
            {state.yourTrusted ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 bg-transparent sm:min-h-0"
                disabled={busy}
                onClick={() =>
                  void run(() => api.POST('/api/security/unlock'), 'The lockdown is lifted.', 'Could not lift it.')
                }
              >
                Lift the lockdown
              </Button>
            ) : (
              <p className="text-xs">
                From a trusted address you can lift it here; otherwise the host can run{' '}
                <code className="break-all">scripts/unlock.ts</code>.
              </p>
            )}
          </div>
        )}
        {state && (
          <p className="text-sm text-muted-foreground">
            You are at <span className="font-mono text-foreground">{state.yourAddress}</span>
            {state.yourLabel ? (
              <>
                {' '}
                ({state.yourLabel}
                {state.yourTrusted ? ', trusted' : ''})
              </>
            ) : (
              <>
                {' · '}
                <button
                  type="button"
                  className="min-h-11 underline-offset-4 hover:text-foreground hover:underline sm:min-h-0"
                  onClick={() => setAddress(state.yourAddress)}
                >
                  add it below
                </button>
              </>
            )}
          </p>
        )}
        {state && state.addresses.length > 0 && (
          <div className="relative w-full overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="h-8 border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Address or range</th>
                  <th className="px-3 py-2 font-medium">Label</th>
                  <th className="px-3 py-2 font-medium">Trusted</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.addresses.map(entry => (
                  <tr key={entry.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs">{entry.address}</td>
                    <td className="px-3 py-1.5">
                      <label htmlFor={`${id}-label-${entry.id}`} className="sr-only">
                        Label of {entry.address}
                      </label>
                      <input
                        id={`${id}-label-${entry.id}`}
                        {...noAutofill}
                        className="h-8 w-full min-w-28 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none hover:border-border focus-visible:border-border focus-visible:ring-1 focus-visible:ring-ring"
                        maxLength={60}
                        value={labels[entry.id] ?? entry.label}
                        onChange={event => setLabels(current => ({ ...current, [entry.id]: event.target.value }))}
                        onBlur={async () => {
                          const next = labels[entry.id]?.trim();
                          // The field shows the saved label again afterwards: a blank, unchanged or refused rename never lingers.
                          if (next && next !== entry.label)
                            await run(
                              () =>
                                api.PATCH('/api/security/addresses/{id}', {
                                  params: { path: { id: entry.id } },
                                  body: { label: next },
                                }),
                              'Renamed.',
                              'Could not rename it.',
                            );
                          setLabels(({ [entry.id]: _, ...rest }) => rest);
                        }}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Switch
                        id={`${id}-trusted-${entry.id}`}
                        checked={entry.trusted}
                        disabled={busy}
                        onCheckedChange={checked =>
                          void run(
                            () =>
                              api.PATCH('/api/security/addresses/{id}', {
                                params: { path: { id: entry.id } },
                                body: { trusted: checked },
                              }),
                            checked ? 'Trusted.' : 'No longer trusted.',
                            'Could not change it.',
                          )
                        }
                      />
                      <label htmlFor={`${id}-trusted-${entry.id}`} className="sr-only">
                        Trust {entry.address}
                      </label>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-11 sm:min-h-0"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.DELETE('/api/security/addresses/{id}', { params: { path: { id: entry.id } } }),
                            'Removed.',
                            'Could not remove it.',
                          )
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-address`} className="text-sm text-muted-foreground">
              Address or range
            </label>
            <input
              id={`${id}-address`}
              {...noAutofill}
              className={settingsInput}
              placeholder="192.0.2.10 or 100.64.0.0/10"
              maxLength={64}
              value={address}
              onChange={event => setAddress(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-new-label`} className="text-sm text-muted-foreground">
              Label
            </label>
            <input
              id={`${id}-new-label`}
              {...noAutofill}
              className={settingsInput}
              placeholder="Home"
              maxLength={60}
              value={label}
              onChange={event => setLabel(event.target.value)}
            />
          </div>
          <div className="flex h-11 items-center gap-2 sm:h-10">
            <Switch id={`${id}-new-trusted`} checked={trusted} onCheckedChange={setTrusted} />
            <label htmlFor={`${id}-new-trusted`} className="text-sm">
              Trusted
            </label>
          </div>
          <Button
            type="submit"
            size="sm"
            className="min-h-11 sm:min-h-10"
            disabled={busy || !address.trim() || !label.trim()}
          >
            Add
          </Button>
        </form>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
