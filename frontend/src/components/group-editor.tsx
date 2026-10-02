import { MoveToOrganization, OrganizationField, useCreateOrganization } from '@/components/organization-fields';
import { useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/chat-identity';
import { defaultAvatar } from '@/lib/agent-avatar';
import type { GroupChat } from '@/use-groups';
import { dialogOverlay, dialogMotion } from '@/lib/styles';
import { PickerDialog, PickerGroup, PickerItem } from '@/components/picker-dialog';

// Kibo dialog-standard-1; members as a short chosen list plus an Add agents search (scroll-area-layout-1, command-dialog-3).
export function GroupEditor({
  group,
  children,
  onSaved,
  onDelete,
  open: controlledOpen,
  onOpenChange,
}: {
  group?: GroupChat;
  children?: ReactNode;
  onSaved?: (group: GroupChat) => void;
  onDelete?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (value: boolean) => (controlledOpen === undefined ? setOwnOpen(value) : onOpenChange?.(value));
  const [name, setName] = useState(group?.name ?? '');
  const [selected, setSelected] = useState(new Set(group?.members.map(member => member.id) ?? []));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  // Its organization: a group's members are all in it (docs/organizations.md).
  const creating = useCreateOrganization();
  const organizationId = group?.organizationId ?? creating.value;
  const options = useInfiniteQuery({
    queryKey: ['group-member-options', search, organizationId],
    enabled: open && Boolean(organizationId),
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.GET('/api/agents', {
        params: { query: { after: pageParam, search: search || undefined, limit: 50, organizationId } },
        signal,
      });
      if (error || !data) throw new Error('Could not load agents.');
      return data;
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const agents = [
    ...new Map(
      [...(group?.members ?? []), ...(options.data?.pages.flatMap(page => page.agents) ?? [])].map(agent => [
        agent.id,
        agent,
      ]),
    ).values(),
  ].filter(agent => agent.name.toLowerCase().includes(search.toLowerCase()));
  // Chosen agents stay listed whatever the search shows.
  const known = useRef(new Map<string, (typeof agents)[number]>());
  for (const agent of [...(group?.members ?? []), ...(options.data?.pages.flatMap(page => page.agents) ?? [])])
    known.current.set(agent.id, agent);
  const chosen = [...selected].flatMap(id => known.current.get(id) ?? []);
  const toggle = (id: string) =>
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 16) next.add(id);
      return next;
    });
  const [picking, setPicking] = useState(false);
  const save = async () => {
    if (saving || !name.trim() || !selected.size || !organizationId) return;
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), agentIds: [...selected] };
      const result = group
        ? await api.PATCH('/api/groups/{id}', { params: { path: { id: group.id } }, body })
        : await api.POST('/api/groups', { body: { ...body, organizationId } });
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'Could not save the group.');
      void client.invalidateQueries({ queryKey: ['groups'] });
      client.setQueryData(['group', result.data.id], result.data);
      onSaved?.(result.data);
      if (controlledOpen === undefined || !onSaved) setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the group.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={value => {
        if (saving) return;
        if (value) {
          setName(group?.name ?? '');
          setSelected(new Set(group?.members.map(member => member.id) ?? []));
          setError('');
          setSearch('');
        }
        setOpen(value);
      }}
    >
      {children && <Dialog.Trigger asChild>{children}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl ${dialogMotion}`}
        >
          <Dialog.Title className="text-lg font-semibold">
            {group ? 'Edit group chat' : 'Create group chat'}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            You and the selected agents share this conversation. Members can read its history. DM permissions stay
            unchanged.
          </Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={event => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="grid gap-2 text-sm font-medium">
              Group name
              <input
                autoFocus
                value={name}
                onChange={event => setName(event.target.value)}
                maxLength={80}
                required
                disabled={saving}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
              />
            </label>
            {!group && (
              <OrganizationField
                value={creating.value}
                onChange={id => {
                  // Members belong to the group's organization: a new choice starts the list again.
                  creating.setValue(id);
                  setSelected(new Set());
                }}
                disabled={saving}
              />
            )}
            {/* Chosen agents in a short list (Kibo scroll-area-layout-1); the rest behind Add agents. */}
            <div role="group" aria-labelledby="group-agents-title" className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p id="group-agents-title" className="text-sm font-medium">
                  Agents <span className="text-muted-foreground">({selected.size}/16)</span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-8"
                  disabled={saving}
                  onClick={() => setPicking(true)}
                >
                  Add agents
                </Button>
              </div>
              {chosen.length ? (
                <ul
                  aria-label="Chosen agents"
                  className="max-h-56 overflow-y-auto overscroll-contain rounded-md border border-border bg-background p-1"
                >
                  {chosen.map(agent => (
                    <li
                      key={agent.id}
                      className="flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50 sm:min-h-9"
                    >
                      <AgentAvatar initials={agent.name.slice(0, 2)} avatar={agent.avatar ?? defaultAvatar(agent.id)} />
                      <span className="min-w-0 flex-1 truncate text-sm">{agent.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${agent.name}`}
                        title="Remove"
                        disabled={saving}
                        onClick={() => toggle(agent.id)}
                        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:size-8"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  No agents yet. Add up to 16.
                </p>
              )}
            </div>
            <PickerDialog
              open={picking}
              onOpenChange={setPicking}
              title="Add agents"
              placeholder="Search agents…"
              empty={options.isPending ? 'Loading agents…' : 'No agents found. Create agents in the Agents tab.'}
              status={`${selected.size} of 16 chosen`}
              search={{ value: search, onChange: setSearch }}
            >
              <PickerGroup>
                {agents.map(agent => (
                  <PickerItem
                    key={agent.id}
                    value={agent.id}
                    checked={selected.has(agent.id)}
                    disabled={!selected.has(agent.id) && selected.size >= 16}
                    onSelect={() => toggle(agent.id)}
                  >
                    <AgentAvatar initials={agent.name.slice(0, 2)} avatar={agent.avatar ?? defaultAvatar(agent.id)} />
                    <span className="min-w-0 truncate">{agent.name}</span>
                  </PickerItem>
                ))}
                {(options.isError || options.hasNextPage) && (
                  <PickerItem
                    value="load-more"
                    disabled={options.isFetching}
                    onSelect={() => void (options.isError ? options.refetch() : options.fetchNextPage())}
                  >
                    {options.isFetching ? 'Loading…' : options.isError ? 'Retry loading agents' : 'More agents…'}
                  </PickerItem>
                )}
              </PickerGroup>
            </PickerDialog>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            {group && (
              <MoveToOrganization
                kind="group"
                id={group.id}
                name={group.name}
                organizationId={group.organizationId}
                onMoved={() => {
                  void client.invalidateQueries({ queryKey: ['groups'] });
                  void client.invalidateQueries({ queryKey: ['group', group.id] });
                  setOpen(false);
                }}
              />
            )}
            {group && onDelete && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full border-red-500/50 text-red-400 hover:bg-red-500/10"
                disabled={saving}
                onClick={() => {
                  if (controlledOpen === undefined) setOpen(false);
                  onDelete();
                }}
              >
                Delete group chat
              </Button>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" disabled={saving}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                className="min-h-11 sm:min-h-0"
                disabled={saving || !name.trim() || !selected.size || !organizationId}
              >
                {saving ? 'Saving…' : group ? 'Save changes' : 'Create group'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
