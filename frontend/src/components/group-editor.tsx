import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/chat-identity';
import { defaultAvatar } from '@/lib/agent-avatar';
import type { GroupChat } from '@/use-groups';

// Kibo dialog-standard-1 and checkbox-standard-8: retain the dialog and labelled list composition.
export function GroupEditor({ group, children, onSaved, open: controlledOpen, onOpenChange }: { group?: GroupChat; children?: ReactNode; onSaved?: (group: GroupChat) => void; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (value: boolean) => controlledOpen === undefined ? setOwnOpen(value) : onOpenChange?.(value);
  const [name, setName] = useState(group?.name ?? '');
  const [selected, setSelected] = useState(new Set(group?.members.map(member => member.id) ?? []));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  const options = useInfiniteQuery({ queryKey: ['group-member-options', search], enabled: open, initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.GET('/api/agents', { params: { query: { after: pageParam, search: search || undefined, limit: 50 } }, signal });
      if (error || !data) throw new Error('Could not load agents.');
      return data;
    }, getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const agents = [...new Map([...(group?.members ?? []), ...(options.data?.pages.flatMap(page => page.agents) ?? [])].map(agent => [agent.id, agent])).values()].filter(agent => agent.name.toLowerCase().includes(search.toLowerCase()));
  const save = async () => {
    if (saving || !name.trim() || !selected.size) return;
    setSaving(true); setError('');
    try {
      const body = { name: name.trim(), agentIds: [...selected] };
      const result = group ? await api.PATCH('/api/groups/{id}', { params: { path: { id: group.id } }, body }) : await api.POST('/api/groups', { body });
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'Could not save the group.');
      void client.invalidateQueries({ queryKey: ['groups'] });
      client.setQueryData(['group', result.data.id], result.data);
      onSaved?.(result.data); setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the group.'); }
    finally { setSaving(false); }
  };
  return <Dialog.Root open={open} onOpenChange={value => {
    if (saving) return;
    if (value) { setName(group?.name ?? ''); setSelected(new Set(group?.members.map(member => member.id) ?? [])); setError(''); setSearch(''); }
    setOpen(value);
  }}>
    {children && <Dialog.Trigger asChild>{children}</Dialog.Trigger>}
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl">
        <Dialog.Title className="text-lg font-semibold">{group ? 'Edit group chat' : 'Create group chat'}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-muted-foreground">You and the selected agents share this conversation. Members can read its history. DM permissions stay unchanged.</Dialog.Description>
        <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label className="grid gap-2 text-sm font-medium">Group name<input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={saving} className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
          <fieldset disabled={saving} className="space-y-3">
            <legend className="mb-2 text-sm font-medium">Agents <span className="text-muted-foreground">({selected.size}/16)</span></legend>
            <input aria-label="Search group members" type="search" value={search} maxLength={80} onChange={event => setSearch(event.target.value)} placeholder="Search agents" className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <div className="max-h-56 space-y-3 overflow-y-auto py-1">
              {agents.map(agent => <label key={agent.id} className="flex cursor-pointer items-center gap-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                <input type="checkbox" checked={selected.has(agent.id)} disabled={!selected.has(agent.id) && selected.size >= 16} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(agent.id); else next.delete(agent.id); return next; })} className="size-4 accent-primary" />
                <AgentAvatar initials={agent.name.slice(0, 2)} avatar={agent.avatar ?? defaultAvatar(agent.id)} />
                <span className="truncate">{agent.name}</span>
              </label>)}
              {!agents.length && !options.isPending && <p className="text-sm text-muted-foreground">No agents found. Create agents in the Agents tab.</p>}
              {(options.isPending || options.isError || options.hasNextPage) && <Button type="button" variant="outline" size="sm" disabled={options.isFetching} onClick={() => void (options.isError ? options.refetch() : options.fetchNextPage())}>{options.isFetching ? 'Loading…' : options.isError ? 'Retry loading agents' : 'More agents'}</Button>}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></Dialog.Close>
            <Button type="submit" disabled={saving || !name.trim() || !selected.size}>{saving ? 'Saving…' : group ? 'Save changes' : 'Create group'}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
