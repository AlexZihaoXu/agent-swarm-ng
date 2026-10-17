import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Switch } from '@/components/ui/switch';
import { useOrganizations } from '@/lib/organizations';
import type { ChatAgent, RealAgent } from '@/use-chat';
import type { RegisterSection } from '@/lib/settings-sections';
import { cn } from '@/lib/utils';

type Tool = RealAgent['ticketTools'][number];
const TOOLS: { name: Tool; access: 'r' | 'w'; description: string }[] = [
  { name: 'ticket_list', access: 'r', description: 'List the board’s tickets.' },
  { name: 'ticket_read', access: 'r', description: 'Read a ticket, its comments and activity.' },
  { name: 'ticket_create', access: 'w', description: 'File tickets (when the organization allows it).' },
  { name: 'ticket_update', access: 'w', description: 'Move its own tickets up to In review, reassign, link.' },
  { name: 'ticket_comment', access: 'w', description: 'Comment on tickets, @mention other agents.' },
];

/**
 * Agent settings → Tickets (docs/tickets.md): which ticket tools the agent has, none until granted, only for tickets
 * of its own organization. Saved with the page's Save changes; they apply from its next turn.
 */
export function AgentTicketSettings({
  agent,
  onSaved,
  register,
}: {
  agent: ChatAgent & { real: RealAgent };
  onSaved: (agent: RealAgent) => void;
  register: RegisterSection;
}) {
  const id = useId();
  const { organizations } = useOrganizations();
  const organization = organizations.find(org => org.id === agent.real.organizationId);
  const saved = agent.real.ticketTools ?? [];
  const [draft, setDraft] = useState<Tool[]>(saved);
  const [status, setStatus] = useState('');
  const dirty = draft.length !== saved.length || draft.some(name => !saved.includes(name));
  const latest = useRef({ save: async () => {}, discard: () => {} });
  latest.current = {
    save: async () => {
      const { data, error } = await api.PATCH('/api/agents/{id}', {
        params: { path: { id: agent.id } },
        body: { ticketTools: TOOLS.map(tool => tool.name).filter(name => draft.includes(name)) },
      });
      if (!data || error) throw new Error(error?.message ?? 'Could not save the ticket tools.');
      onSaved(data);
      setDraft(data.ticketTools);
      setStatus('Saved. They apply from the agent’s next turn.');
    },
    discard: () => {
      setDraft(saved);
      setStatus('');
    },
  };
  useEffect(() => {
    register('tickets', {
      label: 'Tickets',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('tickets');
  }, [dirty, register]);

  return (
    <section aria-label="Tickets" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Tickets</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Off for every agent until you grant them. {agent.name} works only on tickets of its own organization
          {organization ? ` (${organization.name})` : ''}
          {organization && !organization.tickets?.enabled ? ', which has tickets off for now (Settings → Tickets)' : ''}
          .
        </p>
      </div>
      <div className="rounded-lg border border-border bg-sidebar/30 ao-card">
        <ul className="divide-y divide-border">
          {TOOLS.map(tool => (
            <li key={tool.name} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${id}-${tool.name}`} className="cursor-pointer font-mono text-sm">
                  {tool.name}
                </label>
                <p className="text-xs text-muted-foreground">{tool.description}</p>
              </div>
              <span
                title={tool.access === 'r' ? 'Reads only' : 'Changes something'}
                className={cn(
                  'rounded-md border px-1.5 py-0.5 font-mono text-[11px]',
                  tool.access === 'r' ? 'border-sky-500/40 text-sky-300' : 'border-orange-500/40 text-orange-300',
                )}
              >
                {tool.access}
              </span>
              <Switch
                id={`${id}-${tool.name}`}
                checked={draft.includes(tool.name)}
                onCheckedChange={on => {
                  setDraft(current => (on ? [...current, tool.name] : current.filter(name => name !== tool.name)));
                  setStatus('');
                }}
              />
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        r tools also work in heartbeats and todo checks; w tools promote a heartbeat like any change.
      </p>
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </section>
  );
}
