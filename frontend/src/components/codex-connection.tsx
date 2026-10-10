import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { settingsCard } from '@/lib/styles';
import type { paths } from '@/api/schema';

type Listing = paths['/api/providers/openai-codex/accounts']['get']['responses'][200]['content']['application/json'];
type Account = Listing['accounts'][number];

const planName = (plan?: string) => (plan ? `${plan[0]!.toUpperCase()}${plan.slice(1)} plan` : '');

/**
 * Settings → OpenAI Codex: one card per ChatGPT account (docs/users.md#model-connections). Each signed-in account is
 * its own connection for agents, so one can be another's fallback (Agents → agent → Model).
 */
export function CodexConnection() {
  const [listing, setListing] = useState<Listing>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<Account | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const { data, error } = await api.GET('/api/providers/openai-codex/accounts', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        if (controller.signal.aborted) return;
        if (!data || error) throw new Error();
        setListing(data);
        if (data.accounts.some(account => ['starting', 'waiting'].includes(account.login.state)))
          timer = setTimeout(() => void refresh(), 2000);
      } catch {
        if (!controller.signal.aborted) setError('Could not load the OpenAI connection.');
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision]);

  async function run(key: string, work: () => Promise<{ error?: { message: string } }>) {
    setBusy(key);
    setError('');
    try {
      const result = await work();
      if (result.error) setError(result.error.message ?? 'Could not update the connection.');
      setRevision(value => value + 1);
    } catch {
      setError('Could not reach the backend.');
    } finally {
      setBusy(null);
    }
  }
  const change = (account: Account, action: 'connect' | 'cancel' | 'disconnect') => {
    const query = { params: { query: account.account ? { account: account.account } : {} } };
    return run(account.account, () =>
      action === 'connect'
        ? api.POST('/api/providers/openai-codex/login', { ...query, body: {} })
        : api.DELETE(action === 'cancel' ? '/api/providers/openai-codex/login' : '/api/providers/openai-codex', query),
    );
  };
  const accounts = listing?.accounts ?? [];
  const several = accounts.length > 1;
  return (
    <section aria-labelledby="codex-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="codex-title" className="text-lg font-semibold">
            OpenAI Codex
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your ChatGPT Plus or Pro subscription. No API key required. Each account is its own connection: list
            another account’s model as an agent’s fallback for when one fails or runs out.
          </p>
        </div>
        {listing && accounts.length < listing.max && (
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-0"
            disabled={busy !== null}
            onClick={() => void run('add', () => api.POST('/api/providers/openai-codex/accounts', { body: {} }))}
          >
            <span aria-hidden="true" className="mr-2 text-lg leading-none">
              +
            </span>
            Add ChatGPT account
          </Button>
        )}
      </div>
      {!listing && (
        <div className={settingsCard}>
          <p role="status" className="text-sm">
            {error ? '' : 'Loading connection…'}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}{' '}
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => {
              setError('');
              setRevision(value => value + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {accounts.map((account, index) => (
        <AccountCard
          key={account.account}
          account={account}
          title={several ? `ChatGPT account ${index + 1}` : undefined}
          busy={busy === account.account}
          disabled={busy !== null}
          onChange={action => void change(account, action)}
          onRemove={account.account ? () => setRemoving(account) : undefined}
        />
      ))}
      {listing && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each account’s subscription limits are shared by the agents using it. Credentials stay on the backend. API
          endpoints below use separate billing.
        </p>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={open => !open && setRemoving(null)}
        title="Remove this ChatGPT account?"
        description={
          <span className="block">
            {removing?.email ?? 'This account'} is signed out and removed. Agents that list it skip it until you choose
            another model for them.
          </span>
        }
        confirmLabel="Remove account"
        busyLabel="Removing…"
        onConfirm={async () => {
          const account = removing!.account;
          await run(account, () =>
            api.DELETE('/api/providers/openai-codex/accounts/{account}', { params: { path: { account } } }),
          );
          setRemoving(null);
        }}
      />
    </section>
  );
}

function AccountCard({
  account,
  title,
  busy,
  disabled,
  onChange,
  onRemove,
}: {
  account: Account;
  /** Shown when there is more than one account. */
  title?: string;
  busy: boolean;
  disabled: boolean;
  onChange: (action: 'connect' | 'cancel' | 'disconnect') => void;
  onRemove?: () => void;
}) {
  const pending = ['starting', 'waiting'].includes(account.login.state);
  const code = `codex-device-code-${account.account || 'first'}`;
  const who = [account.email, planName(account.plan)].filter(Boolean).join(' · ');
  return (
    <div className={settingsCard} aria-label={title ?? 'ChatGPT account'} role="group">
      {title && <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>}
      <p role="status" className="text-sm">
        {account.connected ? 'Connected to ChatGPT' : pending ? 'Waiting for sign-in…' : 'Not connected'}
      </p>
      {account.connected && who && <p className="mt-1 text-sm text-muted-foreground">{who}</p>}
      {account.login.state === 'waiting' && account.login.userCode && (
        <div className="mt-4 space-y-3">
          {/* Same labeled-field composition as the endpoint settings (Kibo field-basic-inputs-4). */}
          <label htmlFor={code} className="block text-sm font-medium">
            One-time sign-in code
          </label>
          <input
            id={code}
            readOnly
            value={account.login.userCode}
            onFocus={event => event.target.select()}
            className="ao-inset h-10 w-full rounded-lg border border-border bg-sidebar px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <a
            href="https://auth.openai.com/codex/device"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            Open OpenAI sign-in
          </a>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Enter this code on OpenAI’s page{onRemove ? ', signed in as the account you are adding' : ''}. If needed,
            enable device code login in ChatGPT → Settings → Security. This page updates automatically.
          </p>
        </div>
      )}
      {account.login.message && (
        <p role="alert" className="mt-4 text-sm">
          {account.login.message}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          size="sm"
          variant={account.connected || pending ? 'outline' : 'default'}
          className="min-h-11 sm:min-h-0"
          disabled={disabled}
          onClick={() => onChange(pending ? 'cancel' : account.connected ? 'disconnect' : 'connect')}
        >
          {busy ? 'Updating…' : pending ? 'Cancel sign-in' : account.connected ? 'Disconnect' : 'Connect ChatGPT'}
        </Button>
        {onRemove && (
          <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-0" disabled={disabled} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
