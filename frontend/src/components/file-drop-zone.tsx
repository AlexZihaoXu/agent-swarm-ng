import { useRef, useState, type DragEvent } from 'react';
import { MAX_ATTACHMENTS } from '@/lib/chat-files';
import type { Attachments } from '@/lib/use-attachments';

/** What is being dragged, as far as a browser tells before the drop: how many files, and their kinds. */
type Dragged = { count: number; kinds: string[] };

const KINDS: [RegExp, string][] = [
  [/^image\//, 'image'],
  [/^video\//, 'video'],
  [/^audio\//, 'audio'],
  [/^application\/pdf$/, 'PDF'],
  [/zip|x-7z|x-rar|x-tar|gzip/, 'archive'],
  [/^text\/html$/, 'HTML'],
  [/^text\/|json|xml|javascript|typescript/, 'text'],
  [/word|officedocument|opendocument|msword|excel|powerpoint|spreadsheet|presentation/, 'document'],
];
function draggedOf(event: DragEvent): Dragged {
  const files = [...event.dataTransfer.items].filter(item => item.kind === 'file');
  const kinds = new Set<string>();
  for (const file of files) {
    const kind = KINDS.find(([pattern]) => pattern.test(file.type))?.[1];
    if (kind) kinds.add(kind);
  }
  return { count: files.length, kinds: [...kinds] };
}
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Files dropped anywhere on a conversation attach to its next message (not only on the input bar). While files are
 * dragged over it, the conversation dims and a dashed frame says how many and of what kinds. Spread `handlers` on
 * the conversation's element (positioned) and render `overlay` inside it.
 */
export function useFileDrop(attachments: Attachments | undefined) {
  const [dragged, setDragged] = useState<Dragged | null>(null);
  // dragenter/dragleave fire for every child crossed: count them so the overlay does not flicker.
  const depth = useRef(0);
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const handlers = attachments
    ? {
        onDragEnter: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          depth.current++;
          setDragged(draggedOf(event));
        },
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setDragged(null);
        },
        onDrop: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          depth.current = 0;
          setDragged(null);
          attachments.add(event.dataTransfer.files);
        },
      }
    : {};
  const room = MAX_ATTACHMENTS - (attachments?.items.length ?? 0);
  const overlay = dragged && (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-6 motion-safe:animate-[fade-in_140ms_ease-out]"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-foreground/50 bg-background/70 px-6 py-10 text-center shadow-2xl backdrop-blur-sm motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-9 text-muted-foreground"
        >
          <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        <p className="text-base font-semibold">
          {dragged.count ? `Drop ${plural(dragged.count, 'file')} to attach` : 'Drop files to attach'}
        </p>
        {dragged.kinds.length > 0 && <p className="text-sm text-muted-foreground">{dragged.kinds.join(' · ')}</p>}
        <p className="text-xs text-muted-foreground">
          {room <= 0
            ? `This message already has ${MAX_ATTACHMENTS} files, the most it can carry.`
            : dragged.count > room
              ? `Only ${plural(room, 'more file')} fit in this message (${MAX_ATTACHMENTS} at most).`
              : 'They upload now and go with your next message.'}
        </p>
      </div>
    </div>
  );
  return { handlers, overlay };
}
