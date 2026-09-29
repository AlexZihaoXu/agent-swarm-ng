import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { FileIcon } from '@/components/ui/file-icon';
import { FolderIcon } from '@/components/ui/icons';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { dialogOverlay } from '@/lib/styles';
import { fileSize } from '@/lib/computer-files';
import { deleteChatFile, fileContentUrl, listChatFiles, type ChatFile, type ChatFileSort } from '@/lib/chat-files';
import { cn } from '@/lib/utils';

const inputClass =
  'h-10 min-w-0 rounded-md border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring sm:text-sm';
const kindLabel: Record<ChatFile['kind'], string> = {
  image: 'Image',
  text: 'Text',
  pdf: 'PDF',
  other: 'File',
  scratch: 'Live',
};
const columns: { sort: ChatFileSort; label: string; className: string }[] = [
  { sort: 'name', label: 'Name', className: '' },
  { sort: 'type', label: 'Type', className: 'hidden sm:block' },
  { sort: 'size', label: 'Size', className: 'hidden sm:block' },
  { sort: 'date', label: 'Sent', className: 'hidden sm:block' },
];
const grid = 'grid-cols-[1.5rem_minmax(0,1fr)_2.75rem] sm:grid-cols-[1.5rem_minmax(0,1fr)_4rem_5rem_7rem_2.75rem]';

/**
 * A chat's Files (Kibo dialog-standard-3 frame, as the computer File browser, with a data-table-standard-1 table
 * and a data-table-standard-2 filter): every file sent here, searchable and sortable; the human downloads or
 * deletes them. A deleted file leaves a tombstone in the conversation.
 */
