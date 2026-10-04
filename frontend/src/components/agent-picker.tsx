import { useState, type ReactNode } from 'react';
import { Select, OptionLabel } from '@/components/ui/select';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import { useOrganizations } from '@/lib/organizations';
import { useAgentSearch } from '@/use-agent-search';
import type { ChatAgent } from '@/use-chat';

/**
 * Which agent the Agents page configures (docs/chat-and-groups.md): the searchable select the model picker
 * uses, each option with the agent's avatar, name and organization. While every organization is shown, agents are
 * grouped by organization, each group with its label. Search runs on the server, like the Chat sidebar's.
 */
export function AgentPicker({
  agents,
  selected,
  onSelect,
  more,
  status,
}: {
  /** The loaded agents of the current organization scope. */
  agents: ChatAgent[];
  selected: ChatAgent | undefined;
  onSelect: (id: string) => void;
  /** Loads the next page of agents, while there is one. */
  more?: { label: string; busy: boolean; load: () => void };
  /** The chosen agent's avatar with its live state (working, typing, sleeping), for the trigger. */
  status?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const { inScope, organizations, current, nameOf } = useOrganizations();
  const { agents: found, query, term } = useAgentSearch(search, agents);
  const order = (agent: ChatAgent) => {
    const index = organizations.findIndex(org => org.id === agent.real?.organizationId);
    return index < 0 ? organizations.length : index;
  };
  // Two people may name an organization alike: then its heading names the owner too.
  const heading = (agent: ChatAgent) => {
    const org = organizations.find(item => item.id === agent.real?.organizationId);
    const twin = org && organizations.some(other => other.id !== org.id && other.name === org.name);
    return twin && org.ownerName ? `${org.name} · ${org.ownerName}` : nameOf(agent.real?.organizationId);
  };
  const grouped = current === 'all' && organizations.length > 1;
  const option = (agent: ChatAgent) => ({
    value: agent.id,
    label: agent.name,
    // Unknown while the organizations load (or after one is deleted): then left out.
    description: nameOf(agent.real?.organizationId) || undefined,
    icon: <AgentAvatarArt {...(agent.avatar ?? defaultAvatar(agent.id))} size={32} />,
  });
  const shown = found.filter(agent => inScope(agent.real?.organizationId));
  // A stable sort: within an organization, the list's own order. Grouped, the heading names the organization.
  const options = (grouped ? shown.sort((a, b) => order(a) - order(b)) : shown).map(agent =>
    grouped
      ? {
          ...option(agent),
          description: undefined,
          group: agent.real?.organizationId ?? '?',
          groupLabel: heading(agent),
        }
      : option(agent),
  );
  const footer = term
    ? (query.isFetching || query.isError || query.hasNextPage) && {
        label: query.isFetching ? 'Searching…' : query.isError ? 'Retry search' : 'Load more matches',
        busy: query.isFetching,
        load: () => void (query.isError ? query.refetch() : query.fetchNextPage()),
      }
    : more;
  return (
    <Select
      id="agent-picker"
      ariaLabel="Agent"
      value={selected?.id ?? ''}
      onValueChange={onSelect}
      options={options}
      searchable
      searchPlaceholder="Search agents…"
      searchLabel="Search agents"
      // The server is still answering: not "No matches" yet.
      empty={term && query.isFetching ? null : term && query.isError ? 'Search failed' : 'No matches'}
      search={search}
      onSearchChange={setSearch}
      // With a page still to load, the list (its Load more) and search stay reachable.
      disabled={!agents.length && !more}
      triggerClassName="h-auto min-h-12 py-1.5 sm:h-auto sm:min-h-12"
      // As wide as the panel's row (the picker and its + button).
      contentClassName="max-h-[min(26rem,var(--radix-popover-content-available-height))] w-[calc(var(--radix-popover-trigger-width)+3.5rem)]"
      triggerContent={
        <>
          {selected ? (
            <OptionLabel option={{ ...option(selected), ...(status && { icon: status }) }} truncate />
          ) : (
            <span className="truncate text-muted-foreground">
              {more?.busy && !agents.length ? 'Loading agents…' : 'Choose an agent'}
            </span>
          )}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-4 shrink-0 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="m7 9 5-5 5 5M7 15l5 5 5-5" />
          </svg>
        </>
      }
      footer={
        footer ? (
          <div className="border-t border-border p-1">
            <button
              type="button"
              disabled={footer.busy}
              onClick={footer.load}
              className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 sm:min-h-8"
            >
              {footer.label}
            </button>
          </div>
        ) : undefined
      }
    />
  );
}
