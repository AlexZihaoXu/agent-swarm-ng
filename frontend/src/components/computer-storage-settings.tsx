import { useEffect, useId, useState } from 'react';
import type { operations } from '@/api/schema';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { settingsInput } from '@/lib/styles';

type Storage = operations['getComputerStorage']['responses'][200]['content']['application/json'];
type Kind = 'keep' | 'cache';
const fields: { kind: Kind; key: 'keepFolder' | 'cacheFolder'; label: string; hint: string; example: string }[] = [
  {
    kind: 'keep',
    key: 'keepFolder',
    label: 'Keep folder',
    hint: 'Code, projects, settings and everything a computer installs. Back this up; a mirrored disk is a good place.',
    example: '/srv/agent-swarm/keep',
  },
  {
    kind: 'cache',
    key: 'cacheFolder',
    label: 'Cache folder',
    hint: 'Downloads and caches that can be fetched again. Safe to clear; a fast or unprotected disk is fine.',
    example: '/srv/agent-swarm/cache',
  },
];

/**
 * Settings → Computer storage: the host folders new computers keep their files in. Empty uses each computer's own
 * Docker volumes. A folder needs a marker file created on the host, so this page cannot point computers anywhere
 * else; existing computers stay where they were created.
 */
export function ComputerStorageSettings({ card }: { card: string }) {
  const id = useId();
  const [saved, setSaved] = useState<Storage | null>(null);
  const [draft, setDraft] = useState({ keepFolder: '', cacheFolder: '' });
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready' | 'saving'>('loading');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const adopt = (data: Storage) => {
    setSaved(data);
    setDraft({ keepFolder: data.keepFolder ?? '', cacheFolder: data.cacheFolder ?? '' });
  };
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void api
      .GET('/api/computer-storage', { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!data) return setStatus('failed');
        adopt(data);
        setStatus('ready');
      })
      .catch(() => !controller.signal.aborted && setStatus('failed'));
    return () => controller.abort();
  }, [attempt]);

  const changed =
    saved !== null &&
    (draft.keepFolder.trim() !== (saved.keepFolder ?? '') || draft.cacheFolder.trim() !== (saved.cacheFolder ?? ''));
  async function save() {
    if (!saved || !changed) return;
    setStatus('saving');
    setMessage('');
    const { data, error } = await api
      .PUT('/api/computer-storage', {
        body: { keepFolder: draft.keepFolder.trim() || null, cacheFolder: draft.cacheFolder.trim() || null },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    if (data) {
      adopt(data);
      setMessage('Saved. New computers use these folders.');
    } else setMessage(error?.message ?? 'Could not save the storage folders.');
    setStatus('ready');
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <div>
        <h3 id={`${id}-title`} className="text-lg font-semibold">
          Computer storage
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Where new computers keep their files on this machine. Leave a folder empty to use Docker’s own storage.
          Existing computers stay where they were created.
        </p>
      </div>
      <div className={card}>
        {status === 'loading' && !saved && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading storage settings…
          </p>
        )}
        {status === 'failed' && (
          <div className="space-y-3">
            <p role="alert" className="text-sm">
              Could not load the storage settings.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>
              Retry
            </Button>
          </div>
        )}
        {saved && (
          <div className="space-y-5">
            {fields.map(field => {
              const value = draft[field.key].trim();
              return (
                <div key={field.kind} className="space-y-1.5">
                  <label htmlFor={`${id}-${field.kind}`} className="text-sm font-medium">
                    {field.label}
                  </label>
                  <input
                    id={`${id}-${field.kind}`}
                    value={draft[field.key]}
                    onChange={event => {
                      setMessage('');
                      setDraft(current => ({ ...current, [field.key]: event.target.value }));
                    }}
                    placeholder={`Docker storage (e.g. ${field.example})`}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={status === 'saving'}
                    className={`${settingsInput} font-mono`}
                  />
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                  {value && value !== (saved[field.key] ?? '') && (
                    <p className="text-xs text-muted-foreground">
                      First create its marker on the host:{' '}
                      <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                        touch {value}/{saved.markers[field.kind]}
                      </code>
                    </p>
                  )}
                </div>
              );
            })}
            <p className="text-xs leading-relaxed text-muted-foreground">
              The marker shows that someone with access to this machine chose the folder (this page cannot pick one on
              its own), and that its disk is mounted: a computer will not start while its folder’s marker is missing.
              Computers can write files there as root, so prefer a filesystem mounted <code>nosuid</code> (on ZFS:{' '}
              <code>setuid=off</code>) that other users of this machine cannot reach.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {message && (
                <p role="status" className="mr-auto text-sm text-muted-foreground">
                  {message}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!changed || status === 'saving'}
                onClick={() => {
                  adopt(saved);
                  setMessage('');
                }}
              >
                Discard changes
              </Button>
              <Button type="button" size="sm" disabled={!changed || status === 'saving'} onClick={() => void save()}>
                {status === 'saving' ? 'Checking…' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
