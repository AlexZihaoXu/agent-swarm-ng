import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { BorderedBreadcrumb } from '@/components/ui/bordered-breadcrumb';
import { ScrollArea } from '@/components/ui/scroll-area';
import { downloadComputerFile, FILE_DOWNLOAD_LIMIT, fileBreadcrumbs, fileSize, listComputerFiles, previewComputerFile, type ComputerFile } from '@/lib/computer-files';
import type { Computer } from './computer-card';

const home = '/home/agent';
const inputClass = 'h-10 min-w-0 rounded-md border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring sm:text-sm';
function FileIcon({ directory }: { directory: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-muted-foreground"><path d={directory ? 'M3 7V5h6l2 2h10v13H3z' : 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6'} /></svg>;
}
function modified(time: number | null) { return time === null ? '—' : new Date(time).toLocaleDateString(); }

/** Kibo dialog-standard-3 container; owner-approved file-browser body, no nested modal. */
export function ComputerFileBrowser({ computer, open, connected, onOpenChange }: { computer: Computer; open: boolean; connected: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const [location, setLocation] = useState({ path: home, offset: 0 });
  const [filter, setFilter] = useState(''), [appliedFilter, setAppliedFilter] = useState('');
  const [editingPath, setEditingPath] = useState(false), [pathDraft, setPathDraft] = useState(home);
  const pathInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<ComputerFile | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null), [downloadError, setDownloadError] = useState('');
  const [downloadNotice, setDownloadNotice] = useState('');
  const download = useRef<AbortController | null>(null);
  const available = connected && computer.state === 'running';
  const listing = useQuery({ queryKey: ['computer-files', computer.id, 'list', location.path, location.offset, appliedFilter], queryFn: ({ signal }) => listComputerFiles(computer.id, location.path, location.offset, appliedFilter, signal), enabled: open && available && selected === null, retry: false, refetchOnWindowFocus: false });
  const preview = useQuery({ queryKey: ['computer-files', computer.id, 'preview', selected?.path], queryFn: ({ signal }) => previewComputerFile(computer.id, selected!.path, signal), enabled: open && available && selected !== null, retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const busy = listing.isFetching || preview.isFetching || downloading !== null;
  const path = listing.data?.path ?? location.path;
  const crumbs = fileBreadcrumbs(path);
  useEffect(() => {
    if (filter === appliedFilter || busy) return;
    const timer = setTimeout(() => { setAppliedFilter(filter); setLocation(current => ({ ...current, offset: 0 })); }, 250);
    return () => clearTimeout(timer);
  }, [filter, appliedFilter, busy]);
  useEffect(() => { if (editingPath) { pathInput.current?.focus(); pathInput.current?.select(); } }, [editingPath]);
  useEffect(() => {
    if (!open || !available) {
      void client.cancelQueries({ queryKey: ['computer-files', computer.id] });
      download.current?.abort(); setSelected(null); setDownloading(null); setDownloadNotice(''); setDownloadError('');
    }
    return () => { download.current?.abort(); };
  }, [open, available, computer.id, client]);
  const navigate = (next: string) => {
    setSelected(null); setEditingPath(false); setFilter(''); setAppliedFilter(''); setLocation({ path: next, offset: 0 }); setDownloadError(''); setDownloadNotice('');
  };
  const startDownload = async (file: ComputerFile) => {
    if (download.current || !available || file.type !== 'file') return;
    const controller = new AbortController(); download.current = controller;
    setDownloading(file.name); setDownloadError(''); setDownloadNotice('');
    try { await downloadComputerFile(computer.id, file, controller.signal); if (!controller.signal.aborted) setDownloadNotice(`Download started: ${file.name}`); }
    catch (error) { if (!controller.signal.aborted) setDownloadError(error instanceof Error ? error.message : 'Download failed.'); }
    finally { if (download.current === controller) { download.current = null; setDownloading(null); } }
  };
  const downloadButton = (file: ComputerFile, compact = false) => <Button type="button" size="sm" variant="outline" aria-label={`Download ${file.name}`} disabled={!available || busy || file.size !== null && file.size > FILE_DOWNLOAD_LIMIT} title={file.size !== null && file.size > FILE_DOWNLOAD_LIMIT ? 'Maximum download size is 64 MiB' : `Download ${file.name}`} className="min-h-10 shrink-0" onClick={() => void startDownload(file)}>{compact ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg> : 'Download'}</Button>;
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 motion-safe:data-[state=open]:animate-[fade-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_120ms_ease-in]" />
      <Dialog.Content onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLElement>(`[data-computer-id="${CSS.escape(computer.id)}"] button[aria-label^="Actions for"]`)?.focus(); }} className="fixed left-1/2 top-1/2 z-50 flex h-[min(85dvh,48rem)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_120ms_ease-in] sm:w-[calc(100%-2rem)]">
        <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
          <div className="flex min-w-0 items-center justify-between gap-3"><Dialog.Title className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">File browser · {computer.name}</Dialog.Title><Dialog.Close asChild><Button variant="outline" size="sm" className="size-10 shrink-0 p-0" aria-label="Close file browser">×</Button></Dialog.Close></div>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">Files on this computer. Browse, preview text and download.</Dialog.Description>
        </header>
        <div className="shrink-0 space-y-2 border-b border-border px-3 py-2 sm:px-5">
          {editingPath ? <form className="flex min-w-0 gap-2" onSubmit={event => { event.preventDefault(); if (pathDraft) navigate(pathDraft); }}><input ref={pathInput} aria-label="Folder path" maxLength={4096} className={`${inputClass} flex-1`} value={pathDraft} onChange={event => setPathDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditingPath(false); } }} /><Button type="submit" size="sm" className="min-h-10" disabled={!pathDraft || !available || busy}>Go</Button></form>
            : <div className="flex min-w-0 items-center gap-2"><BorderedBreadcrumb label="Folder breadcrumbs" disabled={!available || busy} className="max-h-28 overflow-y-auto" items={crumbs.map((crumb, index) => ({ id: crumb.path, text: crumb.name, current: index === crumbs.length - 1, onSelect: () => navigate(crumb.path) }))} /><Button variant="outline" size="sm" className="min-h-10 shrink-0" disabled={!available || busy} onClick={() => { setPathDraft(path); setEditingPath(true); }}>Edit path</Button></div>}
          {!selected && <input aria-label="Filter this folder" placeholder="Filter this folder…" maxLength={200} value={filter} disabled={!available} onChange={event => setFilter(event.target.value)} className={`${inputClass} w-full`} />}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">
          <ScrollArea label="Computer files" className="min-h-0 min-w-0 flex-1" viewportClassName="[&>div]:!block [&>div]:w-full [&>div]:min-w-0">
            <div className="min-w-0 p-3 sm:p-4">
              {!available ? <p role="status" className="text-sm text-muted-foreground">{connected ? 'This computer is not running. Power it on from Computers to browse its files.' : 'Computer management is offline. Reconnect before browsing files.'}</p> : selected ? <div className="min-w-0 space-y-3 motion-safe:animate-[fade-in_120ms_ease-out]">
                <div className="flex min-w-0 justify-end">{downloadButton(selected)}</div>
                <h3 className="break-all text-sm font-medium">{selected.name}</h3>
                {preview.isPending && <p role="status" className="text-sm text-muted-foreground">Loading preview…</p>}
                {preview.isError && <p role="alert" className="text-sm text-red-400">{preview.error.message} <button type="button" className="cursor-pointer underline" onClick={() => void preview.refetch()}>Retry preview</button></p>}
                {preview.data && <><p className="text-xs text-muted-foreground">{fileSize(preview.data.size)} · Read-only{preview.data.truncated ? ' · Preview truncated to 64 KiB' : ''}</p>{preview.data.binary ? <p className="text-sm text-muted-foreground">No text preview for this file. Download it to open locally.</p> : <pre aria-label="File preview" className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-sidebar p-3 font-mono text-xs [overflow-wrap:anywhere]">{preview.data.text || '(Empty file)'}</pre>}</>}
              </div> : <>
                {listing.isPending && <p role="status" className="text-sm text-muted-foreground">Loading folder…</p>}
                {listing.isError && <p role="alert" className="text-sm text-red-400">{listing.error.message} <button type="button" className="cursor-pointer underline" onClick={() => void listing.refetch()}>Retry folder</button></p>}
                {listing.data && <>
                  {listing.data.truncated && <p role="status" className="mb-3 rounded-md border border-border p-2 text-xs text-muted-foreground">This folder exceeds the scan limit. Results are partial; open a more specific path.</p>}
                  {!listing.data.entries.length && <p className="py-8 text-center text-sm text-muted-foreground">{appliedFilter ? 'No matching files in this folder.' : 'This folder is empty.'}</p>}
                  <div className="hidden grid-cols-[minmax(0,1fr)_5rem_6rem_2.5rem] gap-3 border-b border-border px-2 pb-2 text-xs text-muted-foreground sm:grid"><span>Name</span><span>Size</span><span>Modified</span><span className="sr-only">Download</span></div>
                  <ul aria-label="Folder entries" className="min-w-0 divide-y divide-border">{listing.data.entries.map(file => <li key={file.path} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_2.5rem]">
                    <button type="button" disabled={file.type === 'other' || busy} className="flex min-h-10 min-w-0 cursor-pointer items-center gap-2 rounded text-left outline-none hover:text-primary focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50" title={file.name} onClick={() => { setDownloadError(''); if (file.type === 'directory') navigate(file.path); else setSelected(file); }}><FileIcon directory={file.type === 'directory'} /><span className="min-w-0"><span className="block truncate text-sm">{file.name}{file.type === 'directory' ? '/' : ''}{file.isSymlink ? ' ↗' : ''}</span><span className="block text-[11px] text-muted-foreground sm:hidden">{file.type === 'directory' ? 'Folder' : fileSize(file.size)} · {modified(file.modifiedAt)}</span></span></button>
                    <span className="hidden text-xs text-muted-foreground sm:block">{file.type === 'directory' ? '—' : fileSize(file.size)}</span><span className="hidden text-xs text-muted-foreground sm:block">{modified(file.modifiedAt)}</span>
                    {file.type === 'file' ? downloadButton(file, true) : <span aria-hidden="true" className="text-center text-muted-foreground">{file.type === 'directory' ? '›' : '—'}</span>}
                  </li>)}</ul>
                  {(location.offset > 0 || listing.data.nextOffset !== null) && <div className="mt-3 flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" className="min-h-10" disabled={location.offset === 0 || busy} onClick={() => setLocation(current => ({ ...current, offset: Math.max(0, current.offset - 200) }))}>Previous page</Button><Button variant="outline" size="sm" className="min-h-10" disabled={listing.data.nextOffset === null || busy} onClick={() => setLocation(current => ({ ...current, offset: listing.data!.nextOffset! }))}>Next page</Button></div>}
                </>}
              </>}
            </div>
          </ScrollArea>
        </div>
        <footer className="flex min-w-0 shrink-0 items-center gap-3 border-t border-border px-3 py-3 sm:px-5"><div className="min-w-0 flex-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{downloadError && <p role="alert" className="mb-1 text-red-400">{downloadError}</p>}<p role="status">{downloading ? `Preparing download: ${downloading}` : downloadNotice || `${listing.data?.entries.length ?? 0} items on this page`}</p><p className="mt-1 text-[10px]">Downloads ≤64 MiB · Files may change while in use.</p></div><Dialog.Close asChild><Button size="sm" variant="outline" className="min-h-10 shrink-0">Close</Button></Dialog.Close></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
