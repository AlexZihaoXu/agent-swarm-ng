import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import { initialsOf } from '@/lib/organizations';
import type { AssigneeChoice, TicketSummary } from '@/lib/tickets';
import type { ChatAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

/** Who a ticket can be assigned to: the organization's owner, one of its agents, or nobody. */
export type AssigneeOption = { key: string; name: string; choice: AssigneeChoice; agent?: ChatAgent };
export function assigneeOptions(ownerName: string, agents: ChatAgent[]): AssigneeOption[] {
  return [
    ...agents.map(agent => ({ key: agent.id, name: agent.name, choice: { agentId: agent.id }, agent })),
    { key: 'owner', name: ownerName, choice: { owner: true as const } },
    { key: 'none', name: 'Unassigned', choice: null },
  ];
}
export const assigneeKey = (assignee: TicketSummary['assignee']) =>
  !assignee ? 'none' : assignee.kind === 'owner' ? 'owner' : assignee.id;

/** A ticket's assignee as a small avatar: an agent's own art, a person's initials, or a dash for nobody. */
export function AssigneeAvatar({
  assignee,
  agents,
  size = 20,
  className,
}: {
  assignee: TicketSummary['assignee'] | { kind: 'owner' | 'agent' | 'none'; id: string; name: string };
  agents: ChatAgent[];
  size?: number;
  className?: string;
}) {
  const agent = assignee?.kind === 'agent' ? agents.find(item => item.id === assignee.id) : undefined;
  if (assignee?.kind === 'agent')
    return (
      <span aria-hidden="true" className={cn('inline-flex shrink-0', className)} title={assignee.name}>
        <AgentAvatarArt {...(agent?.avatar ?? defaultAvatar(assignee.id))} size={size} state="idle" />
      </span>
    );
  return (
    <span
      aria-hidden="true"
      title={assignee && assignee.kind === 'owner' ? assignee.name : 'Unassigned'}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
        assignee && assignee.kind === 'owner' ? 'bg-sky-500/20 text-sky-200' : 'bg-foreground/10 text-muted-foreground',
        className,
      )}
    >
      {assignee && assignee.kind === 'owner' ? initialsOf(assignee.name) : '–'}
    </span>
  );
}
