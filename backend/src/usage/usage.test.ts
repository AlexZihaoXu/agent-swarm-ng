import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionManager, type AgentSession, type AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { prepareDatabase } from '../test-database';
import { createChatSession, resolveChatModel, type ChatConfiguration } from '../chat-runtime';
import { AgentSessionStore } from '../agent-session-store';
import { evaluateInterruption } from '../interruption-triage';
import { runDecisionFork } from '../decision-fork';
import { judgeWatch } from '../computer-use/watch-judge';
import { meterSession, meterStream } from './meter';
import { usageRecorder } from './recorder';
import { backfillUsage } from './backfill';
import type { PlatformStore } from '../platform-store';

/** A fake OpenAI-compatible model that reports usage: a tool call or text, scripted per request. */
let server: Server;
let baseUrl = '';
let script: ({ tool: string; args: object } | string)[] = [];
beforeAll(async () => {
  server = createServer(async (request, response) => {
    for await (const _ of request);
    const step = script.shift() ?? 'ok';
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (body: object) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: 'test', ...body })}\n\n`,
      );
    if (typeof step === 'string') chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: step } }] });
    else
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: step.tool, arguments: JSON.stringify(step.args) },
                },
              ],
            },
          },
        ],
      });
    chunk({
      choices: [{ index: 0, delta: {}, finish_reason: typeof step === 'string' ? 'stop' : 'tool_calls' }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    });
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
afterEach(() => usageRecorder.configure(undefined));

let count = 0;
async function setup() {
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'usage-'));
  const db = await prepareDatabase(join(folder, `usage-${++count}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'endpoint-1', model: 'test', thinkingLevel: 'off' });
  usageRecorder.configure(db, { error: error => console.error(error) });
  const config: ChatConfiguration = {
    name: 'A',
    model: 'test',
    thinkingLevel: 'off',
    baseUrl,
    apiKey: 'key',
    channel: { id: agent.channels[0].id, kind: 'platform-chat', agentId: agent.id },
  };
  return { db, agent, config };
}
const rows = async (db: PlatformStore) => {
  await usageRecorder.flush();
  return db.client.usageEvent.findMany({ orderBy: { sequence: 'asc' } });
};

it('records each response of a saved session once, with the key the backfill uses, and never twice', async () => {
  const { db, agent, config } = await setup();
  try {
    const manager = SessionManager.inMemory();
    const session = await createChatSession(config, [], () => {}, [], undefined, manager);
    let promoted = false;
    meterSession(session, { agentId: agent.id, purpose: () => (promoted ? 'turn' : 'heartbeat'), saved: true });
    script = ['first'];
    await session.prompt('hello', { expandPromptTemplates: false });
    promoted = true;
    script = ['second'];
    await session.prompt('again', { expandPromptTemplates: false });
    const assistants = manager
      .getEntries()
      .filter(entry => entry.type === 'message' && entry.message.role === 'assistant');
    expect(assistants).toHaveLength(2);
    const live = await rows(db);
    expect(live.map(row => [row.purpose, row.sourceKey])).toEqual([
      ['heartbeat', `entry:${agent.id}:${assistants[0].id}`],
      ['turn', `entry:${agent.id}:${assistants[1].id}`],
    ]);
    expect(live[0]).toMatchObject({
      agentId: agent.id,
      provider: session.model!.provider,
      model: 'test',
      endpointId: 'endpoint-1',
      input: 100,
      output: 10,
    });
    // The saved session backfills nothing new: same keys. A message saved before recording existed is added once.
    manager.appendMessage({
      ...(assistants[1] as { message: object }).message,
      timestamp: 1_000,
    } as never);
    await new AgentSessionStore(db).save(agent.id, manager);
    expect(await backfillUsage(db, 1)).toBe(1);
    expect(await backfillUsage(db)).toBe(0);
    const all = await rows(db);
    expect(all).toHaveLength(3);
    expect(all[2]).toMatchObject({ purpose: 'turn', at: new Date(1_000), endpointId: 'endpoint-1', input: 100 });
    session.dispose();
  } finally {
    await db.close();
  }
});

