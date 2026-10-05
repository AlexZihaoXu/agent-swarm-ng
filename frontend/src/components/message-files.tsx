import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileIcon } from '@/components/ui/file-icon';
import { fileSize } from '@/lib/computer-files';
import { HtmlViewer } from '@/components/html-viewer';
import { ImageViewer } from '@/components/image-viewer';
import { HTML_VIEW_BYTES, fileContentUrl, isHtmlFile, previewChatFile, type ChatFile } from '@/lib/chat-files';
import { cn } from '@/lib/utils';
import { useScratchRevision } from '@/lib/scratch-writers';
import 'highlight.js/styles/github-dark.css';
import './message-markdown.css';

const ChatVideoPlayer = lazy(() => import('@/components/chat-video-player'));
const PREVIEW_LINES = 12;
const EXPANDED_LINES = 400;
const linkClass =
  'min-w-0 truncate font-medium text-sky-400 underline-offset-2 outline-none hover:underline focus-visible:underline';

/** Names the file and saves it when clicked (the browser never renders a downloaded file). */
function DownloadLink({ file, className }: { file: ChatFile; className?: string }) {
  return (
    <a
      href={fileContentUrl(file.id, true)}
      download={file.name}
      title={`Download ${file.name}`}
      className={cn(linkClass, className)}
    >
      {file.name}
    </a>
  );
}

/** A deleted file keeps its name, who deleted it, and when. */
function DeletedFile({ file }: { file: ChatFile }) {
  const when = file.deleted?.at ? new Date(file.deleted.at) : null;
  return (
    <div className="flex w-full max-w-sm min-w-0 items-center gap-3 rounded-lg border border-dashed border-border bg-sidebar/40 px-3 py-2 text-muted-foreground">
      <FileIcon className="size-7 shrink-0 opacity-60" />
      <span className="min-w-0">
        <span className="block truncate text-sm line-through" title={file.name}>
          {file.name}
        </span>
        <span className="block text-xs">
          Deleted{file.deleted ? ` by ${file.deleted.by.name}` : ''}
          {when && (
            <time dateTime={when.toISOString()} title={when.toLocaleString()}>
              {' '}
              · {when.toLocaleDateString()}
            </time>
          )}
        </span>
      </span>
    </div>
  );
}

/** Any other file: an icon, the name as a download link, and its size. */
function GenericFile({ file }: { file: ChatFile }) {
  return (
    <div className="flex w-full max-w-sm min-w-0 items-center gap-3 rounded-lg border border-border bg-sidebar px-3 py-2">
      <FileIcon className="size-7 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col">
        <DownloadLink file={file} className="text-sm" />
        <span className="text-xs text-muted-foreground">
          {fileSize(file.size)}
          {file.kind === 'pdf' ? ' · PDF' : ''}
        </span>
      </span>
    </div>
  );
}

// highlight.js loads with the first text file preview; it escapes the source, so its HTML is safe to insert.
type Highlight = typeof import('highlight.js/lib/common').default;
let highlightLoading: Promise<Highlight> | undefined;
function useHighlighted(text: string | undefined, name: string) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    setHtml(null);
    if (text === undefined) return;
    let cancelled = false;
    highlightLoading ??= import('highlight.js/lib/common').then(module => module.default);
    void highlightLoading
      .then(hljs => {
        const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
        if (!extension || !hljs.getLanguage(extension) || cancelled) return;
        setHtml(hljs.highlight(text, { language: extension, ignoreIllegals: true }).value);
      })
      .catch(() => {
        highlightLoading = undefined;
      });
    return () => {
      cancelled = true;
    };
  }, [text, name]);
  return html;
}

/**
 * Discord-style text file preview: a name/size bar over the first lines, expandable in place. A live scratch
 * preview reads the agent's file as it is now and refreshes whenever the agent writes to its scratchpad.
 */
