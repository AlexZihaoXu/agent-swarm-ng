import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { prepareDatabase } from './test-database';
import { EndpointStore } from './endpoint-store';
import { CodexProvider } from './codex-provider';
import { AgentRuns } from './agent-runs';
import { DmBroker } from './dm-broker';
import { buildApp } from './app';

type Body = { model: string; tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] };
async function fixture(loop = false, gate?: Promise<void>) {
  const captured: Body[] = []; let peerTarget = '';
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body: Body = JSON.parse(Buffer.concat(chunks).toString()); captured.push(body);
    const system = String(body.messages.find(message => message.role === 'system')?.content);
    const lastInput = JSON.stringify(body.messages.filter(message => message.role === 'user').at(-1));
    const triage = body.tools?.some(tool => tool.function.name === 'triage_decision');
    const dm = !triage && lastInput.includes('[Agent thread; reply channel:');
    const group = !triage && lastInput.includes('[Group chat; reply channel:');
    if (dm || group) await gate;
    if (response.destroyed) return;
    const incoming = JSON.stringify(body.messages.filter(message => message.role === 'user').at(-1));
    const hasTool = body.messages.some(message => message.role === 'tool');
    const publish = group ? !hasTool && lastInput.includes('Source is the human owner') : !dm || !hasTool && (loop || incoming.includes('question'));
    const channelId = dm || group ? lastInput.match(/reply channel: ([^.]+)\./)?.[1] : system.match(/(?:current channel is|channel is) ([^.]+)\./)?.[1];
    const name = triage ? 'triage_decision' : !dm && incoming.includes('ask-peer') && !hasTool ? 'send_dm' : 'send_message';
    const args = triage ? { action: 'queue', reason: 'Finish the current input first.' } : name === 'send_dm' ? { recipientId: peerTarget, text: 'question' } : { channelId, text: group ? `Group answer by ${system.startsWith('You are A.') ? 'A' : 'B'}` : dm ? 'answer' : 'Human reply', final: true };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: 'assistant' });
    if (publish) chunk({ tool_calls: [{ index: 0, id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    else chunk({ content: 'No useful reply remains. INTERNAL ONLY' });
    chunk({}, publish ? 'tool_calls' : 'stop'); response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const folder = await mkdtemp(join('.cache', 'dm-broker-'));
  const endpoints = new EndpointStore(join(folder, 'endpoints.json'));
  await endpoints.save({ id: 'mock', name: 'Mock', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` });
  const a = await database.createAgent({ name: 'A', endpointId: 'mock', model: 'test-model', thinkingLevel: 'off' });
  const b = await database.createAgent({ name: 'B', endpointId: 'mock', model: 'test-model', thinkingLevel: 'off' });
  peerTarget = b.id;
  const runs = new AgentRuns(), codex = new CodexProvider(), broker = new DmBroker(database, endpoints, codex, runs);
  await broker.ready();
  await broker.store.updateSettings(a.id, { allowedDmAgentIds: [b.id] });
  const idle = () => vi.waitFor(() => expect(runs.snapshot()).toHaveLength(0), { timeout: 30000 });
  const close = async (closeDatabase = true) => {
    broker.close(); await runs.shutdown(); await broker.settled(); if (closeDatabase) await database.close();
    await new Promise<void>(resolve => server.close(() => resolve())); await rm(folder, { recursive: true, force: true });
  };
  return { captured, database, endpoints, codex, a, b, runs, broker, idle, close };
}
it('delivers human and agent group messages through the normal inbox without DM grants or private-context transfer', async () => {
  const f = await fixture();
  try {
    await f.broker.store.updateSettings(f.a.id, { allowedDmAgentIds: [] });
    await f.database.appendMessage(f.a.channels[0].id, 'user', 'PRIVATE HUMAN A');
    await f.database.appendMessage(f.b.channels[0].id, 'user', 'PRIVATE HUMAN B');
    const group = await f.broker.groups.create('Shared research', [f.a.id, f.b.id]);
    await f.broker.sendHumanGroup(group.id, 'Contribute your findings', crypto.randomUUID());
    await f.idle();
    const messages = (await f.broker.groups.history(group.id)).messages;
    expect(messages).toHaveLength(3);
    expect(messages.map(message => message.text)).toEqual(expect.arrayContaining(['Contribute your findings', 'Group answer by A', 'Group answer by B']));
    expect(await f.database.client.dmGrant.count()).toBe(0);
    expect(await f.database.client.dmMessage.count()).toBe(0);
    expect(await f.database.client.message.count()).toBe(2);
    const a = f.captured.find(body => String(body.messages[0]?.content).startsWith('You are A.'))!;
    const b = f.captured.find(body => String(body.messages[0]?.content).startsWith('You are B.'))!;
    expect(JSON.stringify(a)).toContain('PRIVATE HUMAN A'); expect(JSON.stringify(a)).not.toContain('PRIVATE HUMAN B');
    expect(JSON.stringify(b)).toContain('PRIVATE HUMAN B'); expect(JSON.stringify(b)).not.toContain('PRIVATE HUMAN A');
    expect(a.tools?.map(tool => tool.function.name)).toEqual(expect.arrayContaining(['list_chats', 'read_group_messages', 'search_group_messages']));
    expect(String(a.messages[0]?.content)).toContain('focused assignment');
    expect(JSON.stringify(a.messages)).toContain('Source is the human owner');
    const captured = f.captured.length;
    const restarted = new DmBroker(f.database, f.endpoints, f.codex, f.runs);
    await restarted.ready(); await f.idle();
    expect(f.captured).toHaveLength(captured);
    expect((await f.broker.groups.history(group.id)).messages).toHaveLength(3);
  } finally { await f.close(); }
}, 30000);

it('exposes operator group creation, membership editing and human publication without DM side effects', async () => {
  const f = await fixture();
  const app = await buildApp({ database: f.database, endpointStore: f.endpoints, codex: f.codex });
  try {
    await f.broker.store.updateSettings(f.a.id, { allowedDmAgentIds: [] });
    const created = await app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'Research', agentIds: [f.a.id, f.b.id] } });
    expect(created.statusCode).toBe(200);
    const group = created.json();
    expect(group.members).toHaveLength(2);
    expect((await app.inject('/api/groups')).json().groups[0].id).toBe(group.id);
    const changed = await app.inject({ method: 'PATCH', url: `/api/groups/${group.id}`, payload: { name: 'Focused team', agentIds: [f.b.id] } });
    expect(changed.statusCode).toBe(200); expect(changed.json().members).toHaveLength(1);
    const posted = await app.inject({ method: 'POST', url: `/api/groups/${group.id}/messages`, payload: { message: 'A shared question', clientMessageId: crypto.randomUUID() } });
    expect(posted.statusCode).toBe(202);
    expect(posted.json().message).toMatchObject({ role: 'user', authorId: null });
    const messageId = posted.json().message.id;
    const reactionPath = `/api/chats/group:${group.id}/messages/${messageId}/reaction`;
    const reacted = await app.inject({ method: 'PUT', url: reactionPath, payload: { emoji: '👍', active: true } });
    expect(reacted.statusCode).toBe(200); expect(reacted.json().reactions).toEqual([{ emoji: '👍', count: 1, mine: true }]);
    expect((await app.inject(`/api/chats/group:${group.id}/reactions?ids=${messageId}`)).json().messages[0].reactions).toEqual(reacted.json().reactions);
    expect(await f.database.client.messageReaction.findFirst()).toMatchObject({ actorKey: 'human', agentId: null });
    await vi.waitFor(async () => expect((await app.inject(`/api/groups/${group.id}/messages`)).json().messages).toHaveLength(2), { timeout: 15000 });
    expect(await f.database.client.dmGrant.count()).toBe(0);
  } finally { await app.close(); await f.close(false); }
}, 20000);

it('delivers source-labelled agent threads through the normal inbox and queues unrelated busy work', async () => {
  const f = await fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.database.appendMessage(f.a.channels[0].id, 'user', 'PRIVATE HUMAN A');
    await f.database.appendMessage(f.b.channels[0].id, 'user', 'PRIVATE HUMAN B');
    const root = f.runs.start({ agentId: f.a.id, channelId: `other-work:${f.a.id}`, clientMessageId: crypto.randomUUID() }, async context => {
      await f.broker.send(f.a.id, f.b.id, 'question', 'send', context);
      expect((await f.broker.send(f.a.id, f.b.id, 'question', 'send', context)).duplicate).toBe(true);
      await gate;
    });
    await vi.waitFor(async () => expect(await f.database.client.dmMessage.count()).toBe(2), { timeout: 10000 });
    expect(f.runs.snapshot().find(run => run.agentId === f.a.id && run.runId !== root.runId)?.queued).toBe(true);
    expect(f.captured).toHaveLength(1);
    release(); await f.idle();
    const history = await f.broker.store.history(f.a.id, f.b.id);
    expect(history.messages.map(message => [message.senderId, message.text, message.status])).toEqual([[f.a.id, 'question', 'completed'], [f.b.id, 'answer', 'completed']]);
    const bContext = JSON.stringify(f.captured.find(body => String(body.messages[0]?.content).startsWith('You are B.')));
    expect(bContext).toContain('PRIVATE HUMAN B'); expect(bContext).not.toContain('PRIVATE HUMAN A');
    expect(bContext).toContain('Agent: A');
    expect(await f.database.client.message.count()).toBe(2);
    expect(history.messages.every(message => !message.text.includes('INTERNAL ONLY'))).toBe(true);
  } finally { release(); await f.close(); }
}, 20000);
it('bounds an automatic reply loop with one shared eight-message chain', async () => {
  const f = await fixture(true);
  try {
    f.runs.start({ agentId: f.a.id, channelId: f.a.channels[0].id, clientMessageId: crypto.randomUUID() }, async context => { await f.broker.send(f.a.id, f.b.id, 'question', 'send', context); });
    await f.idle();
    expect(await f.database.client.dmMessage.count()).toBe(8);
    expect(f.captured.length).toBeLessThanOrEqual(9);
    expect(await f.database.client.message.count()).toBe(0);
    expect((await f.database.client.dmChain.findFirst())?.remaining).toBe(0);
  } finally { await f.close(); }
}, 40000);
it('admits and coalesces private human work while the same agent is busy in a DM', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(false, gate);
  const app = await buildApp({ database: f.database, endpointStore: f.endpoints, codex: f.codex });
  try {
    const post = (agentId: string, message: string) => app.inject({ method: 'POST', url: '/api/chat', headers: { prefer: 'respond-async' }, payload: { agentId, message, clientMessageId: crypto.randomUUID() } });
    await post(f.a.id, 'ask-peer');
    await vi.waitFor(() => expect(f.captured.some(body => JSON.stringify(body.messages).includes('[Agent thread; reply channel:'))).toBe(true), { timeout: 10000 });
    const first = await post(f.b.id, 'PRIVATE queued human request');
    expect(first.statusCode).toBe(202); expect(first.json().run.queued).not.toBe(true);
    const second = await post(f.b.id, 'PRIVATE queued follow-up');
    expect(second.statusCode).toBe(202); expect(second.json().run.runId).toBe(first.json().run.runId);
    release();
    await vi.waitFor(async () => expect(await f.database.client.message.count({ where: { channelId: f.b.channels[0].id, role: 'assistant' } })).toBe(1), { timeout: 15000 });
    expect(JSON.stringify(await f.database.client.dmMessage.findMany())).not.toContain('PRIVATE queued');
    const human = JSON.stringify(f.captured.find(body => !body.tools?.some(tool => tool.function.name === 'triage_decision') && JSON.stringify(body.messages.at(-1)).includes('PRIVATE queued follow-up')));
    expect(human.match(/PRIVATE queued human request/g)).toHaveLength(1);
    expect(human.match(/PRIVATE queued follow-up/g)).toHaveLength(1);
  } finally { release(); await app.close(); await f.close(false); }
}, 30000);
it('enforces mutual revocation before a recipient replies rather than relying on the prompt', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(false, gate);
  try {
    f.runs.start({ agentId: f.a.id, channelId: f.a.channels[0].id, clientMessageId: crypto.randomUUID() }, async context => { await f.broker.send(f.a.id, f.b.id, 'question', 'send', context); });
    await vi.waitFor(() => expect(f.captured).toHaveLength(1), { timeout: 10000 });
    await f.broker.store.updateSettings(f.b.id, { allowedDmAgentIds: [] });
    release(); await f.idle();
    expect(await f.database.client.dmMessage.count()).toBe(1);
    expect(await f.database.client.message.count()).toBe(0);
  } finally { release(); await f.close(); }
}, 20000);
it('cancels descendant work before deleting its origin, without a late publication', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(false, gate);
  try {
    const root = f.runs.start({ agentId: f.a.id, channelId: f.a.channels[0].id, clientMessageId: crypto.randomUUID() }, async context => { await f.broker.send(f.a.id, f.b.id, 'question', 'send', context); });
    await root.finished;
    await vi.waitFor(() => expect(f.captured).toHaveLength(1), { timeout: 10000 });
    await f.broker.beforeDelete(f.a.id);
    await f.database.deleteAgent(f.a.id, f.a.name); f.broker.afterDelete(f.a.id);
    release(); await f.idle();
    expect(await f.database.client.dmMessage.count()).toBe(0);
    expect(f.captured).toHaveLength(1);
  } finally { release(); await f.close(); }
}, 20000);
it('exposes atomic settings and inspectable transcripts without granting an HTTP model-send endpoint', async () => {
  const f = await fixture();
  const app = await buildApp({ database: f.database, endpointStore: f.endpoints, codex: f.codex });
  try {
    const path = `/api/agents/${f.a.id}/settings`;
    expect((await app.inject({ method: 'GET', url: path })).json().allowedDmAgents).toEqual([{ id: f.b.id, name: 'B' }]);
    const denied = await app.inject({ method: 'PATCH', url: path, payload: { allowedDmAgentIds: [f.a.id] } }); expect(denied.statusCode).toBe(400);
    const updated = await app.inject({ method: 'PATCH', url: path, payload: { allowedDmAgentIds: [], avatar: { shape: 'bean', color: '#FfAA22', seed: 3 } } });
    expect(updated.statusCode).toBe(200); expect(updated.json().avatar.color).toBe('#ffaa22'); expect(updated.json().allowedDmAgents).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/agents/${f.a.id}/dms/${f.b.id}` })).json().messages).toEqual([]);
    expect((await app.inject({ method: 'POST', url: `/api/agents/${f.a.id}/dms/${f.b.id}`, payload: { text: 'spoof' } })).statusCode).toBe(404);
    await app.inject({ method: 'PATCH', url: `/api/agents/${f.b.id}/settings`, payload: { allowedDmAgentIds: [f.a.id] } });
    expect((await app.inject(path)).json().allowedDmAgents).toEqual([{ id: f.b.id, name: 'B' }]);
    const chain = crypto.randomUUID(); await f.broker.store.beginChain(f.a.id, chain);
    const sent = await f.broker.store.send({ senderId: f.a.id, recipientId: f.b.id, chainId: chain, deliveryKey: 'notice', text: 'x'.repeat(500) });
    const inbox = await app.inject(`/api/agents/${f.b.id}/dm-inbox`);
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().messages[0]).toMatchObject({ id: sent.message.id, senderId: f.a.id, senderName: 'A', senderAvatar: { shape: 'bean' }, preview: 'x'.repeat(320) + '…' });
    expect((await app.inject(`/api/agents/${f.a.id}/dm-inbox`)).json().messages).toEqual([]);
    expect(await f.database.client.message.count()).toBe(0);
  } finally { await app.close(); await f.close(false); }
}, 20000);
