export type DashboardTab = 'agents' | 'chat' | 'computers' | 'settings';
export type DashboardRoute = {
  tab: DashboardTab;
  kind:
    | 'root'
    | 'not-found'
    | 'agents-list'
    | 'agent'
    | 'agent-dm'
    | 'agent-new'
    | 'agent-delete'
    | 'agent-edit'
    | 'chat-list'
    | 'chat-agent'
    | 'chat-agent-dm'
    | 'chat-agent-discord'
    | 'chat-group'
    | 'group-new'
    | 'group-edit'
    | 'group-delete'
    | 'computers-list'
    | 'computer'
    | 'computer-new'
    | 'computer-delete'
    | 'computer-settings'
    | 'settings'
    | 'knowledge'
    | 'audit'
    | 'endpoint-new'
    | 'endpoint';
  agentId?: string;
  peerId?: string;
  /** A Discord channel the agent's bot saw (read-only view). */
  discordChannelId?: string;
  groupId?: string;
  computerId?: string;
  /** The viewer's mode; the URL carries it so a refresh returns to the same view. */
  computerView?: 'desktop' | 'terminal';
  terminalId?: string;
  endpointId?: string;
  knowledgeId?: string;
  editorTab?: 'avatar' | 'settings';
  channelScreen?: 'channels' | 'swarm' | 'dm';
};

const segment = (value: string) => encodeURIComponent(value);
export const agentPath = (id: string) => `/agents/${segment(id)}`;
export const agentDmPath = (id: string, peerId: string) => `${agentPath(id)}/dm/${segment(peerId)}`;
export const chatAgentPath = (id: string) => `/chat/agents/${segment(id)}`;
export const chatAgentDmPath = (id: string, peerId: string) => `${chatAgentPath(id)}/dm/${segment(peerId)}`;
export const chatAgentDiscordPath = (id: string, channelId: string) =>
  `${chatAgentPath(id)}/discord/${segment(channelId)}`;
export const chatGroupPath = (id: string) => `/chat/groups/${segment(id)}`;
export const computerPath = (id: string) => `/computers/${segment(id)}`;
/** `/computers/:id/terminal[/:session]`. (`/computers/:id/desktop/` is the stream itself, not a dashboard view.) */
export const computerTerminalPath = (id: string, session?: string | null) =>
  `${computerPath(id)}/terminal${session ? `/${segment(session)}` : ''}`;
export const endpointPath = (id: string) => `/settings/endpoints/${segment(id)}`;
export const knowledgePath = (id?: string) =>
  id ? `/settings/knowledge/${id.split('/').map(segment).join('/')}` : '/settings/knowledge';

export function parseDashboardPath(pathname: string): DashboardRoute {
  const missing: DashboardRoute = { tab: 'agents', kind: 'not-found' };
  if (pathname === '/') return { tab: 'agents', kind: 'root' };
  if (!pathname.startsWith('/')) return missing;
  let parts: string[];
  try {
    parts = pathname.replace(/\/$/, '').slice(1).split('/').map(decodeURIComponent);
  } catch {
    return missing;
  }
  if (
    parts.some(
      value => !value || value.length > 100 || /[/\\\u0000-\u001f]/.test(value) || value === '.' || value === '..',
    )
  )
    return missing;
  const [section, id, third, fourth, fifth, sixth, seventh] = parts;
  if (section === 'agents') {
    if (parts.length === 1) return { tab: 'agents', kind: 'agents-list' };
    if (id === 'new' && parts.length === 2) return { tab: 'agents', kind: 'agent-new' };
    if (parts.length === 2) return { tab: 'agents', kind: 'agent', agentId: id };
    if (parts.length === 4 && third === 'dm') return { tab: 'agents', kind: 'agent-dm', agentId: id, peerId: fourth };
    if (parts.length === 3 && third === 'delete') return { tab: 'agents', kind: 'agent-delete', agentId: id };
    if (third === 'edit') {
      if (parts.length === 4 && fourth === 'avatar')
        return { tab: 'agents', kind: 'agent-edit', agentId: id, editorTab: 'avatar' };
      if (fourth === 'settings' && fifth === 'channels') {
        if (parts.length === 5)
          return { tab: 'agents', kind: 'agent-edit', agentId: id, editorTab: 'settings', channelScreen: 'channels' };
        if (sixth === 'swarm') {
          if (parts.length === 6)
            return { tab: 'agents', kind: 'agent-edit', agentId: id, editorTab: 'settings', channelScreen: 'swarm' };
          if (parts.length === 8 && seventh === 'dm')
            return {
              tab: 'agents',
              kind: 'agent-edit',
              agentId: id,
              editorTab: 'settings',
              channelScreen: 'dm',
              peerId: parts[7],
            };
        }
      }
    }
  }
  if (section === 'chat') {
    if (parts.length === 1) return { tab: 'chat', kind: 'chat-list' };
    if (parts.length === 3 && third && id === 'agents') return { tab: 'chat', kind: 'chat-agent', agentId: third };
    if (parts.length === 5 && id === 'agents' && fourth === 'dm')
      return { tab: 'chat', kind: 'chat-agent-dm', agentId: third, peerId: fifth };
    if (parts.length === 5 && id === 'agents' && fourth === 'discord' && /^\d{15,21}$/.test(fifth))
      return { tab: 'chat', kind: 'chat-agent-discord', agentId: third, discordChannelId: fifth };
    if (id === 'groups') {
      if (parts.length === 3 && third === 'new') return { tab: 'chat', kind: 'group-new' };
      if (parts.length === 3 && third) return { tab: 'chat', kind: 'chat-group', groupId: third };
      if (parts.length === 4 && fourth === 'edit') return { tab: 'chat', kind: 'group-edit', groupId: third };
      if (parts.length === 4 && fourth === 'delete') return { tab: 'chat', kind: 'group-delete', groupId: third };
    }
  }
  if (section === 'computers') {
    if (parts.length === 1) return { tab: 'computers', kind: 'computers-list' };
    if (parts.length === 2 && id === 'new') return { tab: 'computers', kind: 'computer-new' };
    if (parts.length === 2) return { tab: 'computers', kind: 'computer', computerId: id };
    if (parts.length === 3 && third === 'delete') return { tab: 'computers', kind: 'computer-delete', computerId: id };
    if (third === 'terminal' && parts.length <= 4)
      return { tab: 'computers', kind: 'computer', computerId: id, computerView: 'terminal', terminalId: fourth };
    if (parts.length === 3 && third === 'settings')
      return { tab: 'computers', kind: 'computer-settings', computerId: id };
  }
  if (section === 'settings') {
    if (parts.length === 1) return { tab: 'settings', kind: 'settings' };
    if (id === 'knowledge' && parts.length >= 2)
      return {
        tab: 'settings',
        kind: 'knowledge',
        knowledgeId: parts.length > 2 ? parts.slice(2).join('/') : undefined,
      };
    if (parts.length === 2 && id === 'audit') return { tab: 'settings', kind: 'audit' };
    if (parts.length === 3 && id === 'endpoints' && third === 'new') return { tab: 'settings', kind: 'endpoint-new' };
    if (parts.length === 3 && id === 'endpoints') return { tab: 'settings', kind: 'endpoint', endpointId: third };
  }
  return missing;
}
