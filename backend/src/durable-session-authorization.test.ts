import { expect, it } from 'vitest';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { prepareDatabase } from './test-database';
import { AgentSessionStore } from './agent-session-store';
import { GroupStore } from './group-store';
import { SwarmStore } from './swarm-store';
import { createGroupTools } from './group-tools';
import { createChatSession } from './chat-runtime';

for (const change of ['revoked', 'deleted'] as const)
  it(`a restored agent remembers a ${change} group without retaining chat-app access`, async () => {
    const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
    let session: Awaited<ReturnType<typeof createChatSession>> | undefined;
    try {
      const agent = (name: string) =>
        database.createAgent({ name, endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
      const a = await agent('A'),
        b = await agent('B');
      const groups = new GroupStore(database);
      const group = await groups.create('Shared', [a.id, b.id]);
      const manager = SessionManager.inMemory();
      manager.appendMessage({
        role: 'user',
        content: `[Group chat; reply channel: group:${group.id}] Previously seen group content`,
        timestamp: 1,
      });
      const sessions = new AgentSessionStore(database);
      await sessions.save(a.id, manager);
      if (change === 'revoked') await groups.update(group.id, group.name, [b.id]);
      else await groups.remove(group.id, group.name);
      const restored = (await sessions.load(a.id))!;
      expect(JSON.stringify(restored.buildSessionContext().messages)).toContain('Previously seen group content');
      const channel = { id: a.channels[0].id, agentId: a.id, kind: 'platform-chat' as const };
      session = await createChatSession(
        { name: 'A', model: 'test', thinkingLevel: 'off', baseUrl: 'http://127.0.0.1:1/v1', channel },
        [],
        () => {},
        createGroupTools(groups, new SwarmStore(database), channel),
        undefined,
        restored,
      );
      const list = session.agent.state.tools.find(tool => tool.name === 'list_chats')!;
      const available = await list.execute('list', {}, undefined, undefined as never);
      expect(JSON.parse((available.content[0] as { text: string }).text).groups).toEqual([]);
      const read = session.agent.state.tools.find(tool => tool.name === 'read_group_messages')!;
      await expect(
        read.execute('read', { channelId: `group:${group.id}` }, undefined, undefined as never),
      ).rejects.toThrow('member');
      expect(session.sessionFile).toBeUndefined();
    } finally {
      session?.dispose();
      await database.close();
    }
  });
