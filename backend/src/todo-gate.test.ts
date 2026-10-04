import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { buildApp } from './app';
import { EndpointStore } from './endpoint-store';
import { MODEL_RETRY } from './chat-runtime';
import { parseTodoDecision } from './todo-check';
import { parseTodos, Todos } from './todos';

type Body = { tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[]; model: string };
let server: Server;
let baseUrl: string;
let folder: string;
const requests: Body[] = [];
let checkAnswer = 'CONTINUE: Item 2 is not done: write the summary now, then mark both completed.';
/** The check first tries to change something (refused in the read-only fork). */
let checkTriesWrite = false;

MODEL_RETRY.maxRetries = 0;
vi.setConfig({ testTimeout: 30_000 });

/** A scripted model: writes two todos and replies; a todo check answers checkAnswer; then finishes the list. */
beforeAll(async () => {
  await mkdir('.scratch', { recursive: true });
  folder = await mkdtemp(join('.scratch', 'todo-gate-test-'));
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body: Body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const text = JSON.stringify(body.messages);
    const last = JSON.stringify(body.messages.at(-1));
    const system = body.messages.find(message => message.role === 'system')?.content;
    const channelId = String(system).match(/channel is ([\w-]+)\./)?.[1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    const call = (name: string, args: object) => {
      chunk({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `c${requests.length}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      });
      chunk({}, 'tool_calls');
    };
    const say = (content: string) => {
      chunk({ role: 'assistant', content });
      chunk({}, 'stop');
    };
    const tools = body.messages.filter(message => message.role === 'tool').length;
    if (text.includes('This is a temporary read-only copy of your own conversation')) {
      // Inside the check: optionally try a change first, then decide.
      if (checkTriesWrite && body.messages.at(-1)?.role !== 'tool') call('todo_write', { todos: [] });
      else say(checkAnswer);
    } else if (text.includes('continuation 1/3')) {
      // Continued by the check: finish the list, then end.
      if (last.includes('continuation 1/3'))
        call('todo_write', {
          todos: [
            { content: 'Draft the plan', status: 'completed' },
            { content: 'Write the summary', status: 'completed' },
          ],
        });
      else say('');
    } else if (tools === 0)
      call('todo_write', {
        todos: [
          { content: 'Draft the plan', status: 'completed' },
          { content: 'Write the summary', status: 'pending' },
        ],
      });
    else if (tools === 1) call('send_message', { channelId, text: 'Plan drafted.', final: true });
    else say('');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(folder, { recursive: true, force: true });
});

async function setup() {
  const store = new EndpointStore(join(folder, `${crypto.randomUUID()}.json`));
  await store.save({ id: 'endpoint', name: 'Mock', baseUrl, apiKey: 'test-key' });
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const app = await buildApp({ requireLogin: false, endpointStore: store, database });
  const agent = (
    await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'Todo test', endpointId: 'endpoint', model: 'test-model', thinkingLevel: 'off' },
    })
  ).json();
  const send = () =>
    app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { agentId: agent.id, clientMessageId: crypto.randomUUID(), message: 'Plan and summarize it.' },
    });
  return { app, database, agent, send };
}

it('parses the check decision and keeps a stored list tolerant', () => {
  expect(parseTodoDecision('CONTINUE: do X')).toEqual({ action: 'continue', note: 'do X' });
  expect(parseTodoDecision('  stop - blocked on CI ')).toEqual({ action: 'stop', note: 'blocked on CI' });
  expect(parseTodoDecision('maybe')).toBeUndefined();
  expect(parseTodos('not json')).toEqual([]);
  expect(parseTodos('[{"content":"a","status":"pending"},{"content":1},{"content":"b","status":"odd"}]')).toEqual([
    { content: 'a', status: 'pending' },
  ]);
});

it('validates lists: one item in progress, bounded text', async () => {
  const { app, database, agent } = await setup();
  try {
    const todos = new Todos(database);
    await expect(
      todos.set(agent.id, [
        { content: 'a', status: 'in_progress' },
        { content: 'b', status: 'in_progress' },
      ]),
    ).rejects.toThrow('one item in_progress');
    await expect(todos.set(agent.id, [{ content: '  ', status: 'pending' }])).rejects.toThrow('needs some text');
    expect(await todos.set(agent.id, [{ content: ' tidy   spaces ', status: 'pending' }])).toEqual([
      { content: 'tidy spaces', status: 'pending' },
    ]);
  } finally {
    await app.close();
  }
});

it('checks unfinished todos when the turn ends, continues with the note, and stops once all are done', async () => {
  requests.length = 0;
  checkAnswer = 'CONTINUE: Item 2 is not done: write the summary now, then mark both completed.';
  const { app, agent, send } = await setup();
  try {
    const response = await send();
    expect(response.statusCode).toBe(200);
    // The turn starts with a time note (default every 15 minutes), stacked into its input, not as a message.
    expect(JSON.stringify(requests[0]!.messages.at(-1))).toContain(
      '[Time note from the platform (not a message): it is now',
    );
    // The reply is out; the run goes on (the check, the continuation) until the list is complete.
    await vi.waitFor(async () => {
      const listed = (await app.inject({ method: 'GET', url: '/api/agents' })).json().agents[0];
      expect(listed.todos.every((todo: { status: string }) => todo.status === 'completed')).toBe(true);
    }, 20_000);
    await new Promise(resolve => setTimeout(resolve, 300));
    const checks = requests.filter(body =>
      JSON.stringify(body.messages.at(-1)).includes('This is a temporary read-only copy'),
    );
    // One check (2 unfinished → continue); after the list is complete there is nothing to check.
    expect(checks).toHaveLength(1);
    // The check is a fork of the conversation: same system prompt and tools as the main request.
    expect(checks[0]!.tools?.map(tool => tool.function.name)).toEqual(
      requests[0]!.tools?.map(tool => tool.function.name),
    );
    expect(JSON.stringify(requests.at(-1)!.messages)).toContain('Your own read-only review says: Item 2 is not done');
    const listed = (await app.inject({ method: 'GET', url: '/api/agents' })).json().agents[0];
    expect(listed.todos).toEqual([
      { content: 'Draft the plan', status: 'completed' },
      { content: 'Write the summary', status: 'completed' },
    ]);
    const activity = (await app.inject({ method: 'GET', url: `/api/agents/${agent.id}/activity` })).json();
    expect(JSON.stringify(activity)).toContain('Todo check: continue');
  } finally {
    await app.close();
  }
});

it('stops when the check says so, and does not check the same list again', async () => {
  requests.length = 0;
  checkAnswer = 'STOP: Waiting for the owner to approve the plan.';
  const { app, send } = await setup();
  try {
    await send();
    const checks = () =>
      requests.filter(body => JSON.stringify(body.messages.at(-1)).includes('This is a temporary read-only copy'));
    await vi.waitFor(() => expect(checks()).toHaveLength(1), 20_000);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(JSON.stringify(requests)).not.toContain('continuation 1/3');
    // A later turn with the list unchanged is not checked again.
    const before = requests.length;
    await send();
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(before + 1), 20_000);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(checks()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

it('refuses anything but read-only tools inside the check', async () => {
  requests.length = 0;
  checkAnswer = 'STOP: The owner must approve first.';
  checkTriesWrite = true;
  const { app, send } = await setup();
  try {
    await send();
    await vi.waitFor(() => expect(JSON.stringify(requests)).toContain('changes something and is refused here'), 20_000);
    await new Promise(resolve => setTimeout(resolve, 500));
    // The fork's todo_write never ran: the list is as the main branch left it.
    const listed = (await app.inject({ method: 'GET', url: '/api/agents' })).json().agents[0];
    expect(listed.todos).toHaveLength(2);
  } finally {
    checkTriesWrite = false;
    await app.close();
  }
});

it('accepts only time-note windows that divide the hour', async () => {
  const { app, agent } = await setup();
  try {
    const patch = (timeNoteMinutes: number) =>
      app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}`, payload: { timeNoteMinutes } });
    expect(agent.timeNoteMinutes).toBe(15);
    expect((await patch(7)).statusCode).toBe(400);
    expect((await patch(5)).json().timeNoteMinutes).toBe(5);
    expect((await patch(0)).json().timeNoteMinutes).toBe(0);
  } finally {
    await app.close();
  }
});
