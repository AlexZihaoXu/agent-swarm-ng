import { controllerHeaders } from './controller-auth';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const computerFilesSchema = Type.Object({
  path: Type.String(),
  parent: Type.Union([Type.String(), Type.Null()]),
  entries: Type.Array(
    Type.Object({
      name: Type.String(),
      path: Type.String(),
      type: Type.Union([Type.Literal('directory'), Type.Literal('file'), Type.Literal('other')]),
      size: nullableNumber,
      modifiedAt: nullableNumber,
      isSymlink: Type.Boolean(),
    }),
    { maxItems: 200 },
  ),
  nextOffset: Type.Union([Type.Integer({ minimum: 0, maximum: 20_000 }), Type.Null()]),
  truncated: Type.Boolean(),
});
export const computerFilePreviewSchema = Type.Object({
  path: Type.String(),
  name: Type.String(),
  size: Type.Number(),
  text: Type.Union([Type.String(), Type.Null()]),
  truncated: Type.Boolean(),
  binary: Type.Boolean(),
});
export type ComputerFiles = Static<typeof computerFilesSchema>;
export type ComputerFilePreview = Static<typeof computerFilePreviewSchema>;
export type FileOperation = 'files' | 'file-preview';
export type FileQuery = { path: string; offset?: number; filter?: string };
export type FileResult = ComputerFiles | ComputerFilePreview;
export const uploadResultSchema = Type.Object({ name: Type.String(), path: Type.String(), size: Type.Integer() });
export const uploadProgressSchema = Type.Object({ received: Type.Integer() });
export const folderResultSchema = Type.Object({ path: Type.String(), created: Type.Boolean() });
export type UploadMode = 'refuse' | 'overwrite' | 'rename';
/** One part of an upload (see the controller's UploadQuery): `length` bytes at `offset` of a `size`-byte file. */
export type UploadQuery = {
  path: string;
  name: string;
  size: number;
  offset: number;
  length: number;
  upload: string;
  mode: UploadMode;
};
/** The largest upload part one request may carry: this runtime reads a request body into memory as it arrives. */
export const MAX_UPLOAD_PART = 64 * 1024 * 1024;
/** One HTTP byte range (RFC 9110): from `start` (to `end`), or the last `suffix` bytes. */
export type ByteRange = { start: number; end?: number } | { suffix: number };
/** One piece of a guest file, read whole (pieces are bounded): where it is in the file, and the file's validators. */
export type GuestPiece = {
  size: number;
  start: number;
  length: number;
  etag: string;
  modified: string;
  data: Uint8Array;
};
export class ComputerFileError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** A refused range: the file's size, for `Content-Range: bytes *\/size`. */
    readonly size?: number,
  ) {
    super(message);
  }
}

/**
 * A single `bytes=` range, or null to send the whole file: several ranges, other units and malformed values are
 * ignored as RFC 9110 allows (the whole file is a correct answer to any of them).
 */
export function parseRange(header: string | undefined): ByteRange | null {
  const match = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(header?.trim() ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) return { suffix: Number(match[2]) };
  const start = Number(match[1]);
  if (!match[2]) return { start };
  const end = Number(match[2]);
  return end < start ? null : { start, end };
}

/** Controller statuses mapped to fixed messages; the controller's own ResourceError messages are operator-safe. */
const TRANSFER_STATUSES = new Set([400, 403, 404, 409, 412, 413, 416, 429, 504, 507]);
async function transferError(response: Response) {
  let message = '';
  try {
    const body = JSON.parse(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 4096)));
    if (typeof body?.message === 'string') message = body.message.slice(0, 200);
  } catch {
    /* a generic message below */
  }
  const status = TRANSFER_STATUSES.has(response.status) ? response.status : 503;
  const size = Number(response.headers.get('x-file-size'));
  return new ComputerFileError(
    status,
    status === 503 ? 'File transfer is unavailable.' : message || 'File transfer failed.',
    status === 416 && Number.isSafeInteger(size) ? size : undefined,
  );
}

/**
 * Reads one piece (bytes `start` to `end`) of a guest file. `match`: the validator the file had at the first piece;
 * a changed file is refused (412) instead of being stitched together.
 */
export async function fetchComputerPiece(
  fetcher: typeof fetch,
  baseUrl: string,
  id: string,
  query: { path: string; start: number; end: number; match?: string },
  signal: AbortSignal,
): Promise<GuestPiece> {
  const url = new URL(`/computers/${encodeURIComponent(id)}/download`, baseUrl);
  url.searchParams.set('path', query.path);
  url.searchParams.set('start', String(query.start));
  url.searchParams.set('end', String(query.end));
  if (query.match !== undefined) url.searchParams.set('match', query.match);
  const response = await fetcher(url, { signal, redirect: 'error', headers: controllerHeaders() });
  if (!response.ok) throw await transferError(response);
  const number = (name: string) => {
    const value = Number(response.headers.get(name) ?? NaN);
    return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  };
  const piece = {
    size: number('x-file-size'),
    start: number('x-range-start'),
    length: number('x-range-length'),
    etag: response.headers.get('etag') ?? '',
    modified: response.headers.get('last-modified') ?? '',
  };
  if (
    response.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream' ||
    [piece.size, piece.start, piece.length].some(Number.isNaN) ||
    piece.start !== query.start ||
    piece.length > query.end - query.start + 1 ||
    piece.start + piece.length > piece.size ||
    !/^"[0-9a-f]+-[0-9a-f]+"$/.test(piece.etag) ||
    !/^[A-Za-z0-9 ,:]{1,40}$/.test(piece.modified)
  ) {
    await response.body?.cancel().catch(() => {});
    throw new ComputerFileError(503, 'Invalid download response.');
  }
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength !== piece.length) throw new ComputerFileError(503, 'The file changed while it was downloaded.');
  return { ...piece, data };
}

