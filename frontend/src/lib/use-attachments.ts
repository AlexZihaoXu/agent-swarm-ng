import { useEffect, useRef, useState } from 'react';
import { randomUuid } from '@/lib/random-uuid';
import { MAX_ATTACHMENTS, uploadChatFile, type ChatFile } from '@/lib/chat-files';

export type Attachment = {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'ready' | 'failed';
  file?: ChatFile;
  error?: string;
  /** A local preview of a picked image (an object URL, released when the file leaves the list). */
  preview?: string;
};
export type Attachments = ReturnType<typeof useAttachments>;

/**
 * Files waiting to go with the next message. Each uploads as soon as it is picked, so sending only attaches ids.
 * A different chat starts with none; removing one cancels its upload.
 */
export function useAttachments(channelKey: string | undefined) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState('');
  const uploads = useRef(new Map<string, AbortController>());
  /** The message these files were sent with and their keys, until the server confirms it (a failed send keeps them). */
  const sentWith = useRef<{ messageId: string; keys: Set<string> } | null>(null);
  const count = useRef(0);
  count.current = items.length;
  const cancelAll = () => {
    for (const controller of uploads.current.values()) controller.abort();
    uploads.current.clear();
  };
  useEffect(() => {
    setItems([]);
    setNotice('');
    sentWith.current = null;
    return cancelAll;
  }, [channelKey]);
  // Release previews of files that left the list (sent, removed, or another chat).
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const kept = new Set(items.flatMap(item => (item.preview ? [item.preview] : [])));
    for (const url of previews.current) if (!kept.has(url)) URL.revokeObjectURL(url);
    previews.current = kept;
  }, [items]);
  useEffect(
    () => () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const update = (key: string, change: Partial<Attachment>) =>
    setItems(current => current.map(item => (item.key === key ? { ...item, ...change } : item)));

  const add = (files: Iterable<File>) => {
    if (!channelKey) return;
    const picked = [...files];
    // Counted across adds made before the next render (a drop and a paste together stay within the limit).
    const room = MAX_ATTACHMENTS - count.current;
    setNotice(picked.length > room ? `Up to ${MAX_ATTACHMENTS} files go with one message.` : '');
    const added = picked.slice(0, Math.max(0, room)).map(file => ({ file, key: randomUuid() }));
    if (!added.length) return;
    count.current += added.length;
    setItems(current => [
      ...current,
      ...added.map(({ file, key }) => ({
        key,
        name: file.name || 'file',
        size: file.size,
        progress: 0,
        status: 'uploading' as const,
        ...(file.type.startsWith('image/') ? { preview: URL.createObjectURL(file) } : {}),
      })),
    ]);
    for (const { file, key } of added) {
      const controller = new AbortController();
      uploads.current.set(key, controller);
      uploadChatFile(channelKey, file, progress => update(key, { progress }), controller.signal)
        .then(saved => update(key, { status: 'ready', progress: 1, file: saved }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          update(key, { status: 'failed', error: error instanceof Error ? error.message : 'Upload failed.' });
        })
        .finally(() => uploads.current.delete(key));
    }
  };
  const remove = (key: string) => {
    uploads.current.get(key)?.abort();
    uploads.current.delete(key);
    setItems(current => current.filter(item => item.key !== key));
    count.current = Math.max(0, count.current - 1);
    setNotice('');
  };
  /** After a send: the uploaded files now belong to the message. */
  const clear = () => {
    cancelAll();
    setItems([]);
    setNotice('');
    sentWith.current = null;
  };
  /** Files sent with a message whose save is not confirmed yet: kept (and resent with a retry) until `settle`. */
  const hold = (messageId: string) => {
    sentWith.current = { messageId, keys: new Set(items.map(item => item.key)) };
  };
  /** Removes the held files once their message is among the confirmed ones (files attached since then stay). */
  const settle = (messageIds: Iterable<string>) => {
    const held = sentWith.current;
    if (!held) return;
    for (const id of messageIds)
      if (id === held.messageId) {
        sentWith.current = null;
        setItems(current => current.filter(item => !held.keys.has(item.key)));
        count.current = Math.max(0, count.current - held.keys.size);
        setNotice('');
        return;
      }
  };
  return {
    items,
    notice,
    add,
    remove,
    clear,
    hold,
    settle,
    ids: items.flatMap(item => (item.status === 'ready' && item.file ? [item.file.id] : [])),
    uploading: items.some(item => item.status === 'uploading'),
    failed: items.some(item => item.status === 'failed'),
  };
}
