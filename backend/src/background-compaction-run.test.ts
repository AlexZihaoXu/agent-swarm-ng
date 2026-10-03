import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { prepareDatabase } from './test-database';
import { EndpointStore } from './endpoint-store';
import { buildApp } from './app';

vi.setConfig({ testTimeout: 30_000 });

/** A mock model: replies through send_message; summarization requests (no tools) return a summary. */
let model: Server;
let modelUrl = '';
const turns: string[] = [];
let summaries = 0;
beforeAll(async () => {
  model = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const text = JSON.stringify(body.messages);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    if (!body.tools?.length && text.includes('<conversation>')) {
      summaries++;
      chunk({ role: 'assistant', content: 'BACKGROUND SUMMARY of the earlier requests.' }, 'stop');
      return void response.end('data: [DONE]\n\n');
    }
    turns.push(text);
    const answered = body.messages.at(-1)?.role === 'tool';
    const channel = /\[channel: ([^\]]+)\]/.exec(text)?.[1];
    if (!answered && channel) {
      chunk({
        tool_calls: [
          {
            index: 0,
            id: `call-${turns.length}`,
            type: 'function',
            function: {
              name: 'send_message',
              arguments: JSON.stringify({ channelId: channel, text: 'Done.', final: true }),
            },
          },
        ],
      });
      chunk({}, 'tool_calls');
    } else chunk({ role: 'assistant', content: '' }, 'stop');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  modelUrl = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
});
afterAll(async () => {
  await new Promise(resolve => model.close(resolve));
});

it('summarizes earlier context in the background during work and later turns start from the summary', async () => {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  const database = await prepareDatabase(join(root, 'platform.db'));
  const endpoints = new EndpointStore(join(root, 'endpoints.json'));
  await endpoints.save({ id: 'endpoint', name: 'Mock', baseUrl: modelUrl, apiKey: 'key' });
  const app = await buildApp({ requireLogin: false, database, endpointStore: endpoints, computerController: null });
  try {
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: { name: 'Aether', endpointId: 'endpoint', model: 'test-model', thinkingLevel: 'off' },
      })
    ).json();
    expect(agent.compaction).toEqual({ atPercent: 65, idleMinutes: 30, idlePercent: 50 });
    // A low threshold, so a few long requests reach it.
    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agent.id}`,
      payload: { compaction: { atPercent: 20 } },
    });
    expect(changed.json().compaction.atPercent).toBe(20);
    const ask = (label: string) =>
      app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: {
          agentId: agent.id,
          clientMessageId: crypto.randomUUID(),
          message: `${label} ${'context '.repeat(1800)}`,
        },
      });
    for (const label of ['REQUEST-ONE', 'REQUEST-TWO', 'REQUEST-THREE', 'REQUEST-FOUR']) await ask(label);
    await vi.waitFor(() => expect(summaries).toBeGreaterThanOrEqual(1));
    await ask('REQUEST-FIVE');
    const activity = (await app.inject(`/api/agents/${agent.id}/activity?limit=200`)).body;
    expect(activity).toContain('Background compaction started');
    expect(activity).toContain('Background compaction applied');
    // The latest model call starts from the summary: the first requests are no longer sent verbatim.
    const last = turns.at(-1)!;
    expect(last).toContain('BACKGROUND SUMMARY of the earlier requests.');
    expect(last).not.toContain('REQUEST-ONE');
    expect(last).toContain('REQUEST-FIVE');
  } finally {
    await app.close();
    await database.close();
  }
});