/** Streams one upload part to the controller (bounded by MAX_UPLOAD_PART). */
export async function fetchComputerUpload(
  fetcher: typeof fetch,
  baseUrl: string,
  id: string,
  query: UploadQuery,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) {
  const url = new URL(`/computers/${encodeURIComponent(id)}/upload`, baseUrl);
  // The part's length travels in the query: a streamed fetch body may be sent chunked, without a Content-Length.
  url.search = new URLSearchParams({
    ...query,
    size: String(query.size),
    offset: String(query.offset),
    length: String(query.length),
  }).toString();
  const response = await fetcher(url, {
    method: 'PUT',
    body,
    duplex: 'half',
    signal,
    redirect: 'error',
    headers: { ...controllerHeaders(), 'content-type': 'application/octet-stream' },
    timeout: false,
  } as RequestInit);
  if (!response.ok) throw await transferError(response);
  const result: unknown = await response.json().catch(() => null);
  const last = query.offset + query.length === query.size;
  if (last ? !Value.Check(uploadResultSchema, result) : !Value.Check(uploadProgressSchema, result))
    throw new ComputerFileError(503, 'Invalid upload response.');
  return result as { name: string; path: string; size: number } | { received: number };
}

export async function fetchComputerCancel(
  fetcher: typeof fetch,
  baseUrl: string,
  id: string,
  query: { path: string; name: string; upload: string },
) {
  const url = new URL(`/computers/${encodeURIComponent(id)}/upload`, baseUrl);
  url.search = new URLSearchParams(query).toString();
  const response = await fetcher(url, {
    method: 'DELETE',
    signal: AbortSignal.timeout(28_000),
    redirect: 'error',
    headers: controllerHeaders(),
  });
  if (!response.ok) throw await transferError(response);
  await response.body?.cancel().catch(() => {});
}

export async function fetchComputerFolder(
  fetcher: typeof fetch,
  baseUrl: string,
  id: string,
  path: string,
  name: string,
) {
  const response = await fetcher(new URL(`/computers/${encodeURIComponent(id)}/folder`, baseUrl), {
    method: 'POST',
    body: JSON.stringify({ path, name }),
    signal: AbortSignal.timeout(28_000),
    redirect: 'error',
    headers: { ...controllerHeaders(), 'content-type': 'application/json' },
  });
  if (!response.ok) throw await transferError(response);
  const result: unknown = await response.json().catch(() => null);
  if (!Value.Check(folderResultSchema, result)) throw new ComputerFileError(503, 'Invalid folder response.');
  return result;
}

export async function boundedFileBody(response: Response, maximum: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new ComputerFileError(503, 'Empty file response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new ComputerFileError(503, 'File response exceeded its limit.');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchComputerFile(
  fetcher: typeof fetch,
  baseUrl: string,
  id: string,
  mode: FileOperation,
  query: FileQuery,
): Promise<FileResult> {
  const url = new URL(`/computers/${encodeURIComponent(id)}/${mode}`, baseUrl);
  url.searchParams.set('path', query.path);
  if (query.offset !== undefined) url.searchParams.set('offset', String(query.offset));
  if (query.filter !== undefined) url.searchParams.set('filter', query.filter);
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(28_000),
    redirect: 'error',
    headers: controllerHeaders(),
  });
  if (!response.ok) {
    await response.body?.cancel();
    // Controller errors are mapped, not reflected: no raw guest/Docker/host details.
    const messages: Record<number, string> = {
      400: 'Path is not available.',
      403: 'Path access denied (symlinks and virtual filesystems are unsupported).',
      404: 'Computer or path not found.',
      409: 'Computer is not running.',
      429: 'File operations are busy. Retry shortly.',
      504: 'File operation timed out.',
    };
    throw new ComputerFileError(
      Object.hasOwn(messages, response.status) ? response.status : 503,
      messages[response.status] ?? 'File browsing is unavailable.',
    );
  }
  const data = await boundedFileBody(response, 2 * 1024 * 1024);
  let result: unknown;
  try {
    result = JSON.parse(data.toString());
  } catch {
    throw new ComputerFileError(503, 'Invalid file response.');
  }
  const schema = mode === 'files' ? computerFilesSchema : computerFilePreviewSchema;
  if (
    !Value.Check(schema, result) ||
    (mode === 'file-preview' &&
      typeof (result as ComputerFilePreview).text === 'string' &&
      Buffer.byteLength((result as ComputerFilePreview).text!) > 65536)
  ) {
    throw new ComputerFileError(503, 'Invalid file response.');
  }
  return result as ComputerFiles | ComputerFilePreview;
}

export function fileAttachment(path: string) {
  const name = (path.split('/').pop() || 'download').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 255);
  return `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
