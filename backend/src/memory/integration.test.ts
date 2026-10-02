import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { EndpointStore } from '../endpoint-store';
import { CodexProvider } from '../codex-provider';
import { AgentRuns } from '../agent-runs';
import { DmBroker } from '../dm-broker';

type Message = { role: string; content: unknown };
type Call = { name: string; args: object };

/** A scripted model: `reply(last message text, role)` decides its tool call; every request body is kept. */
async function fixture(reply: (text: string, role: string, channel?: string) => Call | undefined) {
  const requests: { messages: Message[] }[] = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body: { model: string; messages: Message[] } = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const last = body.messages.at(-1)!;
    const channel = /\[channel: ([^\]]+)\]/.exec(JSON.stringify(body.messages))?.[1];
    const call = reply(JSON.stringify(last.content), last.role, channel);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    chunk({ role: 'assistant' });
    if (call)
      chunk({
        tool_calls: [
          {
            index: 0,
            id: crypto.randomUUID(),
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          },
        ],
      });
    else chunk({ content: 'Done.' });
    chunk({}, call ? 'tool_calls' : 'stop');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const folder = await mkdtemp(join('.scratch', 'memory-'));
  const endpoints = new EndpointStore(join(folder, 'endpoints.json'));
  await endpoints.save({
    id: 'mock',
    name: 'Mock',
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  });
  const agent = await database.createAgent({
    name: 'A',
    endpointId: 'mock',
    model: 'test-model',
    thinkingLevel: 'off',
  });
  const runs = new AgentRuns();
  const broker = new DmBroker(database, endpoints, new CodexProvider(), runs);
  await broker.ready();
  const idle = () => vi.waitFor(() => expect(runs.snapshot()).toHaveLength(0), { timeout: 30000 });
  const ownerSays = (text: string) => {
    const id = crypto.randomUUID();
    const channelId = (agent as unknown as { channels: { id: string }[] }).channels?.[0]?.id;
    return database.findAgent(agent.id).then(found => {
      const channel = channelId ?? found!.channels[0].id;
      runs.enqueue({ agentId: agent.id, channelId: channel, clientMessageId: id }, context =>
        broker.runInbox(agent.id, { role: 'user', id, text, timestamp: Date.now() }, context),
      );
    });
  };
  const close = async () => {
    broker.close();
    await runs.shutdown();
    await broker.settled();
    await database.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  };
  return { database, agent, runs, broker, requests, idle, ownerSays, close };
}
const owner = { by: 'your owner', trust: 'owner' as const };

it('reminds on non-chat events and tool calls, once within a third of the context, with the index and last night', async () => {
  const f = await fixture((text, role) => {
    if (role === 'user' && text.includes('Timer fired'))
      return { name: 'scratch_write', args: { path: 'notes.md', content: 'postgres upgrade checklist' } };
    if (role === 'tool' && text.includes('Memory reminder'))
      return { name: 'scratch_write', args: { path: 'more.md', content: 'postgres upgrade again' } };
    return undefined;
  });
  try {
    await f.broker.memory.memorize(
      f.agent.id,
      { type: 'reference', title: 'Staging server', text: 'Runs postgres for tests; host staging-1.' },
      owner,
    );
    await f.broker.memory.memorize(
      f.agent.id,
      { type: 'project', title: 'Postgres upgrade', text: 'Move to 17 after the release.' },
      owner,
    );
    await f.broker.memory.rebuildIndex(f.agent.id);
    await f.database.client.agent.update({
      where: { id: f.agent.id },
      data: { sleepNote: '- merged two notes about staging' },
    });
    await f.broker.deliverPlatformEvent(f.agent.id, 'timer', 'Timer fired: check staging', true);
    await f.idle();
    const [first, second, third] = f.requests;
    const system = JSON.stringify(first.messages[0].content);
    expect(system).toContain('## Your long-term memory');
    expect(system).toContain('- staging-server [reference] Staging server');
    const firstTurn = JSON.stringify(first.messages.slice(1));
    expect(firstTurn).toContain('While you slept, your memory was reorganised');
    // The non-chat event is a cue: its reminder comes with it, with where the memory came from.
    expect(firstTurn).toContain('[Memory: this reminds you of');
    expect(firstTurn).toContain(
      '- staging-server [reference] Staging server: Runs postgres for tests; host staging-1. (from your owner (trusted)',
    );
    expect(firstTurn).not.toContain('postgres-upgrade');
    // The tool call is a cue too (one short line); the same memory is not repeated on the next call.
    expect(JSON.stringify(second.messages.at(-1))).toContain('[Memory reminder: postgres-upgrade: Postgres upgrade');
    expect(JSON.stringify(third.messages.at(-1))).not.toContain('Memory reminder');
    expect((await f.database.findAgent(f.agent.id))?.sleepNoteTold).toBe(true);
    expect((await f.broker.memory.get(f.agent.id, 'staging-server'))?.recalls).toBe(1);
  } finally {
    await f.close();
  }
}, 60_000);

it('memorizes with the turn’s provenance and recalls it, marking it shown', async () => {
  const f = await fixture((text, role) => {
    if (role === 'user' && text.includes('Remember that'))
      return {
        name: 'memorize',
        args: { type: 'preference', title: 'Owner wants tables', text: 'Compare options in a table.' },
      };
    if (role === 'tool' && text.includes('saved')) return { name: 'recall', args: { query: 'tables' } };
    return undefined;
  });
  try {
    await f.ownerSays('Remember that I like tables.');
    await f.idle();
    const saved = await f.broker.memory.get(f.agent.id, 'owner-wants-tables');
    expect(saved).toMatchObject({ by: 'your owner', trust: 'owner', type: 'preference' });
    const recalled = f.requests
      .map(request => request.messages.at(-1)!)
      .filter(message => message.role === 'tool')
      .map(message => JSON.stringify(message));
    expect(recalled.at(-1)).toContain('owner-wants-tables');
    // Memory tools are never cues.
    expect(recalled.join('')).not.toContain('Memory reminder');
  } finally {
    await f.close();
  }
}, 60_000);
