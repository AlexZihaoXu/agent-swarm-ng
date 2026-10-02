import { useEffect, useState } from 'react';
import type { operations } from '@/api/schema';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { NumberField } from '@/components/computer-resource-fields';

type Response = operations['getSwarmSettings']['responses'][200]['content']['application/json'];
type Key = keyof Response['settings'];
const groups: { title: string; description: string; keys: Key[] }[] = [
  { title: 'Computers', description: 'How many computers can exist at once.', keys: ['maxComputers'] },
  {
    title: 'Files',
    description:
      'Chat uploads and agents’ scratchpads. Nothing is deleted automatically: when storage is full, new files are refused.',
    keys: ['uploadMaxMb', 'storageBudgetGb', 'scratchFileMaxKb', 'scratchMaxFiles', 'scratchTotalMb'],
  },
  {
    title: 'Discord',
    description:
      'Messages your agents’ bots saw, for their inbox and search and for Chat. Older ones are deleted every hour; files agents opened from them stay.',
    keys: ['discordHistoryDays'],
  },
  {
    title: 'Memory',
    description:
      'Each agent’s long-term memory. The index (one line per memory) is in every turn it takes, so a larger index costs more on every reply.',
    keys: ['memoryIndexMaxLines', 'memoryIndexMaxChars', 'memoryMaxChars', 'memoryMaxCount'],
  },
];

/** Settings → Swarm: operator-wide limits, stored by the backend (not environment variables). */
export function SwarmSettings({ card }: { card: string }) {
  const [saved, setSaved] = useState<Response | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready' | 'saving'>('loading');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const adopt = (data: Response) => {
    setSaved(data);
    setDraft(Object.fromEntries(Object.entries(data.settings).map(([key, value]) => [key, String(value)])));
  };
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void api
      .GET('/api/settings/swarm', { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!data) return setStatus('failed');
        adopt(data);
        setStatus('ready');
      })
      .catch(() => !controller.signal.aborted && setStatus('failed'));
    return () => controller.abort();
  }, [attempt]);

  const changed = saved
    ? (Object.keys(saved.settings) as Key[]).filter(key => draft[key] !== String(saved.settings[key]))
    : [];
  const invalid = saved
    ? changed.find(key => {
        const value = Number(draft[key]);
        const bound = saved.bounds[key];
        return draft[key]?.trim() === '' || !Number.isInteger(value) || value < bound.min || value > bound.max;
      })
    : undefined;
  async function save() {
    if (!saved || !changed.length || invalid) return;
    setStatus('saving');
    setMessage('');
    const { data, error } = await api
      .PATCH('/api/settings/swarm', { body: Object.fromEntries(changed.map(key => [key, Number(draft[key])])) })
      .catch(() => ({ data: undefined, error: undefined }));
    if (data) {
      adopt(data);
      setMessage('Saved.');
    } else setMessage(error?.message ?? 'Could not save the settings.');
    setStatus('ready');
  }

  return (
    <section aria-labelledby="swarm-settings-title" className="space-y-4">
      <div>
        <h3 id="swarm-settings-title" className="text-lg font-semibold">
          Swarm
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Limits for the whole swarm.</p>
      </div>
      <div className={card}>
        {status === 'loading' && !saved && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading settings…
          </p>
        )}
        {status === 'failed' && (
          <div className="space-y-3">
            <p role="alert" className="text-sm">
              Could not load the swarm settings.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>
              Retry
            </Button>
          </div>
        )}
        {saved && (
          <div className="space-y-6">
            {groups.map(group => (
              <fieldset key={group.title} className="space-y-4">
                <legend className="text-sm font-semibold">{group.title}</legend>
                <p className="-mt-2 text-xs text-muted-foreground">{group.description}</p>
                <div className="grid gap-5 sm:grid-cols-2">
                  {group.keys.map(key => {
                    const bound = saved.bounds[key];
                    return (
                      <NumberField
                        key={key}
                        label={bound.unit ? `${bound.label} (${bound.unit})` : bound.label}
                        unit={bound.unit}
                        value={draft[key] ?? ''}
                        min={bound.min}
                        max={bound.max}
                        disabled={status === 'saving'}
                        onChange={value => {
                          setMessage('');
                          setDraft(current => ({ ...current, [key]: value }));
                        }}
                        hint={`${bound.min}–${bound.max}${bound.unit ? ` ${bound.unit}` : ''} · default ${bound.default}`}
                      />
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {message && (
                <p role="status" className="mr-auto text-sm text-muted-foreground">
                  {message}
                </p>
              )}
              {invalid && (
                <p role="alert" className="mr-auto text-sm">
                  {saved.bounds[invalid].label} must be a whole number from {saved.bounds[invalid].min} to{' '}
                  {saved.bounds[invalid].max}.
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!changed.length || status === 'saving'}
                onClick={() => adopt(saved)}
              >
                Discard changes
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!changed.length || Boolean(invalid) || status === 'saving'}
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
