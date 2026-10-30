import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fileSize } from '@/lib/computer-files';
import {
  createComputerFolder,
  timeLeft,
  TransferRate,
  transferSpeed,
  UploadError,
  uploadComputerFile,
  type PickedFile,
  type UploadMode,
} from '@/lib/computer-uploads';
import { cn } from '@/lib/utils';

/** At most this many files upload at once; the rest wait their turn. */
const CONCURRENCY = 2;
type Status = 'waiting' | 'uploading' | 'conflict' | 'done' | 'failed' | 'cancelled' | 'skipped';
export type Upload = {
  key: string;
  name: string;
  /** Folders (inside the target folder) it goes in: a dropped folder's structure. */
  folders: string[];
  base: string;
  file: File;
  size: number;
  sent: number;
  speed: number | null;
  left: number | null;
  status: Status;
  mode: UploadMode;
  error?: string;
  savedAs?: string;
};
type Choice = 'overwrite' | 'rename' | 'skip';
const join = (folder: string, name: string) => `${folder === '/' ? '' : folder.replace(/\/+$/, '')}/${name}`;

/**
 * The file browser's upload queue: files go into the folder being viewed (dropped folders recreated inside it), two
 * at a time, each with its own progress, speed, time left, cancel and error. A name already taken waits for the
 * person's choice: replace it, keep both ("name (1).ext") or skip.
 */
export function useComputerUploads(computerId: string, onSettled: () => void) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const current = useRef<Upload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const rates = useRef(new Map<string, TransferRate>());
  const folders = useRef(new Map<string, Promise<unknown>>());
  /** "Apply to all" for the rest of this batch. */
  const choiceForAll = useRef<Choice | null>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const update = useCallback((key: string, change: Partial<Upload>) => {
    current.current = current.current.map(item => (item.key === key ? { ...item, ...change } : item));
    setUploads(current.current);
  }, []);

  /** Creates each folder level once per batch (an existing folder is fine), parents first. */
  const ensureFolders = useCallback(
    (base: string, names: string[]) => {
      let parent = base;
      let chain: Promise<unknown> = Promise.resolve();
      for (const name of names) {
        const folder = join(parent, name);
        const inside = parent;
        let created = folders.current.get(folder);
        if (!created) {
          created = chain.then(() => createComputerFolder(computerId, inside, name));
          folders.current.set(folder, created);
          // A failed folder is retried by a later upload, not remembered.
          created.catch(() => folders.current.delete(folder));
        }
        chain = created;
        parent = folder;
      }
      return chain;
    },
    [computerId],
  );

  const run = async (upload: Upload) => {
    const controller = new AbortController();
    controllers.current.set(upload.key, controller);
    const rate = new TransferRate();
    rates.current.set(upload.key, rate);
    update(upload.key, { status: 'uploading', sent: 0, speed: null, left: null, error: undefined });
    try {
      await ensureFolders(upload.base, upload.folders);
      const folder = upload.folders.reduce(join, upload.base);
      controller.signal.throwIfAborted();
      const result = await uploadComputerFile(
        computerId,
        folder,
        upload.name,
        upload.file,
        upload.mode,
        sent => {
          rate.add(sent);
          update(upload.key, { sent, speed: rate.speed, left: rate.remaining(upload.size) });
        },
        controller.signal,
      );
      update(upload.key, { status: 'done', sent: upload.size, savedAs: result.name, speed: null, left: null });
    } catch (error) {
      if (controller.signal.aborted) update(upload.key, { status: 'cancelled', speed: null, left: null });
      else if (error instanceof UploadError && error.conflict) {
        const all = choiceForAll.current;
        if (all === 'skip') update(upload.key, { status: 'skipped', speed: null, left: null });
        else if (all) update(upload.key, { status: 'waiting', mode: all, sent: 0 });
        else update(upload.key, { status: 'conflict', sent: 0, speed: null, left: null });
      } else
        update(upload.key, {
          status: 'failed',
          speed: null,
          left: null,
          error: error instanceof Error ? error.message : 'Upload failed.',
        });
    } finally {
      controllers.current.delete(upload.key);
      rates.current.delete(upload.key);
      pumpRef.current();
    }
  };
  // Starts waiting uploads up to the limit; the latest render's `run` (a ref, so callbacks stay stable).
  const pumpRef = useRef<() => void>(() => {});
  pumpRef.current = () => {
    const items = current.current;
    let active = items.filter(item => item.status === 'uploading').length;
    for (const item of items) {
      if (active >= CONCURRENCY) break;
      if (item.status !== 'waiting') continue;
      active++;
      void run(item);
    }
    if (!active && items.some(item => item.status === 'done')) settled.current();
  };

  const add = useCallback(
    (picked: PickedFile[], base: string) => {
      choiceForAll.current = null;
      const items: Upload[] = [];
      for (const { file, folders: inside } of picked) {
        if (!file) {
          // An empty dropped folder: created, nothing to upload.
          void ensureFolders(base, inside).then(
            () => settled.current(),
            () => {},
          );
          continue;
        }
        items.push({
          key: crypto.randomUUID(),
          name: file.name,
          folders: inside,
          base,
          file,
          size: file.size,
          sent: 0,
          speed: null,
          left: null,
          status: 'waiting',
          mode: 'refuse',
        });
      }
      current.current = [...current.current, ...items];
      setUploads(current.current);
      pumpRef.current();
    },
    [ensureFolders],
  );
  const resolve = useCallback(
    (key: string, choice: Choice, all: boolean) => {
      if (all) choiceForAll.current = choice;
      const targets = all ? current.current.filter(item => item.status === 'conflict').map(item => item.key) : [key];
      for (const target of targets)
        update(target, choice === 'skip' ? { status: 'skipped' } : { status: 'waiting', mode: choice });
      pumpRef.current();
    },
    [update],
  );
  const cancel = useCallback(
    (key: string) => {
      const controller = controllers.current.get(key);
      if (controller) controller.abort();
      else update(key, { status: 'cancelled' });
      pumpRef.current();
    },
    [update],
  );
  const cancelAll = useCallback(() => {
    for (const item of current.current)
      if (item.status === 'waiting' || item.status === 'conflict') update(item.key, { status: 'cancelled' });
    for (const controller of controllers.current.values()) controller.abort();
  }, [update]);
  const clear = useCallback(() => {
    current.current = current.current.filter(item => ['waiting', 'uploading', 'conflict'].includes(item.status));
    setUploads(current.current);
  }, []);
  useEffect(() => () => controllers.current.forEach(controller => controller.abort()), []);
  const active = uploads.some(item => ['waiting', 'uploading', 'conflict'].includes(item.status));
  return { uploads, active, add, resolve, cancel, cancelAll, clear };
}