function TextFile({ file }: { file: ChatFile }) {
  const [expanded, setExpanded] = useState(false);
  const revision = useScratchRevision(file.scratch?.agentId ?? '');
  const preview = useQuery({
    queryKey: ['file-text', file.id, expanded, file.scratch ? revision : 0],
    queryFn: ({ signal }) => previewChatFile(file.id, expanded ? EXPANDED_LINES : PREVIEW_LINES, signal),
    staleTime: file.scratch ? 0 : Infinity,
    retry: false,
    placeholderData: previous => previous,
  });
  const text = preview.data?.text.replace(/\n$/, '');
  const highlighted = useHighlighted(text, file.name);
  const more = preview.data && (preview.data.nextOffset !== null || preview.data.previewLimited);
  return (
    <div className="message-code w-full min-w-0 overflow-hidden rounded-lg border border-border bg-sidebar text-foreground">
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
        <FileIcon />
        <DownloadLink file={file} className="text-xs" />
        {file.scratch ? (
          <span
            title={`Live from the scratchpad (${file.scratch.path}): updates as ${file.uploader.name} edits it`}
            className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-400"
          >
            Live
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">{fileSize(file.size)}</span>
        )}
        {isHtmlFile(file) && file.size <= HTML_VIEW_BYTES && (
          <span className="ml-auto shrink-0">
            <HtmlViewer id={file.id} name={file.name} revision={file.scratch ? revision : 0} />
          </span>
        )}
        {(more || expanded) && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
            className={cn(
              'shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
              !(isHtmlFile(file) && file.size <= HTML_VIEW_BYTES) && 'ml-auto',
            )}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
      {preview.isError ? (
        <p role="alert" className="px-3 py-2 text-xs text-red-400">
          {preview.error.message}
        </p>
      ) : (
        <div className="relative">
          <pre
            tabIndex={0}
            aria-label={`Preview of ${file.name}`}
            className={cn(
              'overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
              expanded ? 'max-h-[28rem]' : 'max-h-64',
            )}
          >
            {text === undefined ? (
              <span className="text-muted-foreground">Loading preview…</span>
            ) : highlighted !== null ? (
              <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
            ) : (
              <code>{text || '(Empty file)'}</code>
            )}
          </pre>
          {/* A cut-off preview fades out, so it never reads as the whole file. */}
          {!expanded && more && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-sidebar"
            />
          )}
        </div>
      )}
      {!expanded && more && (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className="flex w-full cursor-pointer items-center justify-center gap-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {preview.data!.nextOffset !== null && !preview.data!.previewLimited
            ? `Show all ${preview.data!.totalLines} lines (${preview.data!.totalLines - preview.data!.lines} more)`
            : 'Show more'}
          <span aria-hidden="true">↓</span>
        </button>
      )}
      {expanded && more && (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing the first {preview.data!.lines} lines.{' '}
          <a href={fileContentUrl(file.id, true)} download={file.name} className={linkClass}>
            Download the full file
          </a>
        </p>
      )}
    </div>
  );
}

/** A video: the same name/size bar as a text preview (with a speed button once the player loads), over a player. */
function VideoFile({ file }: { file: ChatFile }) {
  const bar = (speed?: ReactNode) => (
    <div className="flex min-w-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
      <FileIcon />
      <DownloadLink file={file} className="text-xs" />
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{fileSize(file.size)}</span>
      {speed}
    </div>
  );
  return (
    // A set width (a video has no size until it loads; the message column would shrink it to its name).
    <div className="w-[28rem] max-w-full min-w-0 overflow-hidden rounded-lg border border-border bg-sidebar text-foreground">
      <Suspense
        fallback={
          <>
            {bar()}
            <div aria-label="Loading video player" className="aspect-video w-full bg-black" />
          </>
        }
      >
        <ChatVideoPlayer src={fileContentUrl(file.id)} name={file.name} renderBar={bar} />
      </Suspense>
    </div>
  );
}

/** Images as a grid: one large, several as squares. Each opens in the full-screen viewer, paging through them all. */
function ImageGrid({ images }: { images: ChatFile[] }) {
  const single = images.length === 1;
  const [shown, setShown] = useState<number | null>(null);
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className={cn('grid w-full max-w-md gap-1', !single && 'grid-cols-2', images.length >= 5 && 'sm:grid-cols-3')}>
      {images.map((image, index) => (
        <button
          key={image.id}
          ref={element => {
            thumbnails.current[index] = element;
          }}
          type="button"
          onClick={() => setShown(index)}
          aria-label={`View ${image.name}`}
          title={image.name}
          className="block min-w-0 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-sidebar p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            src={fileContentUrl(image.id)}
            alt={image.name}
            loading="lazy"
            className={cn('block w-full', single ? 'max-h-80 object-contain' : 'aspect-square object-cover')}
          />
        </button>
      ))}
      <ImageViewer
        images={images.map(image => ({
          id: image.id,
          name: image.name,
          src: fileContentUrl(image.id),
          download: fileContentUrl(image.id, true),
        }))}
        index={shown}
        onIndexChange={setShown}
        onClose={() => setShown(null)}
        returnFocus={index => thumbnails.current[index]}
      />
    </div>
  );
}

/** A message's files, below its text: images together, then text previews, videos and other files. */
export function MessageFiles({ files, align = 'start' }: { files: ChatFile[]; align?: 'start' | 'end' }) {
  if (!files.length) return null;
  const images = files.filter(file => file.status === 'available' && file.kind === 'image');
  const rest = files.filter(file => !images.includes(file));
  return (
    <div
      aria-label={`${files.length} ${files.length === 1 ? 'file' : 'files'}`}
      role="group"
      // Blocks of their own below the text, sized by kind like Discord: wide code, medium images, compact cards.
      className={cn('flex w-full min-w-0 max-w-2xl flex-col gap-1.5', align === 'end' ? 'items-end' : 'items-start')}
    >
      {images.length > 0 && <ImageGrid images={images} />}
      {rest.map(file =>
        file.status === 'deleted' ? (
          <DeletedFile key={file.id} file={file} />
        ) : file.kind === 'text' || file.kind === 'scratch' ? (
          <TextFile key={file.id} file={file} />
        ) : file.kind === 'video' ? (
          <VideoFile key={file.id} file={file} />
        ) : (
          <GenericFile key={file.id} file={file} />
        ),
      )}
    </div>
  );
}
