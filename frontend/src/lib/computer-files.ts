import { api } from '../api/client';
import type { paths } from '../api/schema';

export const FILE_DOWNLOAD_LIMIT = 64 * 1024 * 1024;
export type ComputerFileList =
  paths['/api/computers/{id}/files']['get']['responses'][200]['content']['application/json'];
export type ComputerFile = ComputerFileList['entries'][number];
export type ComputerFilePreview =
  paths['/api/computers/{id}/file-preview']['get']['responses'][200]['content']['application/json'];

export async function listComputerFiles(
  id: string,
  path: string,
  offset: number,
  filter: string,
  signal: AbortSignal,
): Promise<ComputerFileList> {
  const result = await api.GET('/api/computers/{id}/files', {
    params: { path: { id }, query: { path, offset, filter } },
    signal,
  });
  if (!result.data || result.error) throw new Error(result.error?.message ?? 'Could not list this folder.');
  return result.data;
}
export async function previewComputerFile(id: string, path: string, signal: AbortSignal): Promise<ComputerFilePreview> {
  const result = await api.GET('/api/computers/{id}/file-preview', {
    params: { path: { id }, query: { path } },
    signal,
  });
  if (!result.data || result.error) throw new Error(result.error?.message ?? 'Could not preview this file.');
  return result.data;
}
export function fileSize(bytes: number | null) {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
export function fileBreadcrumbs(path: string) {
  const parts = path.split('/').filter(Boolean);
  return [
    { name: '/', path: '/' },
    ...parts.map((name, index) => ({ name, path: '/' + parts.slice(0, index + 1).join('/') })),
  ];
}
/** Explicit operator download; no preview HTML or executable document is rendered. */
export async function downloadComputerFile(id: string, file: ComputerFile, signal: AbortSignal) {
  const response = await fetch(
    `/api/computers/${encodeURIComponent(id)}/download?${new URLSearchParams({ path: file.path })}`,
    { signal, cache: 'no-store' },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Could not download this file.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The download response was empty.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FILE_DOWNLOAD_LIMIT) throw new Error('Downloads are limited to 64 MiB per file.');
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