const STATUS_TEXT: Partial<Record<Status, string>> = {
  waiting: 'Waiting',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

/** Kibo progress-with-label-5 ("Multi-line Label"), one per file, with its cancel button and conflict choice. */
export function UploadList({ queue }: { queue: ReturnType<typeof useComputerUploads> }) {
  const [applyAll, setApplyAll] = useState(false);
  const { uploads } = queue;
  if (!uploads.length) return null;
  const conflicts = uploads.filter(item => item.status === 'conflict').length;
  const finished = uploads.filter(item => !['waiting', 'uploading', 'conflict'].includes(item.status)).length;
  return (
    <section
      aria-label="Uploads"
      className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border px-3 py-2 motion-safe:animate-[fade-in_140ms_ease-out] sm:px-5"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          Uploads · {uploads.filter(item => item.status === 'done').length} of {uploads.length} done
        </h3>
        {finished > 0 && (
          <Button variant="flat" size="sm" className="min-h-8 shrink-0" onClick={queue.clear}>
            Clear finished
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {uploads.map(item => {
          const percent = item.size ? Math.min(100, Math.floor((item.sent / item.size) * 100)) : 100;
          const place = [...item.folders, item.name].join('/');
          return (
            <li key={item.key} className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={place}>
                    {place}
                  </p>
                  <p
                    className={cn(
                      'text-xs [overflow-wrap:anywhere]',
                      item.status === 'failed' ? 'text-red-400' : 'text-muted-foreground',
                    )}
                    {...(item.status === 'failed' ? { role: 'alert' } : {})}
                  >
                    {item.status === 'uploading'
                      ? [
                          `${fileSize(item.sent)} of ${fileSize(item.size)}`,
                          item.speed !== null ? transferSpeed(item.speed) : 'Starting…',
                          item.left !== null ? timeLeft(item.left) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : item.status === 'done'
                        ? `${fileSize(item.size)} · Uploaded${item.savedAs !== item.name ? ` as ${item.savedAs}` : ''}`
                        : item.status === 'failed'
                          ? item.error
                          : item.status === 'conflict'
                            ? 'A file with this name is already here.'
                            : `${fileSize(item.size)} · ${STATUS_TEXT[item.status]}`}
                  </p>
                </div>
                {item.status === 'uploading' && (
                  <span className="shrink-0 text-sm font-medium tabular-nums">{percent}%</span>
                )}
                {(item.status === 'uploading' || item.status === 'waiting') && (
                  <Button
                    variant="flat"
                    size="sm"
                    className="size-8 shrink-0 p-0"
                    aria-label={`Cancel upload of ${place}`}
                    title="Cancel upload"
                    onClick={() => queue.cancel(item.key)}
                  >
                    ×
                  </Button>
                )}
              </div>
              {item.status === 'uploading' && (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${place}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
                >
                  <div
                    className="h-full bg-primary motion-safe:transition-[width] motion-safe:duration-200"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              )}
              {item.status === 'conflict' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    onClick={() => queue.resolve(item.key, 'overwrite', applyAll)}
                  >
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    onClick={() => queue.resolve(item.key, 'rename', applyAll)}
                  >
                    Keep both
                  </Button>
                  <Button
                    size="sm"
                    variant="flat"
                    className="min-h-9"
                    onClick={() => queue.resolve(item.key, 'skip', applyAll)}
                  >
                    Skip
                  </Button>
                  {conflicts > 1 && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={applyAll}
                        onChange={event => setApplyAll(event.target.checked)}
                      />
                      Apply to all {conflicts}
                    </label>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
