import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createChatSession } from './chat-runtime';
import { BackgroundCompactor, type CompactionState } from './background-compaction';

/** A mock model: summaries wait until released; ordinary turns answer at once and are recorded. */
let server: Server;
let baseUrl = '';
let release: () => void = () => {};
let held = Promise.resolve();
const requests: string[] = [];
const hold = () => {
  held = new Promise<void>(resolve => {
    release = resolve;
  });
};
beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const text = JSON.stringify(body.messages);
    const summarizing = !body.tools?.length && text.includes('<conversation>');
    if (summarizing) await held;
    else requests.push(text);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content: summarizing ? 'SUMMARY of the early work.' : 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function session() {
  const manager = SessionManager.inMemory();
  const live = await createChatSession(
    {
      name: 'A',
      model: 'test',
      thinkingLevel: 'off',
      baseUrl,
      channel: { id: 'chat-1', agentId: 'agent-1', kind: 'platform-chat' },
    },
    [],
    () => {},
    [],
    undefined,
    manager,
  );
  live.settingsManager.applyOverrides({ compaction: { enabled: true, reserveTokens: 2048, keepRecentTokens: 400 } });
  return live;
}
const say = (live: Awaited<ReturnType<typeof session>>, label: string) =>
  live.prompt(`${label}: ${'details '.repeat(200)}`, { expandPromptTemplates: false });

it('summarizes a snapshot while the agent keeps working, then splices it keeping later messages verbatim', async () => {
  const states: (CompactionState | null)[] = [];
  const compactor = new BackgroundCompactor({ state: (_agent, state) => states.push(state) });
  const live = await session();
  try {
    for (const label of ['EARLY-A', 'EARLY-B', 'EARLY-C']) await say(live, label);
    hold();
    expect(compactor.start('agent-1', live)).toBe(true);
    expect(compactor.running('agent-1')).toBe(true);
    expect(compactor.start('agent-1', live)).toBe(false); // one summary at a time
    // Not blocked: the agent keeps working while the summary is written.
    await say(live, 'DURING-D');
    expect(compactor.splice('agent-1', live)).toBeNull(); // nothing ready yet
    release();
    await compactor.settled('agent-1');
    expect(compactor.splice('agent-1', live)).toBe('spliced');
    requests.length = 0;
    await say(live, 'AFTER-E');
    const next = requests.at(-1)!;
    expect(next).toContain('SUMMARY of the early work.');
    expect(next).not.toContain('EARLY-A');
    expect(next).toContain('DURING-D'); // what happened meanwhile stays verbatim
    expect(states).toEqual(['running', null]);
  } finally {
    live.dispose();
  }
}, 20_000);

it('discards a summary that no longer fits, and lets a nearly full agent sleep until it is ready', async () => {
  const states: (CompactionState | null)[] = [];
  const compactor = new BackgroundCompactor({ state: (_agent, state) => states.push(state) });
  const live = await session();
  const other = await session();
  try {
    for (const label of ['EARLY-A', 'EARLY-B', 'EARLY-C']) await say(live, label);
    await say(other, 'SOMETHING-ELSE');
    hold();
    expect(compactor.start('agent-1', live)).toBe(true);
    let woke = false;
    const sleeping = compactor.sleep('agent-1', new AbortController().signal).then(() => {
      woke = true;
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(woke).toBe(false);
    expect(states.at(-1)).toBe('sleeping');
    release();
    await sleeping;
    expect(states).toEqual(['running', 'sleeping', null]);
    // A session that never contained the snapshot cannot take this summary.
    expect(compactor.splice('agent-1', other)).toBe('stale');
    expect(compactor.running('agent-1')).toBe(false);
  } finally {
    live.dispose();
    other.dispose();
  }
}, 20_000);
