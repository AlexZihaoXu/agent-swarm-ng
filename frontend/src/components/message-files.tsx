import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileIcon } from '@/components/ui/file-icon';
import { fileSize } from '@/lib/computer-files';
import { fileContentUrl, previewChatFile, type ChatFile } from '@/lib/chat-files';
import { cn } from '@/lib/utils';
import { useScratchRevision } from '@/lib/scratch-writers';
import 'highlight.js/styles/github-dark.css';
import './message-markdown.css';

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
    <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-dashed border-border bg-sidebar/40 px-3 py-2 text-muted-foreground">
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
    <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-sidebar px-3 py-2">
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
    <div className="message-code w-full max-w-xl min-w-0 overflow-hidden rounded-lg border border-border bg-sidebar text-foreground">
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
        {(more || expanded) && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
            className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
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

/** Images as a grid: one large, several as squares. Each opens full size in a new tab. */
function ImageGrid({ images }: { images: ChatFile[] }) {
  const single = images.length === 1;
  return (
    <div className={cn('grid w-full max-w-md gap-1', !single && 'grid-cols-2', images.length >= 5 && 'sm:grid-cols-3')}>
      {images.map(image => (
        <a
          key={image.id}
          href={fileContentUrl(image.id)}
          target="_blank"
          rel="noopener noreferrer"
          title={image.name}
          className="block min-w-0 overflow-hidden rounded-lg border border-border bg-sidebar outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            src={fileContentUrl(image.id)}
            alt={image.name}
            loading="lazy"
            className={cn('block w-full', single ? 'max-h-80 object-contain' : 'aspect-square object-cover')}
          />
        </a>
      ))}
    </div>
  );
}

/** A message's files, below its text: images together, then text previews, then other files. */
export function MessageFiles({ files, align = 'start' }: { files: ChatFile[]; align?: 'start' | 'end' }) {
  if (!files.length) return null;
  const images = files.filter(file => file.status === 'available' && file.kind === 'image');
  const rest = files.filter(file => !images.includes(file));
  return (
    <div
      aria-label={`${files.length} ${files.length === 1 ? 'file' : 'files'}`}
      role="group"
      // A steady width (like Discord's previews) instead of shrinking to a short caption.
      className={cn(
        'flex w-[28rem] min-w-0 max-w-full flex-col gap-1.5',
        align === 'end' ? 'items-end' : 'items-start',
      )}
    >
      {images.length > 0 && <ImageGrid images={images} />}
      {rest.map(file =>
        file.status === 'deleted' ? (
          <DeletedFile key={file.id} file={file} />
        ) : file.kind === 'text' || file.kind === 'scratch' ? (
          <TextFile key={file.id} file={file} />
        ) : (
          <GenericFile key={file.id} file={file} />
        ),
      )}
    </div>
  );
}
