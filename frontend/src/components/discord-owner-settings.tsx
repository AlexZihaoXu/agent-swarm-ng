import { useEffect, useId, useState } from 'react';
import { noAutofill } from '@/lib/no-autofill';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';

type Account = { id: string; name: string };
const inputClass =
  'h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9';

/**
 * Settings → Discord: which Discord accounts are you. Only messages from these carry your authority when your agents
 * read Discord; everyone else is another person (or a bot).
 */
export function DiscordOwnerSettings({ card }: { card: string }) {
  const id = useId();
  const [saved, setSaved] = useState<Account[] | null>(null),
    [draft, setDraft] = useState<Account[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'failed'>('loading'),
    [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void api
      .GET('/api/discord/owner', { signal: controller.signal })
      .then(({ data }) => {
        if (!data) throw new Error();
        setSaved(data.accounts);
        setDraft(data.accounts);
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('failed');
      });
    return () => controller.abort();
  }, []);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const invalid = draft.find(account => !/^\d{15,21}$/.test(account.id.trim()));
  async function save() {
    setStatus('saving');
    setMessage('');
    const { data, error } = await api.PUT('/api/discord/owner', {
      body: { accounts: draft.map(account => ({ id: account.id.trim(), name: account.name.trim() })) },
    });
    if (data) {
      setSaved(data.accounts);
      setDraft(data.accounts);
      setMessage('Saved.');
    } else setMessage(error?.message ?? 'Could not save.');
    setStatus('ready');
  }
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <div>
        <h3 id={`${id}-title`} className="text-lg font-semibold">
          Discord
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your Discord accounts. On Discord, only these speak with your authority to your agents. Connect each agent’s
          own bot in its settings (Channels → Discord).
        </p>
      </div>
      <div className={card}>
        {status === 'loading' && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {status === 'failed' && (
          <p role="alert" className="text-sm">
            Could not load your Discord accounts.
          </p>
        )}
        {saved && (
          <div className="space-y-4">
            {draft.length === 0 && <p className="text-sm text-muted-foreground">No accounts yet.</p>}
            <ul aria-label="Your Discord accounts" className="space-y-2">
              {draft.map((account, index) => (
                <li key={index} className="flex min-w-0 flex-wrap items-end gap-2">
                  <label className="flex-[2_1_12rem] space-y-1 text-xs font-medium">
                    User ID
                    <input
                      value={account.id}
                      inputMode="numeric"
                      {...noAutofill}
                      placeholder="e.g. 400000000000000001"
                      onChange={event =>
                        setDraft(current =>
                          current.map((item, at) => (at === index ? { ...item, id: event.target.value } : item)),
                        )
                      }
                      className={`${inputClass} font-mono`}
                    />
                  </label>
                  <label className="min-w-0 flex-[1_1_8rem] space-y-1 text-xs font-medium">
                    Name
                    <input
                      value={account.name}
                      maxLength={80}
                      placeholder="You"
                      onChange={event =>
                        setDraft(current =>
                          current.map((item, at) => (at === index ? { ...item, name: event.target.value } : item)),
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Remove account ${account.name || account.id}`}
                    className="min-h-11 sm:min-h-9"
                    onClick={() => setDraft(current => current.filter((_, at) => at !== index))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-relaxed text-muted-foreground">
              To copy your user ID in Discord: User Settings → Advanced → turn on Developer Mode. Then right-click your
              name (on a phone, open your profile) and choose Copy User ID.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {message && (
                <p role="status" className="mr-auto text-sm text-muted-foreground">
                  {message}
                </p>
              )}
              {invalid && (
                <p role="alert" className="mr-auto text-sm">
                  A Discord user ID is a long number.
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.length >= 20 || status === 'saving'}
                onClick={() => setDraft(current => [...current, { id: '', name: '' }])}
              >
                Add account
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!changed || Boolean(invalid) || status === 'saving'}
                onClick={() => void save()}
              >
                {status === 'saving' ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
