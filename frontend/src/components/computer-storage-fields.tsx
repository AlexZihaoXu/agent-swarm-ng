import { useId, useState } from 'react';
import { noAutofill } from '@/lib/no-autofill';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { fileSize } from '@/lib/computer-files';

type StoredComputer = {
  id: string;
  state: string;
  keepFolder: string | null;
  cacheFolder: string | null;
  keptPaths: string[];
  outdated: boolean | null;
};
/** The paths a computer keeps beyond its home folder (which is always kept and not listed as removable). */
export function keptOf(computer: { keptPaths?: string[] }) {
  return (computer.keptPaths ?? []).filter(path => path !== '/home/agent');
}
const PATH = /^\/[A-Za-z0-9._@+/-]+$/;

/**
 * A computer's storage, in its Settings dialog: where its Keep and Cache folders are and how much they hold,
 * Clear cache (while it is off), the paths it keeps besides its home folder, and Update image when a newer
 * computer image exists. Kept-path and image changes rebuild the computer (its folders stay), so the dialog applies
 * them with its other rebuild-only changes.
 */
export function ComputerStorageFields({
  computer,
  kept,
  onKeptChange,
  updateImage,
  onUpdateImageChange,
  disabled,
}: {
  computer: StoredComputer;
  kept: string[];
  onKeptChange: (paths: string[]) => void;
  updateImage: boolean;
  onUpdateImageChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [path, setPath] = useState('');
  const [clearing, setClearing] = useState<'idle' | 'busy' | 'done' | string>('idle');
  const usage = useQuery({
    queryKey: ['computer-storage', computer.id],
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/computers/{id}/storage', {
        params: { path: { id: computer.id } },
        signal,
      });
      if (!data) throw new Error(error?.message ?? 'Could not measure its storage.');
      return data;
    },
  });
  const off = computer.state === 'exited';
  const typed = path.trim();
  const invalid = typed !== '' && (!PATH.test(typed) || typed.endsWith('/') || typed.includes('/../'));
  const add = () => {
    if (!typed || invalid || kept.includes(typed) || typed === '/home/agent') return;
    onKeptChange([...kept, typed]);
    setPath('');
  };
  const clear = async () => {
    setClearing('busy');
    const { error } = await api
      .POST('/api/computers/{id}/cache/clear', { params: { path: { id: computer.id } } })
      .catch(() => ({ error: { message: 'Could not clear the cache.' } }));
    setClearing(error ? (error.message ?? 'Could not clear the cache.') : 'done');
    void usage.refetch();
  };
  const where = (kind: 'keep' | 'cache') => {
    const folder = kind === 'keep' ? computer.keepFolder : computer.cacheFolder;
    const bytes = usage.data?.storage.find(item => item.kind === kind)?.bytes;
    return (
      // Name, where (shortened when long), and size, which is never cut off.
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3 text-sm">
        <span className="font-medium">{kind === 'keep' ? 'Keep' : 'Cache'}</span>
        <span
          className="min-w-0 truncate text-right font-mono text-xs text-muted-foreground"
          title={folder ?? undefined}
        >
          {folder ? `${folder}/computers/…` : 'Docker storage'}
        </span>
        <span className="text-right text-xs tabular-nums text-muted-foreground">
          {usage.isPending ? 'measuring…' : bytes !== undefined ? fileSize(bytes) : '—'}
        </span>
      </div>
    );
  };

  return (
    <fieldset className="mt-5 space-y-4" disabled={disabled}>
      <legend className="text-sm font-semibold">Storage</legend>
      <div className="space-y-1.5">
        {where('keep')}
        {where('cache')}
        {usage.data?.lastStart && <LastStart status={usage.data.lastStart} />}
        {usage.isError && (
          <p role="status" className="text-xs text-muted-foreground">
            {usage.error.message}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!off || clearing === 'busy'}
            onClick={() => void clear()}
          >
            {clearing === 'busy' ? 'Clearing…' : 'Clear cache'}
          </Button>
          <span role="status" className="text-xs text-muted-foreground">
            {clearing === 'done'
              ? 'Cache cleared.'
              : clearing !== 'idle' && clearing !== 'busy'
                ? clearing
                : off
                  ? 'Downloads and caches it can fetch again.'
                  : 'Power it off to clear its cache.'}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <p id={`${id}-kept`} className="text-sm font-medium">
          Also keep
        </p>
        <p className="text-xs text-muted-foreground">
          Its home folder is always kept. Add system folders or files to keep too, such as{' '}
          <code>/var/lib/postgresql</code> with <code>/etc/postgresql</code>. Kept paths hide what a newer image puts
          there. Changes apply when the computer is rebuilt (power it off first).
        </p>
        <ul aria-labelledby={`${id}-kept`} className="space-y-1">
          {kept.map(item => (
            <li key={item} className="flex min-h-9 items-center gap-2 rounded-md bg-background/60 px-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{item}</span>
              <button
                type="button"
                aria-label={`Stop keeping ${item}`}
                title="Remove"
                onClick={() => onKeptChange(kept.filter(other => other !== item))}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            aria-label="Path to keep"
            value={path}
            onChange={event => setPath(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder="/var/lib/postgresql"
            spellCheck={false}
            {...noAutofill}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="button" variant="outline" size="sm" disabled={!typed || invalid} onClick={add}>
            Add
          </Button>
        </div>
        {invalid && (
          <p role="alert" className="text-xs text-red-400">
            Use an absolute path such as /var/lib/postgresql.
          </p>
        )}
      </div>

      {computer.outdated && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={updateImage}
            onChange={event => onUpdateImageChange(event.target.checked)}
            className="mt-1"
          />
          <span>
            Update to the latest computer image
            <span className="block text-xs text-muted-foreground">
              Its kept files stay; what it installed with apt is reinstalled at its next start.
            </span>
          </span>
        </label>
      )}
    </fieldset>
  );
}

/** How its last start went, from /keep/boot-status: "ok", "running" or "failed: …", then a time. */
function LastStart({ status }: { status: string }) {
  const [state, ...rest] = status.split(' ');
  const problems = rest
    .filter(word => !/^\d{4}-\d{2}-\d{2}T/.test(word))
    .join(' ')
    .replace(/^:\s*/, '');
  if (state === 'ok')
    return <p className="text-xs text-muted-foreground">Last start: everything kept and reinstalled.</p>;
  if (state === 'running')
    return (
      <p className="text-xs text-muted-foreground">Reinstalling what it installed and running its startup scripts…</p>
    );
  return (
    <p role="status" className="text-xs text-amber-300">
      Its last start had problems{problems ? `: ${problems}` : ''}. Details are in /keep/boot.log on the computer.
    </p>
  );
}
