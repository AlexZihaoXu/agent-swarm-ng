import { readFileSync } from 'node:fs';
import { ResourceError } from './resources';

export const operatorFilesScript = readFileSync(new URL('./operator-files.py', import.meta.url), 'utf8');
export const MAX_DOWNLOAD = 64 * 1024 * 1024;
export type FileOperation = 'files' | 'file-preview' | 'download';
export type FileQuery = { path: string; offset?: number; filter?: string };

export function validateFileQuery(mode: FileOperation, query: FileQuery) {
  if (
    !['files', 'file-preview', 'download'].includes(mode) ||
    typeof query.path !== 'string' ||
    !query.path.startsWith('/') ||
    query.path.includes('\0') ||
    Buffer.byteLength(query.path) > 4096 ||
    (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0 || query.offset > 20_000)) ||
    (query.filter !== undefined && (typeof query.filter !== 'string' || query.filter.length > 256))
  ) {
    throw new ResourceError(400, 'Invalid guest file request.');
  }
}

export function decodeFileResult(raw: Buffer, mode: FileOperation) {
  const newline = raw.indexOf(10);
  if (newline < 0 || newline > 2 * 1024 * 1024) throw new ResourceError(503, 'Invalid guest file response.');
  let header;
  try {
    header = JSON.parse(raw.subarray(0, newline).toString());
  } catch {
    throw new ResourceError(503, 'Invalid guest file response.');
  }
  if (header.status !== 200) {
    const messages: Record<number, string> = {
      400: 'Path is not available.',
      403: 'Path access denied (symlinks and virtual filesystems are unsupported).',
      404: 'Path not found.',
      413: 'Downloads are limited to 64 MiB.',
      504: 'File operation timed out.',
    };
    const status = (Object.hasOwn(messages, header.status) ? Number(header.status) : 503) as
      400 | 403 | 404 | 413 | 503 | 504;
    throw new ResourceError(status, messages[status] ?? 'File operation failed.');
  }
  const bytes = raw.subarray(newline + 1);
  if (mode === 'download') {
    if (bytes.length > MAX_DOWNLOAD || typeof header.result?.name !== 'string')
      throw new ResourceError(503, 'Invalid guest file response.');
    return { result: header.result, bytes };
  }
  if (bytes.length) throw new ResourceError(503, 'Invalid guest file response.');
  return { result: header.result, bytes: null };
}

/** RFC 5987 value, with an inert ASCII fallback; never raw guest header text. */
export function fileAttachment(name: string) {
  const safe = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 255);
  return `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