it('records forks with their purpose: interruption triage, decision forks (Discord) and watch checks', async () => {
  const { db, agent, config } = await setup();
  try {
    const main = await createChatSession(config, [], () => {}, []);
    script = [{ tool: 'triage_decision', args: { action: 'queue', reason: 'later' } }];
    const triage = await evaluateInterruption(
      main,
      config.channel.id,
      [{ role: 'user', text: 'by the way' }],
      new AbortController().signal,
      undefined,
      agent.id,
    );
    expect(triage.action).toBe('queue');
    script = [{ tool: 'admission_decision', args: { action: 'admit', reason: 'for me' } }];
    const admission = await runDecisionFork(
      {
        tool: 'admission_decision',
        label: 'Discord relevance check',
        purpose: 'discord',
        description: 'Decide.',
        actions: ['ignore', 'admit'],
        system: () => 'Decide.',
        prompt: 'New messages',
        fallback: 'ignore',
      },
      config,
      [],
      new AbortController().signal,
    );
    expect(admission.action).toBe('admit');
    script = ['KEEP_WATCHING: nothing yet'];
    await judgeWatch({
      ...(await resolveChatModel(config)),
      channelId: config.channel.id,
      tools: [],
      text: 'Condition',
      images: [],
      signal: new AbortController().signal,
      agentId: agent.id,
    });
    expect((await rows(db)).map(row => [row.purpose, row.sourceKey, row.input])).toEqual([
      ['triage', null, 100],
      ['discord', null, 100],
      ['watch', null, 100],
    ]);
    main.dispose();
  } finally {
    await db.close();
  }
});

it('records SDK compaction results and metered stream calls, and skips responses without usage', async () => {
  const { db, agent } = await setup();
  try {
    const listeners: ((event: AgentSessionEvent) => void)[] = [];
    const session = {
      subscribe: (listener: (event: AgentSessionEvent) => void) => {
        listeners.push(listener);
        return () => {};
      },
      sessionManager: SessionManager.inMemory(),
      model: { provider: 'openrouter', id: 'm' },
    } as unknown as AgentSession;
    meterSession(session, { agentId: agent.id, purpose: 'other' });
    const usage = (input: number) => ({
      input,
      output: 1,
      cacheRead: 2,
      cacheWrite: 0,
      reasoning: 1,
      totalTokens: input + 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
    });
    const zero = { ...usage(0), output: 0, cacheRead: 0, reasoning: 0, cost: { ...usage(0).cost, total: 0 } };
    const message = (value: object) =>
      ({ role: 'assistant', provider: 'openrouter', model: 'm', timestamp: 5_000, usage: value }) as never;
    for (const listener of listeners) {
      listener({ type: 'message_end', message: message(usage(7)) });
      listener({ type: 'message_end', message: message(zero) });
      listener({ type: 'message_end', message: { role: 'user', content: 'x', timestamp: 1 } as never });
      listener({
        type: 'compaction_end',
        reason: 'overflow',
        result: { summary: 's', firstKeptEntryId: 'e', tokensBefore: 1, usage: usage(9) },
        aborted: false,
        willRetry: false,
      });
    }
    const stream = meterStream((async () => ({ result: async () => message(usage(11)) })) as never, {
      agentId: agent.id,
      purpose: 'compaction',
    });
    await (await stream({} as never, {} as never, {} as never)).result();
    await new Promise(resolve => setImmediate(resolve));
    expect((await rows(db)).map(row => [row.purpose, row.input, row.cost, row.reasoning, row.cacheRead])).toEqual([
      ['other', 7, 0.5, 1, 2],
      ['compaction', 9, 0.5, 1, 2],
      ['compaction', 11, 0.5, 1, 2],
    ]);
  } finally {
    await db.close();
  }
});

it('never fails the caller when a write fails: the error is logged', async () => {
  const { db, agent } = await setup();
  const errors: unknown[] = [];
  usageRecorder.configure(db, { error: error => errors.push(error) });
  await db.client.$executeRawUnsafe('DROP TABLE "UsageEvent"');
  usageRecorder.record({
    at: new Date(),
    agentId: agent.id,
    provider: 'p',
    model: 'm',
    purpose: 'turn',
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0,
    sourceKey: null,
  });
  await expect(usageRecorder.flush()).resolves.toBeUndefined();
  expect(errors).toHaveLength(1);
  await db.close();
});
