import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { prepareDatabase } from './test-database';
import { EndpointStore } from './endpoint-store';
import { buildApp } from './app';

/** A mock model that records each request's system prompt and answers through send_message. */
let model: Server;
let modelUrl = '';
const systems: string[] = [];
beforeAll(async () => {
  model = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    systems.push(body.messages.find((message: { role: string }) => message.role === 'system')?.content ?? '');
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    const answered = body.messages.at(-1)?.role === 'tool';
    const channel = /\[channel: ([^\]]+)\]/.exec(JSON.stringify(body.messages))?.[1];
    if (!answered && channel) {
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call-1',
            type: 'function',
            function: { name: 'send_message', arguments: JSON.stringify({ channelId: channel, text: 'Ok.' }) },
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

it('puts the owner’s instructions for an agent last in its system prompt, from the next turn on', async () => {
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
    expect(agent.instructions).toBe('');
    const ask = () =>
      app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { agentId: agent.id, clientMessageId: crypto.randomUUID(), message: 'Hi' },
      });
    await ask();
    expect(systems.at(-1)).not.toContain("## Your owner's instructions for you");
    const text = '## Style\n- Answer in **British English**.\n- Keep replies under three sentences.';
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agent.id}`,
      payload: { instructions: text },
    });
    expect(saved.json().instructions).toBe(text);
    await ask();
    const system = systems.at(-1)!;
    expect(system).toContain("## Your owner's instructions for you");
    // After every platform section (the SDK adds its own working-directory line at the very end).
    expect(system).toContain(`${text}\n`);
    expect(system.indexOf("## Your owner's instructions for you")).toBeGreaterThan(system.indexOf('## Capabilities'));
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/agents/${agent.id}`,
          payload: { instructions: 'x'.repeat(20001) },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
    await database.close();
  }
}, 30_000);
