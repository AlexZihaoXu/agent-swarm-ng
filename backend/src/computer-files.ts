import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const computerFilesSchema = Type.Object({
  path: Type.String(), parent: Type.Union([Type.String(), Type.Null()]),
  entries: Type.Array(Type.Object({
    name: Type.String(), path: Type.String(), type: Type.Union([Type.Literal('directory'), Type.Literal('file'), Type.Literal('other')]),
    size: nullableNumber, modifiedAt: nullableNumber, isSymlink: Type.Boolean(),
  }), { maxItems: 200 }),
  nextOffset: Type.Union([Type.Integer({ minimum: 0, maximum: 20_000 }), Type.Null()]), truncated: Type.Boolean(),
});
export const computerFilePreviewSchema = Type.Object({
  path: Type.String(), name: Type.String(), size: Type.Number(), text: Type.Union([Type.String(), Type.Null()]),
  truncated: Type.Boolean(), binary: Type.Boolean(),
});
export type ComputerFiles = Static<typeof computerFilesSchema>;
export type ComputerFilePreview = Static<typeof computerFilePreviewSchema>;
export type FileOperation = 'files' | 'file-preview' | 'download';
export type FileQuery = { path: string; offset?: number; filter?: string };
export type FileResult = ComputerFiles | ComputerFilePreview | Buffer;
export const MAX_DOWNLOAD = 64 * 1024 * 1024;
export class ComputerFileError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
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
  } finally { reader.releaseLock(); }
}

export async function fetchComputerFile(fetcher: typeof fetch, baseUrl: string, id: string, mode: FileOperation, query: FileQuery): Promise<FileResult> {
  const url = new URL(`/computers/${encodeURIComponent(id)}/${mode}`, baseUrl);
  url.searchParams.set('path', query.path);
  if (query.offset !== undefined) url.searchParams.set('offset', String(query.offset));
  if (query.filter !== undefined) url.searchParams.set('filter', query.filter);
  const response = await fetcher(url, { signal: AbortSignal.timeout(28_000), redirect: 'error' });
  if (!response.ok) {
    await response.body?.cancel();
    // Controller errors are mapped, not reflected: no raw guest/Docker/host details.
    const messages: Record<number, string> = { 400: 'Path is not available.', 403: 'Path access denied (symlinks and virtual filesystems are unsupported).', 404: 'Computer or path not found.', 409: 'Computer is not running.', 413: 'Downloads are limited to 64 MiB.', 429: 'File operations are busy. Retry shortly.', 504: 'File operation timed out.' };
    throw new ComputerFileError(Object.hasOwn(messages, response.status) ? response.status : 503, messages[response.status] ?? 'File browsing is unavailable.');
  }
  const data = await boundedFileBody(response, mode === 'download' ? MAX_DOWNLOAD : 2 * 1024 * 1024);
  if (mode === 'download') {
    if (response.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream') throw new ComputerFileError(503, 'Invalid download response.');
    return data;
  }
  let result: unknown;
  try { result = JSON.parse(data.toString()); } catch { throw new ComputerFileError(503, 'Invalid file response.'); }
  const schema = mode === 'files' ? computerFilesSchema : computerFilePreviewSchema;
  if (!Value.Check(schema, result) || (mode === 'file-preview' && typeof (result as ComputerFilePreview).text === 'string' && Buffer.byteLength((result as ComputerFilePreview).text!) > 65536)) {
    throw new ComputerFileError(503, 'Invalid file response.');
  }
  return result as ComputerFiles | ComputerFilePreview;
}

export function fileAttachment(path: string) {
  const name = (path.split('/').pop() || 'download').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 255);
  return `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
