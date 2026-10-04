import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { BorderedBreadcrumb } from '@/components/ui/bordered-breadcrumb';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { FileIcon } from '@/components/ui/file-icon';
import { FolderIcon } from '@/components/ui/icons';
import { fileSize } from '@/lib/computer-files';
import { useScratchRevision } from '@/lib/scratch-writers';

/**
 * Agents → agent → Scratchpad: a read-only look at the agent's scratch files, laid out like the computer File
 * browser (breadcrumbs, a list, a text preview). The human changes files by asking the agent. It refreshes when
 * the agent writes.
 */
export function AgentScratchpad({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [folder, setFolder] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const revision = useScratchRevision(agentId);
  useEffect(() => {
    setFolder('');
    setFile(null);
  }, [agentId]);
  const listing = useQuery({
    queryKey: ['scratch', agentId, folder, revision],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/agents/{id}/scratch', {
        params: { path: { id: agentId }, query: folder ? { folder } : {} },
        signal,
      });
      if (!data) throw new Error(error?.message ?? 'Could not load the scratchpad.');
      return data;
    },
    placeholderData: previous => previous,
  });
  // A folder emptied or moved by the agent: go back up to the top.
  useEffect(() => {
    if (folder && listing.isError) setFolder('');
  }, [folder, listing.isError]);
  // An image file opens as a picture (its listing entry says so, and when it last changed); text opens as pages.
  const entry = file === null ? undefined : listing.data?.files.find(item => item.path === file);
  const image = entry?.kind === 'image' ? entry : null;
  const preview = useQuery({
    queryKey: ['scratch-file', agentId, file, revision, pages],
    enabled: file !== null && !image,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/agents/{id}/scratch/file', {
        params: { path: { id: agentId }, query: { path: file!, limit: 200 * pages } },
        signal,
      });
      if (!data) throw new Error(error?.message ?? 'Could not open this file.');
      return data;
    },
    placeholderData: previous => previous,
  });

  const open = (path: string) => {
    setPages(1);
    setFile(null);
    setFolder(path);
  };
  const parts = (file ?? folder).split('/').filter(Boolean);
  const crumbs = [
    { path: '', name: 'Scratchpad' },
    ...parts.map((name, index) => ({ path: parts.slice(0, index + 1).join('/'), name })),
  ];
  const usage = listing.data?.usage;

  return (
    <section aria-label="Scratchpad" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Scratchpad</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Text files and images {agentName} drafts and presents. Read-only here: ask {agentName} to change them.
        </p>
      </div>
      <div className="min-w-0 space-y-3 rounded-lg border border-border bg-sidebar/30 ao-card p-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <BorderedBreadcrumb
            label="Scratchpad location"
            items={crumbs.map((crumb, index) => ({
              id: crumb.path || 'root',
              text: crumb.name,
              current: index === crumbs.length - 1,
              onSelect: index === crumbs.length - 1 ? undefined : () => open(crumb.path),
            }))}
          />
          {usage && (
            <p className="text-xs text-muted-foreground">
              {usage.files} of {usage.maxFiles} files · {fileSize(usage.bytes)} of {fileSize(usage.maxBytes)}
            </p>
          )}
        </div>
        {file !== null && image ? (
          <div key={file} className="min-w-0 space-y-2 motion-safe:animate-[fade-in_120ms_ease-out]">
            <p className="text-xs text-muted-foreground">
              {fileSize(image.size)} · image · updated {new Date(image.updatedAt).toLocaleString()} · Read-only
            </p>
            <img
              src={`/api/agents/${encodeURIComponent(agentId)}/scratch/image?path=${encodeURIComponent(file)}&v=${encodeURIComponent(image.updatedAt)}`}
              alt={file.split('/').pop()}
              className="max-h-[32rem] max-w-full rounded-lg border border-border bg-sidebar object-contain"
            />
          </div>
        ) : file !== null ? (
          <div key={file} className="min-w-0 space-y-2 motion-safe:animate-[fade-in_120ms_ease-out]">
            {preview.isError && (
              <p role="alert" className="text-sm text-red-400">
                {preview.error.message}{' '}
                <button type="button" className="cursor-pointer underline" onClick={() => setFile(null)}>
                  Back to the folder
                </button>
              </p>
            )}
            {preview.isPending && <p className="text-sm text-muted-foreground">Loading file…</p>}
            {preview.data && (
              <>
                <p className="text-xs text-muted-foreground">
                  {fileSize(preview.data.size)} · {preview.data.totalLines} lines · updated{' '}
                  {new Date(preview.data.updatedAt).toLocaleString()} · Read-only
                </p>
                <pre
                  aria-label="Scratch file preview"
                  className="max-h-[32rem] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-sidebar p-3 font-mono text-xs [overflow-wrap:anywhere]"
                >
                  {preview.data.text || '(Empty file)'}
                </pre>
                {preview.data.nextOffset !== null && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setPages(value => value + 1)}>
                    Show more
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <div key={folder} className="min-w-0 motion-safe:animate-[fade-in_120ms_ease-out]">
            {listing.isPending && <p className="text-sm text-muted-foreground">Loading scratchpad…</p>}
            {listing.isError && !folder && (
              <p role="alert" className="text-sm text-red-400">
                {listing.error.message}{' '}
                <button type="button" className="cursor-pointer underline" onClick={() => void listing.refetch()}>
                  Retry
                </button>
              </p>
            )}
            {listing.data && !listing.data.folders.length && !listing.data.files.length && (
              <Empty className="min-h-40">
                <EmptyHeader>
                  <EmptyMedia>
                    <FolderIcon />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">No scratch files yet</EmptyTitle>
                  <EmptyDescription>{agentName} has not written anything here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {listing.data && (listing.data.folders.length > 0 || listing.data.files.length > 0) && (
              <ul aria-label="Scratch files" className="min-w-0 divide-y divide-border">
                {listing.data.folders.map(entry => (
                  <li key={`folder:${entry.path}`}>
                    <button
                      type="button"
                      onClick={() => open(entry.path)}
                      className="grid min-h-10 w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded px-2 py-2 text-left outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FileIcon directory />
                        <span className="truncate text-sm">{entry.name}/</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {entry.files} {entry.files === 1 ? 'file' : 'files'} · {fileSize(entry.size)}
                      </span>
                    </button>
                  </li>
                ))}
                {listing.data.files.map(entry => (
                  <li key={`file:${entry.path}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setPages(1);
                        setFile(entry.path);
                      }}
                      className="grid min-h-10 w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded px-2 py-2 text-left outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FileIcon />
                        <span className="truncate text-sm">{entry.name}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fileSize(entry.size)} · {new Date(entry.updatedAt).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
