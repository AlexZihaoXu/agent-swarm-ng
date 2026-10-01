import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { EndpointStore } from '../endpoint-store';
import { buildApp } from '../app';
import type { ComputerController } from '../computer-controller-client';
import { ScreenshotPool } from './image-pool';
it('runs claimed computer tools in a real Pi turn with image context, Knowledge guidance and durable references', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const computer = await db.client.computer.create({
    data: { name: 'Integration desk', state: 'running', requestKey: crypto.randomUUID() },
  });
  const agent = await db.createAgent({ name: 'Viewer', endpointId: 'mock', model: 'gpt-4o', thinkingLevel: 'off' });
  await db.client.computerAssignment.create({ data: { agentId: agent.id, computerId: computer.id } });
  await db.client.computerNotice.create({
    data: { agentId: agent.id, text: 'Swarm restarted and released your computer; take a fresh look.' },
  });
  let step = 0,
    receivedImages = false,
    prompt = '',
    executions = 0;
  const image = Buffer.from([255, 216, 12, 34, 56, 78, 255, 217]).toString('base64');
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    prompt ||= JSON.stringify(body.messages);
    receivedImages ||= JSON.stringify(body.messages).includes(`data:image/jpeg;base64,${image}`);
    const plan = [
      ['send_message', { channelId: agent.channels[0].id, text: 'On it', final: false }],
      ['list_computers', {}],
      ['use_computer', { computer: computer.id, write: true }],
      ['glance', { quality: 'low' }],
      ['run_actions', { actions: [{ name: 'mouse.left_click' }] }],
      ['use_computer', { computer: null }],
      ['send_message', { channelId: agent.channels[0].id, text: 'Done', final: true }],
    ] as const;
    const [name, args] = plan[step++] ?? plan.at(-1)!;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(
      `data: ${JSON.stringify({ id: 'chat', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}\n\n`,
    );
    response.end(
      `data: ${JSON.stringify({ id: 'chat', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoints = new EndpointStore(join(db.dataDirectory, `computer-endpoints-${crypto.randomUUID()}.json`));
  await endpoints.save({
    id: 'mock',
    name: 'Fixture',
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  });
  const app = await buildApp({
    database: db,
    endpointStore: endpoints,
    computerController: {
      runtime: {
        capture: async () => ({
          mimeType: 'image/jpeg',
          data: Buffer.from(image, 'base64'),
          width: 634,
          height: 356,
          bounds: [0, 0, 999, 999],
        }),
        execute: async () => {
          executions++;
          return { started: true, completed: 1, error: null };
        },
        cancel: async () => {},
      },
    } as unknown as ComputerController,
  });
  const pool = new ScreenshotPool(join(db.dataDirectory, 'computer-screenshots'));
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { agentId: agent.id, clientMessageId: crypto.randomUUID(), message: 'Use the assigned computer.' },
    });
    expect(response.statusCode).toBe(200);
    expect(step).toBe(7);
    expect(executions).toBe(1);
    expect(receivedImages).toBe(true);
    expect(prompt).toContain('practices/desktop');
    expect(prompt).toContain('Swarm restarted and released');
    expect(await db.client.computerNotice.count()).toBe(0);
    expect(await db.client.computerClaim.count()).toBe(0);
    const activity = await db.client.activity.findMany({ where: { agentId: agent.id } });
    expect(activity.some(entry => entry.label === 'glance — result')).toBe(true);
    expect(JSON.stringify(activity)).not.toContain(image);
    expect(JSON.stringify(await db.client.agentSessionEntry.findMany({ where: { agentId: agent.id } }))).not.toContain(
      image,
    );
    const messages = await db.client.message.findMany({ where: { role: 'assistant' }, orderBy: { sequence: 'asc' } });
    expect(messages.map(message => message.text)).toEqual(['On it', 'Done']);
  } finally {
    await pool.removeAgent(agent.id);
    await app.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 15000);
