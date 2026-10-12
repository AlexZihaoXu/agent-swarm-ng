import type { PlatformStore } from './platform-store';
import type { Connections } from './users/connections';
import type { DiscordTokenStore } from './discord/token-store';
import { choicesOf } from './model-chain';
import { codexAccountOf } from './codex-provider';
import { unresolvedOf, type Unresolved } from './agent-import';

/**
 * What needs the owner's attention in an agent's settings (docs/agent-export.md), shown in red there: a model row
 * whose connection does not exist here (or is signed out), links an imported file had that do not exist here, and
 * Discord channels without a bot token. An imported agent is resumed only once there are none.
 */
export type AgentProblem =
  | { section: 'model'; row: number; message: string }
  | { section: 'links'; kind: keyof Unresolved; id: string; name: string; message: string }
  | { section: 'discord'; message: string };

export async function agentProblems(
  database: PlatformStore,
  connections: Connections,
  tokens: DiscordTokenStore,
  agentId: string,
): Promise<{ paused: boolean; problems: AgentProblem[] }> {
  const agent = await database.client.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { paused: false, problems: [] };
  const owner = await connections.ownerOfAgent(agentId);
  const endpoints = await connections.endpoints.readFor(owner).catch(() => []);
  const problems: AgentProblem[] = [];
  for (const [row, choice] of choicesOf(agent).entries()) {
    if (!choice.endpointId) {
      problems.push({ section: 'model', row, message: 'No provider chosen. Choose one of your connections.' });
      continue;
    }
    const account = codexAccountOf(choice.endpointId);
    if (account !== undefined) {
      const codex = await connections.codexFor(owner, choice.endpointId);
      const connected = codex
        ? await codex.status().then(
            status => status.connected,
            () => false,
          )
        : false;
      if (!codex)
        problems.push({
          section: 'model',
          row,
          message: 'This ChatGPT account does not exist here. Switch to one of your connections.',
        });
      else if (!connected)
        problems.push({
          section: 'model',
          row,
          message: 'This ChatGPT account is signed out. Sign it in under Settings, or switch.',
        });
    } else if (!endpoints.some(endpoint => endpoint.id === choice.endpointId))
      problems.push({
        section: 'model',
        row,
        message: 'This provider does not exist here. Switch to one of your connections.',
      });
  }
  const unresolved = unresolvedOf(agent.unresolved);
  const what = { computers: 'computer', dmPeers: 'agent', groups: 'group chat' } as const;
  for (const kind of ['computers', 'dmPeers', 'groups'] as const)
    for (const item of unresolved[kind])
      problems.push({
        section: 'links',
        kind,
        id: item.id,
        name: item.name,
        message: `The ${what[kind]} “${item.name}” is not on this swarm. Remove it${kind === 'computers' ? ', then assign one of yours' : ''}.`,
      });
  const discordChannels = await database.client.discordChannel.count({ where: { agentId, allowed: true } });
  if (discordChannels && !(await tokens.get(agentId)))
    problems.push({
      section: 'discord',
      message: 'Its Discord bot token is missing. Paste it again, or turn Discord off.',
    });
  return { paused: agent.paused, problems };
}

/** Drops one unresolved link from an imported agent (the owner chose to). */
export async function removeUnresolved(database: PlatformStore, agentId: string, kind: keyof Unresolved, id: string) {
  const agent = await database.client.agent.findUnique({ where: { id: agentId }, select: { unresolved: true } });
  if (!agent) return false;
  const unresolved = unresolvedOf(agent.unresolved);
  const list: { id: string }[] = unresolved[kind];
  const kept = list.filter(item => item.id !== id);
  if (kept.length === list.length) return false;
  await database.client.agent.update({
    where: { id: agentId },
    data: { unresolved: JSON.stringify({ ...unresolved, [kind]: kept }) },
  });
  return true;
}
