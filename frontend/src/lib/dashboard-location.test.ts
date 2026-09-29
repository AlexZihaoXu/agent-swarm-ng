import { describe, expect, it } from 'vitest';
import {
  agentDmPath,
  agentPath,
  chatAgentDmPath,
  chatAgentPath,
  chatGroupPath,
  computerPath,
  computerTerminalPath,
  endpointPath,
  parseDashboardPath,
} from './dashboard-location';

describe('dashboard paths', () => {
  it('resolves stable tabs and nested conversations', () => {
    expect(parseDashboardPath('/')).toMatchObject({ kind: 'root', tab: 'agents' });
    expect(parseDashboardPath('/agents')).toMatchObject({ kind: 'agents-list' });
    expect(parseDashboardPath(agentPath('avery'))).toMatchObject({ kind: 'agent', agentId: 'avery' });
    expect(parseDashboardPath(agentDmPath('avery', 'morgan'))).toMatchObject({
      kind: 'agent-dm',
      agentId: 'avery',
      peerId: 'morgan',
    });
    expect(parseDashboardPath(chatAgentPath('morgan'))).toMatchObject({ kind: 'chat-agent', agentId: 'morgan' });
    expect(parseDashboardPath(chatAgentDmPath('avery', 'morgan'))).toMatchObject({
      kind: 'chat-agent-dm',
      tab: 'chat',
      agentId: 'avery',
      peerId: 'morgan',
    });
    expect(parseDashboardPath(chatGroupPath('team'))).toMatchObject({ kind: 'chat-group', groupId: 'team' });
    expect(parseDashboardPath(computerPath('c-1'))).toMatchObject({ kind: 'computer', computerId: 'c-1' });
    expect(parseDashboardPath('/settings')).toMatchObject({ kind: 'settings' });
  });
  it('distinguishes named editor destinations from resource IDs', () => {
    expect(parseDashboardPath('/agents/new').kind).toBe('agent-new');
    expect(parseDashboardPath('/agents/avery/edit/avatar')).toMatchObject({ kind: 'agent-edit', editorTab: 'avatar' });
    expect(parseDashboardPath('/agents/avery/edit/settings/channels/swarm/dm/morgan')).toMatchObject({
      kind: 'agent-edit',
      channelScreen: 'dm',
      peerId: 'morgan',
    });
    expect(parseDashboardPath('/chat/groups/new').kind).toBe('group-new');
    expect(parseDashboardPath('/chat/groups/team/edit').kind).toBe('group-edit');
    expect(parseDashboardPath(computerTerminalPath('c-1'))).toMatchObject({
      kind: 'computer',
      computerId: 'c-1',
      computerView: 'terminal',
    });
    expect(parseDashboardPath(computerTerminalPath('c-1', 's-9'))).toMatchObject({
      kind: 'computer',
      computerView: 'terminal',
      terminalId: 's-9',
    });
    expect(parseDashboardPath('/computers/c-1/terminal/s-9/extra').kind).toBe('not-found');
    expect(parseDashboardPath('/computers/new').kind).toBe('computer-new');
    expect(parseDashboardPath('/computers/c-1/delete').kind).toBe('computer-delete');
    expect(parseDashboardPath('/computers/c-1/settings')).toMatchObject({
      kind: 'computer-settings',
      computerId: 'c-1',
    });
    expect(parseDashboardPath('/settings/endpoints/new').kind).toBe('endpoint-new');
    expect(parseDashboardPath(endpointPath('ep1'))).toMatchObject({ kind: 'endpoint', endpointId: 'ep1' });
  });
  it('does not treat API/media paths or malformed IDs as dashboard views', () => {
    for (const value of [
      '/api/agents',
      '/computers/c-1/desktop/',
      '/agents/a%2Fb',
      '/agents/avery/other',
      '/chat/agents/avery/dm',
      '/chat/agents/avery/dm/morgan/extra',
      '/chat/groups/team/other',
      '/settings/secret',
    ]) {
      expect(parseDashboardPath(value).kind).toBe('not-found');
    }
  });
});
