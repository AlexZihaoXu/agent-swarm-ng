import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { prepareDatabase } from './test-database';
import { EndpointStore } from './endpoint-store';
import { CodexProvider } from './codex-provider';
import { AgentRuns } from './agent-runs';
import { DmBroker } from './dm-broker';
import { HeartbeatScheduler, inHours } from './heartbeat';

type Message = { role: string; content: unknown; tool_calls?: { function: { name: string } }[] };
/**
 * A scripted model. On a heartbeat it calls `first` (a read, or a change), then stops; asked for a note it leaves
 * one (or not). A real message is answered with send_message.
 */
async function fixture(script: { first: 'help' | 'send_message'; note?: string; arrive?: () => void }) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body: { model: string; messages: Message[] } = JSON.parse(Buffer.concat(chunks).toString());
    const last = body.messages.at(-1)!;
    const text = JSON.stringify(last.content);
    const channel = /\[channel: ([^\]]+)\]/.exec(JSON.stringify(body.messages))?.[1];
    let call: { name: string; args: object } | undefined;
    if (last.role === 'user' && text.includes('Leave a short note for yourself'))
      call = script.note ? { name: 'leave_note', args: { text: script.note } } : undefined;
    else if (last.role === 'user' && text.includes('Heartbeat '))
      call =
        script.first === 'help'
          ? { name: 'help', args: { class: 'r' } }
          : { name: 'send_message', args: { channelId: channel, text: 'Build finished.' } };
    else if (last.role === 'user' && text.includes('Real question'))
      call = { name: 'send_message', args: { channelId: channel, text: 'Answer.' } };
    else if (last.role === 'tool' && script.arrive) {
      script.arrive();
      script.arrive = undefined;
    }
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
    else chunk({ content: 'Nothing to do.' });
    chunk({}, call ? 'tool_calls' : 'stop');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const folder = await mkdtemp(join('.scratch', 'heartbeat-'));
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
  const saved = async () => JSON.stringify((await broker.sessions.load(agent.id))?.getEntries() ?? []);
  const labels = async () =>
    (await database.client.activity.findMany({ where: { agentId: agent.id }, orderBy: { sequence: 'asc' } })).map(
      row => `${row.label}: ${row.text}`,
    );
  const close = async () => {
    broker.close();
    await runs.shutdown();
    await broker.settled();
    await database.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  };
  return { database, agent, runs, broker, idle, saved, labels, close };
}

it('drops a quiet heartbeat from the saved context, keeping only the note it chose to leave', async () => {
  const f = await fixture({ first: 'help', note: 'Build still running; look again at 15:00.' });
  try {
    await f.broker.startHeartbeat(f.agent.id, 'Check the nightly build.');
    await f.idle();
    const saved = await f.saved();
    expect(saved).not.toContain('Check the nightly build.');
    expect(saved).not.toContain('Nothing to do.');
    expect(saved).toContain('note to self] Build still running; look again at 15:00.');
    const log = (await f.labels()).join('\n');
    expect(log).toContain('Heartbeat ended');
    expect(log).toContain('Heartbeat dropped: Nothing changed. Note kept in its context: Build still running');
    expect(await f.database.client.message.count()).toBe(0);
    // Without a note nothing is kept at all.
    const before = await f.saved();
    const next = await fixture({ first: 'help' });
    try {
      await next.broker.startHeartbeat(next.agent.id, '');
      await next.idle();
      expect(await next.saved()).not.toContain('Heartbeat');
      expect((await next.labels()).join('\n')).toContain('nothing was kept in its context');
    } finally {
      await next.close();
    }
    expect(await f.saved()).toBe(before);
  } finally {
    await f.close();
  }
}, 60_000);

it('promotes a heartbeat at its first change and keeps it all', async () => {
  const f = await fixture({ first: 'send_message', note: 'never asked' });
  try {
    await f.broker.startHeartbeat(f.agent.id, 'Check the nightly build.');
    await f.idle();
    const saved = await f.saved();
    expect(saved).toContain('Check the nightly build.');
    expect(saved).toContain('This heartbeat is now your real turn (you called send_message)');
    expect(saved).not.toContain('never asked');
    expect((await f.labels()).join('\n')).toContain(
      'Heartbeat promoted: It became a real turn: you called send_message.',
    );
    expect((await f.database.client.message.findMany()).map(message => message.text)).toEqual(['Build finished.']);
  } finally {
    await f.close();
  }
}, 60_000);

it('promotes a heartbeat when a real message arrives during it', async () => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  f = await fixture({
    first: 'help',
    arrive: () => {
      const id = crypto.randomUUID();
      f.runs.offer(
        f.agent.id,
        { role: 'user', id, text: 'Real question', timestamp: Date.now() },
        { type: 'message', channelId: f.agent.channels[0].id },
      );
    },
  });
  try {
    await f.broker.startHeartbeat(f.agent.id, 'Check the nightly build.');
    await f.idle();
    const saved = await f.saved();
    expect(saved).toContain('Check the nightly build.');
    expect(saved).toContain('Real question');
    expect((await f.labels()).join('\n')).toContain(
      'Heartbeat promoted: It became a real turn: a new message arrived.',
    );
    expect((await f.database.client.message.findMany()).map(message => message.text)).toContain('Answer.');
  } finally {
    await f.close();
  }
}, 60_000);

it('starts heartbeats when due, inside active hours, only while the agent is idle', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  try {
    const agent = await database.createAgent({ name: 'A', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
    await database.client.agent.update({
      where: { id: agent.id },
      data: { heartbeatEnabled: true, heartbeatMinutes: 30, heartbeatChecklist: 'Look.' },
    });
    let now = 0,
      idle = false;
    const started: string[] = [];
    const scheduler = new HeartbeatScheduler(
      database,
      () => idle,
      async (_id, checklist) => void started.push(checklist),
      () => now,
    );
    await scheduler.tick();
    now = 29 * 60_000;
    idle = true;
    await scheduler.tick();
    expect(started).toEqual([]);
    now = 31 * 60_000;
    idle = false;
    await scheduler.tick();
    expect(started).toEqual([]);
    idle = true;
    await scheduler.tick();
    expect(started).toEqual(['Look.']);
    // Real work resets the clock.
    now = 50 * 60_000;
    scheduler.active(agent.id);
    now = 70 * 60_000;
    await scheduler.tick();
    expect(started).toHaveLength(1);
    now = 81 * 60_000;
    await scheduler.tick();
    expect(started).toHaveLength(2);
  } finally {
    await database.close();
  }
  const at = (hours: number, minutes = 0) => new Date(2026, 9, 1, hours, minutes);
  expect(inHours('', '', at(3))).toBe(true);
  expect(inHours('09:00', '17:00', at(9))).toBe(true);
  expect(inHours('09:00', '17:00', at(17))).toBe(false);
  expect(inHours('22:00', '06:00', at(23, 30))).toBe(true);
  expect(inHours('22:00', '06:00', at(12))).toBe(false);
});