export function ChatFilesDialog({
  channelKey,
  title,
  className,
}: {
  channelKey: string;
  title: string;
  className?: string;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ by: ChatFileSort; order: 'asc' | 'desc' }>({ by: 'date', order: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ChatFile[] | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setSelected(new Set());
    setSearch('');
    setQuery('');
  }, [channelKey]);
  const listing = useQuery({
    queryKey: ['chat-files', channelKey, query, sort.by, sort.order],
    queryFn: ({ signal }) => listChatFiles(channelKey, { query, sort: sort.by, order: sort.order }, signal),
    enabled: open,
    placeholderData: previous => previous,
  });
  const files = listing.data?.files ?? [];
  const visible = new Set(files.map(file => file.id));
  const chosen = files.filter(file => selected.has(file.id));
  const allChosen = files.length > 0 && chosen.length === files.length;
  // Files deleted elsewhere (an agent, another view) drop out of the list.
  useEffect(() => {
    const deleted = (event: Event) => {
      const file = (event as CustomEvent<ChatFile>).detail;
      if (file.channelKey === channelKey) void client.invalidateQueries({ queryKey: ['chat-files', channelKey] });
    };
    window.addEventListener('swarm-file-deleted', deleted);
    return () => window.removeEventListener('swarm-file-deleted', deleted);
  }, [client, channelKey]);

  const toggle = (id: string) =>
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sortBy = (by: ChatFileSort) =>
    setSort(current =>
      current.by === by
        ? { by, order: current.order === 'asc' ? 'desc' : 'asc' }
        : { by, order: by === 'name' || by === 'type' ? 'asc' : 'desc' },
    );
  async function remove(targets: ChatFile[]) {
    const failures: string[] = [];
    for (const file of targets) {
      try {
        await deleteChatFile(file.id);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `Could not delete ${file.name}.`);
      }
    }
    setSelected(current => new Set([...current].filter(id => !targets.some(file => file.id === id))));
    await client.invalidateQueries({ queryKey: ['chat-files', channelKey] });
    if (failures.length) throw new Error(failures.join(' '));
  }
  const usage = listing.data?.usage;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Chat files"
          title="Files"
          className={cn('size-11 border-0 p-0 sm:size-8', className)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
          >
            <path d="M3 7V5h6l2 2h10v13H3zM3 10h18" />
          </svg>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(85dvh,44rem)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in] sm:w-[calc(100%-2rem)]">
          <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <Dialog.Title className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
                Files · {title}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="outline" size="sm" className="size-10 shrink-0 p-0" aria-label="Close files">
                  ×
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-1 text-xs text-muted-foreground">
              Files sent in this chat. Download or delete them; a deleted file stays in the chat as “Deleted”.
            </Dialog.Description>
          </header>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-5">
            <input
              type="search"
              aria-label="Search files by name"
              placeholder="Search files…"
              maxLength={200}
              value={search}
              onChange={event => setSearch(event.target.value)}
              className={cn(inputClass, 'min-w-40 flex-1')}
            />
            {chosen.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-10 text-red-400 motion-safe:animate-[fade-in_120ms_ease-out]"
                onClick={() => setConfirm(chosen)}
              >
                Delete {chosen.length}
              </Button>
            )}
          </div>
          <ScrollArea label="Chat files" className="min-h-0 min-w-0 flex-1">
            <div className="min-w-0 p-3 sm:p-4">
              {listing.isError && (
                <p role="alert" className="mb-3 text-sm text-red-400">
                  {listing.error.message}{' '}
                  <button type="button" className="cursor-pointer underline" onClick={() => void listing.refetch()}>
                    Retry
                  </button>
                </p>
              )}
              {listing.isPending && (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading files…
                </p>
              )}
              {listing.data && !files.length && (
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyMedia>
                      <FolderIcon />
                    </EmptyMedia>
                    <EmptyTitle className="text-base">{query ? 'No matches' : 'No files yet'}</EmptyTitle>
                    <EmptyDescription>
                      {query ? 'No file names match this search.' : 'Files sent in this chat appear here.'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {files.length > 0 && (
                <div role="table" aria-label="Files" aria-rowcount={files.length + 1} className="min-w-0">
                  <div
                    role="row"
                    className={cn(
                      'grid items-center gap-3 border-b border-border px-2 pb-2 text-xs text-muted-foreground',
                      grid,
                    )}
                  >
                    <span role="columnheader" className="flex items-center">
                      <input
                        type="checkbox"
                        aria-label="Select all files"
                        checked={allChosen}
                        ref={input => {
                          if (input) input.indeterminate = chosen.length > 0 && !allChosen;
                        }}
                        onChange={() => setSelected(allChosen ? new Set() : new Set(visible))}
                        className="size-4 cursor-pointer accent-primary"
                      />
                    </span>
                    {columns.map(column => (
                      <span
                        key={column.sort}
                        role="columnheader"
                        aria-sort={
                          sort.by === column.sort ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                        className={column.className}
                      >
                        <button
                          type="button"
                          onClick={() => sortBy(column.sort)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {column.label}
                          <span aria-hidden="true" className={cn(sort.by !== column.sort && 'opacity-0')}>
                            {sort.order === 'asc' ? '↑' : '↓'}
                          </span>
                        </button>
                      </span>
                    ))}
                    <span role="columnheader" className="sr-only">
                      Delete
                    </span>
                  </div>
                  <div role="rowgroup" className="divide-y divide-border">
                    {files.map(file => {
                      const sent = new Date(file.createdAt);
                      return (
                        <div
                          key={file.id}
                          role="row"
                          aria-selected={selected.has(file.id)}
                          className={cn(
                            'grid min-w-0 items-center gap-3 rounded px-2 py-1.5 transition-colors',
                            grid,
                            selected.has(file.id) && 'bg-muted/60',
                          )}
                        >
                          <span role="cell" className="flex items-center">
                            <input
                              type="checkbox"
                              aria-label={`Select ${file.name}`}
                              checked={selected.has(file.id)}
                              onChange={() => toggle(file.id)}
                              className="size-4 cursor-pointer accent-primary"
                            />
                          </span>
                          <span role="cell" className="flex min-w-0 items-center gap-2">
                            <FileIcon />
                            <span className="min-w-0">
                              <a
                                href={fileContentUrl(file.id, true)}
                                download={file.name}
                                title={`Download ${file.name}`}
                                className="block truncate text-sm outline-none hover:text-primary hover:underline focus-visible:underline"
                              >
                                {file.name}
                              </a>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {file.uploader.name}
                                <span className="sm:hidden">
                                  {' '}
                                  · {fileSize(file.size)} · {sent.toLocaleDateString()}
                                </span>
                              </span>
                            </span>
                          </span>
                          <span role="cell" className="hidden text-xs text-muted-foreground sm:block">
                            {kindLabel[file.kind]}
                          </span>
                          <span role="cell" className="hidden text-xs text-muted-foreground sm:block">
                            {fileSize(file.size)}
                          </span>
                          <time
                            role="cell"
                            dateTime={sent.toISOString()}
                            title={sent.toLocaleString()}
                            className="hidden text-xs text-muted-foreground sm:block"
                          >
                            {sent.toLocaleDateString()}
                          </time>
                          <span role="cell" className="flex justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={`Delete ${file.name}`}
                              title="Delete"
                              className="size-10 border-0 p-0 text-muted-foreground hover:text-red-400"
                              onClick={() => setConfirm([file])}
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="size-4"
                              >
                                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                              </svg>
                            </Button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <footer className="flex min-w-0 shrink-0 items-center gap-3 border-t border-border px-3 py-3 sm:px-5">
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">
              <p role="status">
                {chosen.length
                  ? `${chosen.length} of ${files.length} selected`
                  : `${files.length} ${files.length === 1 ? 'file' : 'files'}${listing.data ? ` · ${fileSize(listing.data.totalBytes)}` : ''}`}
              </p>
              {usage && (
                <p className={cn('mt-1 text-[10px]', usage.warning && 'text-amber-400')}>
                  Swarm storage: {fileSize(usage.bytes)} of {fileSize(usage.budgetBytes)} used
                  {usage.full ? ' · Full: new uploads are refused' : usage.warning ? ' · Nearly full' : ''}
                </p>
              )}
            </div>
            <Dialog.Close asChild>
              <Button size="sm" variant="outline" className="min-h-10 shrink-0">
                Close
              </Button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={value => !value && setConfirm(null)}
        title={confirm?.length === 1 ? `Delete ${confirm[0].name}?` : `Delete ${confirm?.length ?? 0} files?`}
        description="The files are removed for everyone, including agents. The chat keeps each name, marked Deleted."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={() => remove(confirm ?? [])}
      />
    </Dialog.Root>
  );
}
