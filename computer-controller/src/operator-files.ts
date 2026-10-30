import { readFileSync } from 'node:fs';
import { ResourceError } from './resources';

export const operatorFilesScript = readFileSync(new URL('./operator-files.py', import.meta.url), 'utf8');
/** Bounded, buffered operations (listing and preview); transfers stream instead. */
export type FileOperation = 'files' | 'file-preview';
export type FileQuery = { path: string; offset?: number; filter?: string };
/**
 * One piece of a download: bytes `start` to `end` (inclusive). `match` is the validator of the first piece; a file
 * changed since is refused (412). The backend asks in bounded pieces because its runtime cannot slow a reader down.
 */
export type DownloadQuery = { path: string; start?: number; end?: number; match?: string };
export type UploadMode = 'refuse' | 'overwrite' | 'rename';
/**
 * One part of an upload: `length` bytes at `offset` of a file of `size` bytes, identified by `upload` (32 hex
 * characters chosen by the browser). Parts come in order; the last one puts the file in place.
 */
export type UploadQuery = {
  path: string;
  name: string;
  size: number;
  offset: number;
  length: number;
  upload: string;
  mode: UploadMode;
};
/** The largest part one request carries (this runtime reads a request body into memory as fast as it arrives). */
export const MAX_PART = 64 * 1024 * 1024;
export type DownloadResult = {
  name: string;
  size: number;
  start: number;
  length: number;
  etag: string;
  modified: string;
};

const invalid = () => new ResourceError(400, 'Invalid guest file request.');
const guestPath = (path: unknown): path is string =>
  typeof path === 'string' && path.startsWith('/') && !path.includes('\0') && Buffer.byteLength(path) <= 4096;
const offset = (value: unknown) => value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);

export function validateFileQuery(mode: FileOperation, query: FileQuery) {
  if (
    !['files', 'file-preview'].includes(mode) ||
    !guestPath(query.path) ||
    (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0 || query.offset > 20_000)) ||
    (query.filter !== undefined && (typeof query.filter !== 'string' || query.filter.length > 256))
  ) {
    throw invalid();
  }
}

/** A file or folder name inside the folder being viewed: never a path. */
export function validName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\0') &&
    Buffer.byteLength(name) <= 255
  );
}

export function validateDownloadQuery(query: DownloadQuery) {
  if (
    !guestPath(query.path) ||
    !offset(query.start) ||
    !offset(query.end) ||
    (query.end !== undefined && query.end < (query.start ?? 0)) ||
    (query.match !== undefined && (typeof query.match !== 'string' || !/^"[0-9a-f]+-[0-9a-f]+"$/.test(query.match)))
  )
    throw invalid();
}

export const validUpload = (upload: unknown): upload is string =>
  typeof upload === 'string' && /^[0-9a-f]{32}$/.test(upload);

export function validateUploadQuery(query: UploadQuery) {
  if (
    !guestPath(query.path) ||
    !validName(query.name) ||
    !validUpload(query.upload) ||
    ![query.size, query.offset, query.length].every(value => Number.isSafeInteger(value) && value >= 0) ||
    query.offset + query.length > query.size ||
    !['refuse', 'overwrite', 'rename'].includes(query.mode)
  )
    throw invalid();
  if (query.length > MAX_PART) throw new ResourceError(413, 'An upload part is at most 64 MiB.');
}

const MESSAGES: Record<number, string> = {
  400: 'Path is not available.',
  403: 'Path access denied (symlinks and virtual filesystems are unsupported).',
  404: 'Path not found.',
  409: 'A file with that name already exists.',
  412: 'The file changed while it was downloaded.',
  416: 'The requested range is not available.',
  504: 'File operation timed out.',
  507: 'There is not enough free space on this computer.',
};
/** The guest's own (fixed) messages for these statuses are operator-safe and say what to do; others are mapped. */
const GUEST_MESSAGES = new Set([
  'A file with that name already exists.',
  'A folder has that name.',
  'A symbolic link has that name; it is not replaced.',
  'The upload did not finish.',
  'The upload was interrupted; start it again.',
  'Invalid upload part.',
  'The file changed while it was downloaded.',
  'Use a file name without slashes, of at most 255 bytes.',
  'The file name is too long.',
  'Only regular files are available.',
  'Choose a directory.',
]);

/** The guest's status line: a result, or the error it maps to (never raw guest text beyond the fixed messages). */
export function headerResult(line: Buffer) {
  let header: { status?: unknown; result?: unknown; message?: unknown; size?: unknown };
  try {
    header = JSON.parse(line.toString());
  } catch {
    throw new ResourceError(503, 'Invalid guest file response.');
  }
  // Each caller checks the result it expects.
  if (header.status === 200) return header.result as Record<string, any>;
  const status = (Object.hasOwn(MESSAGES, String(header.status)) ? Number(header.status) : 503) as
    400 | 403 | 404 | 409 | 412 | 416 | 503 | 504 | 507;
  const message =
    typeof header.message === 'string' && GUEST_MESSAGES.has(header.message)
      ? header.message
      : (MESSAGES[status] ?? 'File operation failed.');
  throw new ResourceError(
    status,
    message,
    status === 416 && Number.isSafeInteger(header.size) ? (header.size as number) : undefined,
  );
}

export function decodeFileResult(raw: Buffer, _mode: FileOperation) {
  const newline = raw.indexOf(10);
  if (newline < 0 || newline > 2 * 1024 * 1024) throw new ResourceError(503, 'Invalid guest file response.');
  const result = headerResult(raw.subarray(0, newline));
  if (raw.length > newline + 1) throw new ResourceError(503, 'Invalid guest file response.');
  return { result };
}

/**
 * Splits a guest stream into its status line and the bytes after it, reading no further than the line (at most
 * 64 KiB). The iterator stays open for the caller to continue.
 */
export async function readStatusLine(iterator: AsyncIterator<Buffer>) {
  let buffer: Buffer = Buffer.alloc(0);
  while (true) {
    const newline = buffer.indexOf(10);
    if (newline >= 0) return { line: buffer.subarray(0, newline), rest: buffer.subarray(newline + 1) };
    if (buffer.length > 65536) throw new ResourceError(503, 'Invalid guest file response.');
    const next = await iterator.next();
    if (next.done) throw new ResourceError(503, 'Invalid guest file response.');
    buffer = buffer.length ? Buffer.concat([buffer, next.value]) : next.value;
  }
}

export function downloadResult(result: Record<string, unknown>): DownloadResult {
  const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  if (
    typeof result?.name !== 'string' ||
    !integer(result.size) ||
    !integer(result.start) ||
    !integer(result.length) ||
    (result.start as number) + (result.length as number) > (result.size as number) ||
    typeof result.etag !== 'string' ||
    !/^"[0-9a-f]+-[0-9a-f]+"$/.test(result.etag) ||
    typeof result.modified !== 'string' ||
    !/^[A-Za-z0-9 ,:]{1,40}$/.test(result.modified)
  )
    throw new ResourceError(503, 'Invalid guest file response.');
  return result as DownloadResult;
}

/** RFC 5987 value, with an inert ASCII fallback; never raw guest header text. */
export function fileAttachment(name: string) {
  const safe = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 255);
  return `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
