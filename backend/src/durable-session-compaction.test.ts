import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { prepareDatabase } from './test-database';
import { AgentSessionStore } from './agent-session-store';
import { createChatSession } from './chat-runtime';

it('keeps the last checkpoint on incomplete compaction and restores the next completed summary', async () => {
  let incomplete = true;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* consume the mock provider request */
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(
      `data: ${JSON.stringify({ id: 'compact-test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content: 'Durable compact summary of earlier work.' }, finish_reason: incomplete ? 'length' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  let session: Awaited<ReturnType<typeof createChatSession>> | undefined;
  try {
    const agent = await database.createAgent({ name: 'A', endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
    const manager = SessionManager.inMemory();
    for (let index = 0; index < 12; index++) {
      manager.appendMessage({
        role: 'user',
        content: `Earlier input ${index}: ${'details '.repeat(80)}`,
        timestamp: index * 2 + 1,
      });
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `Earlier answer ${index}: ${'findings '.repeat(80)}` }],
        api: 'openai-completions',
        provider: 'swarm-chat',
        model: 'test',
        stopReason: 'stop',
        timestamp: index * 2 + 2,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      });
    }
    session = await createChatSession(
      {
        name: 'A',
        model: 'test',
        thinkingLevel: 'off',
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
        channel: { id: agent.channels[0].id, agentId: agent.id, kind: 'platform-chat' },
      },
      [],
      () => {},
      [],
      undefined,
      manager,
    );
    expect(session.settingsManager.getCompactionSettings().enabled).toBe(true);
    session.settingsManager.applyOverrides({
      compaction: { enabled: true, reserveTokens: 2048, keepRecentTokens: 500 },
    });
    const sessions = new AgentSessionStore(database);
    await sessions.save(agent.id, session.sessionManager);
    await expect(session.compact()).rejects.toThrow('incomplete');
    expect((await sessions.load(agent.id))!.getEntries().some(entry => entry.type === 'compaction')).toBe(false);
    incomplete = false;
    const compacted = await session.compact();
    expect(compacted.summary).toContain('Durable compact summary');
    await sessions.save(agent.id, session.sessionManager);
    const restored = (await sessions.load(agent.id))!;
    expect(restored.getEntries().filter(entry => entry.type === 'compaction')).toHaveLength(1);
    expect(restored.buildSessionContext().messages).toEqual(session.sessionManager.buildSessionContext().messages);
    expect(
      restored.buildSessionContext().messages.filter(message => message.role === 'compactionSummary'),
    ).toHaveLength(1);
    expect(restored.getEntries().length).toBeLessThan(session.sessionManager.getEntries().length);
    expect(await database.client.agentSessionEntry.count({ where: { agentId: agent.id } })).toBe(
      session.sessionManager.getEntries().length,
    );
    const resumed = await createChatSession(
      {
        name: 'A',
        model: 'test',
        thinkingLevel: 'off',
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
        channel: { id: agent.channels[0].id, agentId: agent.id, kind: 'platform-chat' },
      },
      [],
      () => {},
      [],
      undefined,
      restored,
    );
    try {
      expect(resumed.messages).toEqual(restored.buildSessionContext().messages);
      expect(resumed.agent.state.tools.map(tool => tool.name)).toEqual(['send_message', 'help']);
    } finally {
      resumed.dispose();
    }
  } finally {
    session?.dispose();
    await database.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 15000);
