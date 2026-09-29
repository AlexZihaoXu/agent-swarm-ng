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
  const cancelAll = () => {
    for (const controller of uploads.current.values()) controller.abort();
    uploads.current.clear();
  };
  useEffect(() => {
    setItems([]);
    setNotice('');
    return cancelAll;
  }, [channelKey]);
  const update = (key: string, change: Partial<Attachment>) =>
    setItems(current => current.map(item => (item.key === key ? { ...item, ...change } : item)));

  const add = (files: Iterable<File>) => {
    if (!channelKey) return;
    const picked = [...files];
    const room = MAX_ATTACHMENTS - items.length;
    setNotice(picked.length > room ? `Up to ${MAX_ATTACHMENTS} files go with one message.` : '');
    const added = picked.slice(0, Math.max(0, room)).map(file => ({ file, key: randomUuid() }));
    if (!added.length) return;
    setItems(current => [
      ...current,
      ...added.map(({ file, key }) => ({
        key,
        name: file.name || 'file',
        size: file.size,
        progress: 0,
        status: 'uploading' as const,
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
    setNotice('');
  };
  /** After a send: the uploaded files now belong to the message. */
  const clear = () => {
    cancelAll();
    setItems([]);
    setNotice('');
  };
  return {
    items,
    notice,
    add,
    remove,
    clear,
    ids: items.flatMap(item => (item.status === 'ready' && item.file ? [item.file.id] : [])),
    uploading: items.some(item => item.status === 'uploading'),
    failed: items.some(item => item.status === 'failed'),
  };
}
