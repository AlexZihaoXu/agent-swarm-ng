import { useId, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { randomUuid } from '@/lib/random-uuid';
import { ComputerCard } from './computer-card';

type Computer = paths['/api/computers']['get']['responses'][200]['content']['application/json']['computers'][number];
type ComputerList = { computers: Computer[] };

function ComputerDialog({ children }: { children: ReactNode }) {
  return <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
    <Dialog.Content className="computer-dialog fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl">
      {children}
    </Dialog.Content>
  </Dialog.Portal>;
}

export function ComputersPanel() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['computers'], queryFn: async ({ signal }) => {
    const { data, error } = await api.GET('/api/computers', { signal });
    if (!data || error) throw new Error(error?.message ?? 'Could not load computers.');
    return data;
  }, refetchInterval: 5000, refetchIntervalInBackground: false });
  const computers = query.data?.computers ?? [];
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [requestKey, setRequestKey] = useState(randomUuid);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [selected, setSelected] = useState<Computer | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const createId = useId();
  const confirmId = useId();

  const refresh = () => void client.invalidateQueries({ queryKey: ['computers'] });
  const submitCreate = async () => {
    if (createBusy || !name.trim()) return;
    setCreateBusy(true); setCreateError('');
    try {
      const result = await api.POST('/api/computers', { body: { name: name.trim(), requestKey } });
      if (!result.data || result.error) throw new Error(result.error?.message ?? 'Could not create the computer.');
      client.setQueryData<ComputerList>(['computers'], previous => ({ computers: [...(previous?.computers ?? []).filter(item => item.id !== result.data!.id), result.data!] }));
      setCreateOpen(false); refresh();
    } catch (error) { setCreateError(error instanceof Error ? error.message : 'Could not create the computer.'); }
    finally { setCreateBusy(false); }
  };
  const submitDelete = async () => {
    if (!selected || deleteBusy || confirmation !== selected.name) return;
    setDeleteBusy(true); setDeleteError('');
    try {
      const result = await api.DELETE('/api/computers/{id}', { params: { path: { id: selected.id } }, body: { confirmation } });
      if (!result.data || result.error) throw new Error(result.error?.message ?? 'Could not delete the computer.');
      client.setQueryData<ComputerList>(['computers'], previous => ({ computers: (previous?.computers ?? []).filter(item => item.id !== selected.id) }));
      setSelected(null); refresh();
    } catch (error) { setDeleteError(error instanceof Error ? error.message : 'Could not delete the computer.'); }
    finally { setDeleteBusy(false); }
  };

  return <section aria-label="Computers" className="computer-tab-enter flex min-h-0 w-full flex-col">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-6 md:py-4">
      <div><h2 className="text-lg font-semibold">Computers</h2><p className="text-xs text-muted-foreground">Containerized Ubuntu desktops</p></div>
      <Dialog.Root open={createOpen} onOpenChange={open => { if (createBusy) return; setCreateOpen(open); if (open) { setName(''); setRequestKey(randomUuid()); setCreateError(''); } }}>
        <Dialog.Trigger asChild><Button type="button" size="sm" disabled={!query.data?.controllerConnected} className="min-h-11 md:min-h-0">Create computer</Button></Dialog.Trigger>
        <ComputerDialog>
          <form onSubmit={event => { event.preventDefault(); void submitCreate(); }}>
            <Dialog.Title className="text-lg font-semibold">Create computer</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">Create a separate Ubuntu desktop with a persistent home and workspace.</Dialog.Description>
            <label htmlFor={createId} className="mt-5 block text-sm font-medium">Computer name</label>
            <input id={createId} autoFocus maxLength={80} value={name} disabled={createBusy} onChange={event => setName(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-10 sm:text-sm" />
            {createError && <p role="alert" className="mt-4 text-sm text-red-400">{createError}</p>}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild><Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={createBusy}>Cancel</Button></Dialog.Close>
              <Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={createBusy || !name.trim()}>{createBusy ? 'Creating…' : 'Create computer'}</Button>
            </div>
          </form>
        </ComputerDialog>
      </Dialog.Root>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6">
      {query.isPending && <p role="status" className="text-sm text-muted-foreground">Loading computers…</p>}
      {query.isError && <div role="alert" className="space-y-3 text-sm"><p>{query.error.message}</p><Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Retry loading computers</Button></div>}
      {query.isSuccess && !query.data.controllerConnected && <p role="status" className="mb-4 rounded-lg border border-border bg-sidebar p-3 text-sm text-muted-foreground">Computer management is offline. Saved computers remain visible; creation, deletion and previews are unavailable.</p>}
      {query.isSuccess && query.data.controllerConnected && computers.length === 0 && <p role="status" className="py-10 text-center text-sm text-muted-foreground">No computers yet. Create one to get started.</p>}
      {computers.length > 0 && <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4 md:gap-5">
        {computers.map(computer => <ComputerCard key={computer.id} computer={computer} canManage={Boolean(query.data?.controllerConnected)} onDelete={target => { setConfirmation(''); setDeleteError(''); setSelected(target); }} />)}
      </div>}
    </div>
    <Dialog.Root open={selected !== null} onOpenChange={open => { if (!open && !deleteBusy) setSelected(null); }}>
      {selected && <ComputerDialog>
        <form onSubmit={event => { event.preventDefault(); void submitDelete(); }}>
          <Dialog.Title className="text-lg font-semibold">Delete computer</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">This permanently deletes the computer, its container, and all files in its persistent home and workspace. This cannot be undone.</Dialog.Description>
          <p id={`${confirmId}-help`} className="mt-5 break-words text-sm">Type <strong className="select-text">{selected.name}</strong> exactly to confirm.</p>
          <label htmlFor={confirmId} className="mt-4 block text-sm font-medium">Confirm computer name</label>
          <input id={confirmId} aria-describedby={`${confirmId}-help`} autoComplete="off" spellCheck={false} value={confirmation} disabled={deleteBusy} onChange={event => setConfirmation(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-10 sm:text-sm" />
          {deleteError && <p role="alert" className="mt-4 text-sm text-red-400">{deleteError}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={deleteBusy}>Cancel</Button></Dialog.Close>
            <Button type="submit" variant="outline" size="sm" className="min-h-11 border-red-500/50 text-red-400 hover:bg-red-500/10 sm:min-h-0" disabled={deleteBusy || confirmation !== selected.name}>{deleteBusy ? 'Deleting…' : 'Delete computer'}</Button>
          </div>
        </form>
      </ComputerDialog>}
    </Dialog.Root>
  </section>;
}
