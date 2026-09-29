import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { MessageReply } from '@/components/message-reply';
import { FileIcon } from '@/components/ui/file-icon';
import { fileSize } from '@/lib/computer-files';
import { MAX_ATTACHMENTS } from '@/lib/chat-files';
import type { Attachments } from '@/lib/use-attachments';
import { cn } from '@/lib/utils';

export function ChatComposer({
  name,
  draft,
  onChange,
  onSend,
  busy,
  onStop,
  disabled,
  inputRef,
  reply,
  onCancelReply,
  attachments,
}: {
  name: string;
  draft: string;
  onChange: (text: string) => void;
  onSend: () => void;
  busy?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  reply?: { author: string; text: string };
  onCancelReply?: () => void;
  /** Files for the next message; omitted where the human cannot post files. */
  attachments?: Attachments;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const ref = inputRef ?? ownRef;
  useLayoutEffect(() => {
    const input = ref.current;
    if (input) {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
    }
  }, [draft, name]);
  // A message needs text or at least one uploaded file, and waits for uploads to finish.
  const sendable = !disabled && (Boolean(draft.trim()) || Boolean(attachments?.ids.length)) && !attachments?.uploading;
  const send = () => {
    if (sendable) onSend();
  };
  const files = attachments?.items ?? [];
  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files');
  return (
    <form
      aria-label="Message composer"
      onSubmit={event => {
        event.preventDefault();
        send();
      }}
      onDragOver={event => {
        if (!attachments || !hasFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={event => {
        if (!attachments || !hasFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        attachments.add(event.dataTransfer.files);
      }}
      className={cn(
        'rounded-3xl border border-foreground/20 bg-transparent p-3 transition-[border-color,box-shadow] duration-200 focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-ring sm:p-2',
        dragging && 'border-primary ring-2 ring-primary/40',
      )}
    >
      {reply && (
        <div className="mb-2 px-2 pt-1">
          <MessageReply {...reply} onCancel={onCancelReply} />
        </div>
      )}
      {attachments && (files.length > 0 || attachments.notice) && (
        // Kibo input-special-1 list rows: icon, name, size or progress, remove.
        <div className="mb-2 px-1">
          {files.length > 0 && (
            <ul aria-label="Files to send" className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {files.map(file => (
                <li
                  key={file.key}
                  className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-sidebar/60 px-2 py-1 motion-safe:animate-[fade-in_120ms_ease-out]"
                >
                  <FileIcon />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium" title={file.name}>
                      {file.name}
                    </span>
                    <span
                      className={cn(
                        'block text-[11px]',
                        file.status === 'failed' ? 'text-red-400' : 'text-muted-foreground',
                      )}
                    >
                      {file.status === 'failed'
                        ? file.error
                        : file.status === 'uploading'
                          ? `Uploading ${Math.round(file.progress * 100)}% · ${fileSize(file.size)}`
                          : fileSize(file.size)}
                    </span>
                    {file.status === 'uploading' && (
                      <span
                        role="progressbar"
                        aria-label={`Uploading ${file.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(file.progress * 100)}
                        className="mt-1 block h-0.5 overflow-hidden rounded-full bg-foreground/10"
                      >
                        <span
                          className="block h-full bg-primary transition-[width] duration-150"
                          style={{ width: `${file.progress * 100}%` }}
                        />
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    title="Remove"
                    onClick={() => attachments.remove(file.key)}
                    className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg leading-none text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:size-7 sm:text-base"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attachments.notice && (
            <p role="status" className="mt-1 text-[11px] text-muted-foreground">
              {attachments.notice}
            </p>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        {attachments && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              onChange={event => {
                if (event.target.files) attachments.add(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              aria-label="Attach files"
              title={`Attach files (up to ${MAX_ATTACHMENTS})`}
              disabled={disabled || files.length >= MAX_ATTACHMENTS}
              onClick={() => picker.current?.click()}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 sm:size-7"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
              >
                <path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
              </svg>
            </button>
          </>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          maxLength={20000}
          onChange={event => onChange(event.target.value)}
          onPaste={event => {
            if (!attachments || !event.clipboardData.files.length) return;
            event.preventDefault();
            attachments.add(event.clipboardData.files);
          }}
          onKeyDown={event => {
            // Phone keyboards have no Shift+Enter: there Enter starts a new line and the Send button sends.
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229 &&
              !window.matchMedia('(pointer: coarse)').matches
            ) {
              event.preventDefault();
              send();
            }
          }}
          enterKeyHint={
            typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'enter' : 'send'
          }
          aria-label={`Message ${name}`}
          placeholder={`Message ${name}…`}
          className="max-h-32 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-3 pl-2 text-base leading-5 outline-none placeholder:text-muted-foreground sm:min-h-7 sm:py-1 sm:text-sm"
        />
        {busy && onStop && (
          <Button
            type="button"
            size="sm"
            aria-label="Stop response"
            className="control-swap size-11 shrink-0 rounded-full p-0 sm:size-7"
            onClick={onStop}
          >
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-current" />
          </Button>
        )}
        {(!busy || draft.trim() || attachments?.ids.length) && (
          <Button
            type="submit"
            size="sm"
            disabled={!sendable}
            aria-label="Send message"
            className="control-swap size-11 shrink-0 rounded-full p-0 sm:size-7"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="size-4"
            >
              <path d="M12 19V5m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        )}
      </div>
    </form>
  );
}
