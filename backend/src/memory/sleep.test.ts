import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { EndpointStore } from '../endpoint-store';
import { CodexProvider } from '../codex-provider';
import { AgentRuns } from '../agent-runs';
import { DmBroker } from '../dm-broker';
import { offHours, SleepScheduler } from './sleep';

const owner = { by: 'your owner', trust: 'owner' as const };
const at = (clock: string) => new Date(`2026-10-02T${clock}:00`);

it('sleeps outside active hours, or in its own window when active all day', () => {
  const window = { sleepFrom: '03:00', sleepTo: '05:00' };
  expect(
    offHours({ heartbeatEnabled: true, heartbeatFrom: '09:00', heartbeatTo: '18:00', ...window }, at('20:00')),
  ).toBe(true);
  expect(
    offHours({ heartbeatEnabled: true, heartbeatFrom: '09:00', heartbeatTo: '18:00', ...window }, at('10:00')),
  ).toBe(false);
  expect(offHours({ heartbeatEnabled: true, heartbeatFrom: '', heartbeatTo: '', ...window }, at('04:00'))).toBe(true);
  expect(offHours({ heartbeatEnabled: true, heartbeatFrom: '', heartbeatTo: '', ...window }, at('06:00'))).toBe(false);
  // Active hours count only while the heartbeat is on.
  expect(
    offHours({ heartbeatEnabled: false, heartbeatFrom: '09:00', heartbeatTo: '18:00', ...window }, at('20:00')),
  ).toBe(false);
});

it('starts a sleep once per night, only with something new since the last one', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  try {
    const busy = await database.createAgent({ name: 'A', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
    const quiet = await database.createAgent({ name: 'B', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
    await database.client.agentSession.create({
      data: { agentId: busy.id, sessionId: 's', header: '{}', entryCount: 5 },
    });
    let now = at('04:00').getTime();
    const slept: string[] = [];
    let wake = () => {};
    const scheduler = new SleepScheduler(
      database,
      async agentId => {
        slept.push(agentId);
        await new Promise<void>(resolve => (wake = resolve));
      },
      () => now,
    );
    await scheduler.tick();
    await scheduler.tick();
    expect(slept).toEqual([busy.id]);
    wake();
    await vi.waitFor(() => expect(scheduler.sleeping.size).toBe(0));
    // It did not finish (no sleptAt): it is tried again only after an hour, not on every tick.
    await scheduler.tick();
    expect(slept).toEqual([busy.id]);
    await database.client.agent.update({ where: { id: busy.id }, data: { sleptAt: new Date(now), sleptPosition: 5 } });
    now += 3_600_000;
    await scheduler.tick();
    expect(slept).toEqual([busy.id]);
    expect(quiet.id).not.toBe(busy.id);
  } finally {
    await database.close();
  }
});

it('reorganises memories asleep: the agent’s own newer edit wins, the index is rebuilt and last night is noted', async () => {
  let broker!: DmBroker;
  let agentId = '';
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const last = body.messages.at(-1);
    const text = JSON.stringify(last.content);
    let call: { name: string; args: object } | undefined;
    if (last.role === 'user' && text.includes('Your memories now')) {
      expect(JSON.stringify(body.messages[0])).toContain('You are A, asleep.');
      expect(text).toContain('The owner said the build moved to 03:00');
      // Meanwhile, awake, the agent revises the same memory: its edit wins over sleep's.
      await broker.memory.revise(agentId, 'nightly-build', { text: 'Runs at 03:00 (agent).' }, 'agent');
      call = { name: 'revise_memory', args: { name: 'nightly-build', text: 'Runs at 03:00 (sleep).' } };
    } else if (last.role === 'tool' && text.includes('changed since'))
      call = {
        name: 'memorize',
        args: { type: 'skill', title: 'Check builds after 03:00', text: 'The build runs at 03:00.', source: 'owner' },
      };
    else if (last.role === 'tool' && text.includes('saved'))
      call = { name: 'revise_memory', args: { name: 'old-note', faded: true } };
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
  const folder = await mkdtemp(join('.scratch', 'sleep-'));
  const runs = new AgentRuns();
  try {
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
    agentId = agent.id;
    broker = new DmBroker(database, endpoints, new CodexProvider(), runs);
    await broker.ready();
    await broker.memory.memorize(agent.id, { type: 'project', title: 'Nightly build', text: 'Runs at 02:00.' }, owner);
    await broker.memory.memorize(agent.id, { type: 'reference', title: 'Old note', text: 'Rarely used.' }, owner);
    const entry = {
      type: 'message',
      id: 'e1',
      timestamp: '2026-10-01T12:00:00Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '[channel: x]\nThe owner said the build moved to 03:00.' }],
      },
    };
    await database.client.agentSession.create({
      data: { agentId: agent.id, sessionId: 's', header: '{}', entryCount: 1 },
    });
    await database.client.agentSessionEntry.create({
      data: { agentId: agent.id, position: 0, entryId: 'e1', parentId: null, payload: JSON.stringify(entry) },
    });
    expect(broker.sleeper.run(agent.id)).toBe(true);
    await vi.waitFor(() => expect(broker.sleeper.sleeping.size).toBe(0), { timeout: 30000 });
    expect((await broker.memory.get(agent.id, 'nightly-build'))?.text).toBe('Runs at 03:00 (agent).');
    expect(await broker.memory.get(agent.id, 'check-builds-after-03-00')).toMatchObject({
      type: 'skill',
      trust: 'owner',
      by: 'your owner (consolidated in sleep)',
    });
    const saved = await database.findAgent(agent.id);
    expect(saved?.memoryIndex).toContain('- check-builds-after-03-00 [skill] Check builds after 03:00');
    expect(saved?.memoryIndex).not.toContain('old-note');
    expect(saved).toMatchObject({ sleptPosition: 1 });
    expect(saved?.sleptAt).toBeTruthy();
    expect(saved?.sleepNote).toBe(
      '- memorized check-builds-after-03-00: Check builds after 03:00\n- revised old-note (faded from the index)',
    );
    const log = (
      await database.client.activity.findMany({ where: { agentId: agent.id }, orderBy: { sequence: 'asc' } })
    )
      .map(row => `${row.label}: ${row.text}`)
      .join('\n');
    expect(log).toContain('Sleep finished: 2 change(s)');
    expect(log).toContain('Sleep ended');
  } finally {
    broker?.close();
    await runs.shutdown();
    await broker?.settled();
    await database.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
}, 60_000);
