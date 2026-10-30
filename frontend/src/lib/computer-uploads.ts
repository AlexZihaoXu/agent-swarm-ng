import { api } from '../api/client';
import { fileSize } from './computer-files';

export type UploadMode = 'refuse' | 'overwrite' | 'rename';
export type UploadedFile = { name: string; path: string; size: number };
/** One upload's refusal: `conflict` when a file of that name is already there (the person chooses what to do). */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly conflict = false,
  ) {
    super(message);
  }
}

/** Upload part size: the server holds at most a part in memory per upload (its runtime cannot slow a sender). */
export const UPLOAD_PART = 32 * 1024 * 1024;

/** One part as the raw request body, reporting bytes sent (fetch cannot). */
function sendPart(url: string, part: Blob, onProgress: (sent: number) => void, signal: AbortSignal) {
  return new Promise<{ received: number } | UploadedFile>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.responseType = 'json';
    request.upload.onprogress = event => onProgress(event.loaded);
    request.onload = () => {
      const body = request.response as { message?: string; conflict?: boolean } | null;
      if (request.status === 201 || request.status === 202) resolve(body as { received: number } | UploadedFile);
      else
        reject(
          new UploadError(
            body?.message ?? `Upload failed (${request.status}).`,
            request.status,
            request.status === 409 && body?.conflict === true,
          ),
        );
    };
    request.onerror = () => reject(new UploadError('Upload failed. Check the connection and try again.', 0));
    request.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'));
    if (signal.aborted) return reject(new DOMException('Upload cancelled.', 'AbortError'));
    signal.addEventListener('abort', () => request.abort(), { once: true });
    request.send(part);
  });
}

/**
 * Uploads one file of any size into a computer folder, in parts sent one after another: first an empty part that
 * checks the name and free space before any data moves, then the data. Reports bytes sent; resolves with where it
 * landed; rejects with an UploadError (`conflict` when the name is taken), or an AbortError when cancelled. A
 * cancelled or failed upload leaves nothing behind in the folder.
 */
export async function uploadComputerFile(
  id: string,
  folder: string,
  name: string,
  file: Blob,
  mode: UploadMode,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
) {
  const upload = crypto.randomUUID().replaceAll('-', '');
  const base = `/api/computers/${encodeURIComponent(id)}/upload`;
  const url = (offset: number) =>
    `${base}?${new URLSearchParams({ path: folder, name, size: String(file.size), offset: String(offset), upload, mode })}`;
  let opened = false;
  try {
    let result = await sendPart(url(0), new Blob([]), () => {}, signal);
    opened = true;
    for (let offset = 0; offset < file.size; offset += UPLOAD_PART) {
      const end = Math.min(file.size, offset + UPLOAD_PART);
      result = await sendPart(url(offset), file.slice(offset, end), sent => onProgress(offset + sent), signal);
    }
    if (!('name' in result)) throw new UploadError('Upload failed.', 0);
    return result;
  } catch (error) {
    // The computer drops the partial file itself when a part fails; a cancel between parts needs telling.
    if (opened)
      void fetch(`${base}?${new URLSearchParams({ path: folder, name, upload })}`, { method: 'DELETE' }).catch(
        () => {},
      );
    throw error;
  }
}

/** A folder inside `folder` (an existing folder of that name is fine). */
export async function createComputerFolder(id: string, folder: string, name: string) {
  const { data, error } = await api.POST('/api/computers/{id}/folders', {
    params: { path: { id } },
    body: { path: folder, name },
  });
  if (!data) throw new UploadError(error?.message ?? 'Could not create the folder.', 0);
  return data;
}

/** Transfer speed smoothed over the last few seconds, and the time left at that speed. */
export class TransferRate {
  private samples: { at: number; bytes: number }[] = [];
  constructor(private readonly windowMs = 4000) {}
  add(bytes: number, at = performance.now()) {
    this.samples.push({ at, bytes });
    while (this.samples.length > 2 && at - this.samples[1]!.at > this.windowMs) this.samples.shift();
  }
  /** Bytes a second, or null until there is enough to tell. */
  get speed() {
    const first = this.samples[0],
      last = this.samples.at(-1);
    if (!first || !last || last.at - first.at < 250) return null;
    return Math.max(0, ((last.bytes - first.bytes) * 1000) / (last.at - first.at));
  }
  remaining(total: number) {
    const speed = this.speed,
      sent = this.samples.at(-1)?.bytes ?? 0;
    return speed ? (total - sent) / speed : null;
  }
}

/** Same units as file sizes (fileSize), per second. */
export function transferSpeed(bytesPerSecond: number) {
  return `${fileSize(Math.round(bytesPerSecond))}/s`;
}
export function timeLeft(seconds: number) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} s left`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min left`;
  return `${Math.floor(seconds / 3600)} h ${Math.ceil((seconds % 3600) / 60)} min left`;
}

/** A dropped or picked file and the folders (relative to the drop target) it goes in; no file: an empty folder. */
export type PickedFile = { file: File | null; folders: string[] };

/**
 * What was dropped, folders included (walked with the entries API, which must be asked during the drop event):
 * files keep their place inside each dropped folder. Browsers without the API give the top-level files only.
 */
export function droppedFiles(transfer: DataTransfer): Promise<PickedFile[]> {
  const entries = [...transfer.items]
    .filter(item => item.kind === 'file')
    .map(item => (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) return Promise.resolve([...transfer.files].map(file => ({ file, folders: [] })));
  const walk = async (entry: FileSystemEntry, folders: string[]): Promise<PickedFile[]> => {
    if (entry.isFile)
      return [
        { file: await new Promise<File>((done, fail) => (entry as FileSystemFileEntry).file(done, fail)), folders },
      ];
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    // readEntries answers in batches until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((done, fail) => reader.readEntries(done, fail));
      if (!batch.length) break;
      children.push(...batch);
    }
    const inside = [...folders, entry.name];
    // An empty folder is still created.
    if (!children.length) return [{ file: null, folders: inside }];
    return (await Promise.all(children.map(child => walk(child, inside)))).flat();
  };
  return Promise.all(entries.map(entry => walk(entry, []))).then(lists => lists.flat());
}
