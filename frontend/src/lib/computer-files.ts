import { api } from '../api/client';
import type { paths } from '../api/schema';

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
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
export function fileBreadcrumbs(path: string) {
  const parts = path.split('/').filter(Boolean);
  return [
    { name: '/', path: '/' },
    ...parts.map((name, index) => ({ name, path: '/' + parts.slice(0, index + 1).join('/') })),
  ];
}
export function computerDownloadUrl(id: string, path: string) {
  return `/api/computers/${encodeURIComponent(id)}/download?${new URLSearchParams({ path })}`;
}
/**
 * Explicit operator download of any size: the browser's own download manager streams it to disk (and can resume
 * it with a range). A one-byte range first checks that the file can be read, so a refusal shows here rather than as
 * a failed download. No preview HTML or executable document is rendered.
 */
export async function downloadComputerFile(id: string, file: ComputerFile, signal: AbortSignal) {
  const url = computerDownloadUrl(id, file.path);
  const response = await fetch(url, { signal, cache: 'no-store', headers: { Range: 'bytes=0-0' } });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Could not download this file.');
  }
  await response.body?.cancel().catch(() => {});
  signal.throwIfAborted();
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}
