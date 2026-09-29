import { api } from '../api/client';
import type { paths } from '../api/schema';

export type ChatFileList = paths['/api/files']['get']['responses'][200]['content']['application/json'];
export type ChatFile = ChatFileList['files'][number];
export type ChatFileSort = 'date' | 'name' | 'size' | 'type';

/** At most this many files go with one message (the backend enforces it too). */
export const MAX_ATTACHMENTS = 10;

/** The channel a chat's files belong to (matches the backend's channel keys). */
export const chatFilesKey = (channelId: string) => `chat:${channelId}`;
export const groupFilesKey = (groupId: string) => `group:${groupId}`;
export const dmFilesKey = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`;

/** Images open in the browser; everything else (and `download`) saves as a file. */
export const fileContentUrl = (id: string, download = false) =>
  `/api/files/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`;

export async function listChatFiles(
  channelKey: string,
  options: { query?: string; sort?: ChatFileSort; order?: 'asc' | 'desc' },
  signal?: AbortSignal,
) {
  const { data, error } = await api.GET('/api/files', {
    params: { query: { channelKey, ...options, query: options.query || undefined } },
    signal,
  });
  if (!data) throw new Error(error?.message ?? 'Could not load files.');
  return data;
}
export async function deleteChatFile(id: string) {
  const { data, error } = await api.DELETE('/api/files/{id}', { params: { path: { id } } });
  if (!data) throw new Error(error?.message ?? 'Could not delete this file.');
  return data;
}
export async function previewChatFile(id: string, limit: number, signal?: AbortSignal) {
  const { data, error } = await api.GET('/api/files/{id}/text', { params: { path: { id }, query: { limit } }, signal });
  if (!data) throw new Error(error?.message ?? 'Could not preview this file.');
  return data;
}

/**
 * Streams one file into a channel as the raw request body, reporting upload progress (fetch cannot).
 * Resolves with the saved file; rejects with the server's message.
 */
export function uploadChatFile(
  channelKey: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<ChatFile>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const query = new URLSearchParams({ channelKey, name: file.name || 'file' });
    request.open('POST', `/api/files?${query}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.responseType = 'json';
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status === 201 && request.response?.id) resolve(request.response as ChatFile);
      else reject(new Error(request.response?.message ?? `Upload failed (${request.status}).`));
    };
    request.onerror = () => reject(new Error('Upload failed. Check the connection and try again.'));
    request.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'));
    signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}

/** A file from a live event, checked before it reaches the UI. */
export function isChatFile(value: unknown): value is ChatFile {
  const file = value as ChatFile | null;
  return (
    typeof file?.id === 'string' &&
    typeof file.name === 'string' &&
    typeof file.size === 'number' &&
    ['image', 'text', 'pdf', 'other'].includes(file.kind) &&
    ['available', 'deleted'].includes(file.status)
  );
}
export const chatFiles = (value: unknown) => (Array.isArray(value) ? value.filter(isChatFile) : undefined);

/** Replaces a file (after a deletion) wherever a message list carries it. */
export function replaceFile<T extends { files?: ChatFile[] }>(messages: T[], file: ChatFile) {
  let changed = false;
  const next = messages.map(message => {
    if (!message.files?.some(item => item.id === file.id)) return message;
    changed = true;
    return { ...message, files: message.files.map(item => (item.id === file.id ? file : item)) };
  });
  return changed ? next : messages;
}

/** A chat list preview: the text, or for a message of only files, what was sent. */
export function messagePreview(text: string, files?: { name: string }[]) {
  if (text.trim() || !files?.length) return text;
  return files.length === 1 ? `📎 ${files[0].name}` : `📎 ${files.length} files`;
}
