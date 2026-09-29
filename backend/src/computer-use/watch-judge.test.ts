import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Type } from '@sinclair/typebox';
import { resolveChatModel } from '../chat-runtime';
import { judgeWatch, parseVerdict, type AgentTool, type ForkBasis } from './watch-judge';

type Body = { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] };
let server: Server;
let baseUrl = '';
const requests: Body[] = [];
/** What the fake model says next: a tool call, or text. */
let script: ({ tool: string; args: object } | string)[] = [];

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const step = script.shift() ?? 'KEEP_WATCHING: nothing yet';
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 't', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    if (typeof step === 'string') {
      chunk({ role: 'assistant', content: step });
      chunk({}, 'stop');
    } else {
      chunk({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `call-${requests.length}`,
            type: 'function',
            function: { name: step.tool, arguments: JSON.stringify(step.args) },
          },
        ],
      });
      chunk({}, 'tool_calls');
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const model = () =>
  resolveChatModel({
    name: 'A',
    model: 'test-model',
    thinkingLevel: 'off',
    baseUrl,
    apiKey: 'key',
    channel: { id: 'chat-1', kind: 'platform-chat', agentId: 'a' },
  });
const tool = (name: string, run: () => string = () => 'ran'): AgentTool => ({
  name,
  label: name,
  description: `The ${name} tool.`,
  parameters: Type.Object({}),
  execute: async () => ({ content: [{ type: 'text', text: run() }], details: {} }),
});

it('reads a decision from the first word of plain text', () => {
  expect(parseVerdict('NOTIFY: tests failed')).toEqual({ notify: true, summary: 'tests failed' });
  expect(parseVerdict('**KEEP_WATCHING** - still running')).toEqual({ notify: false, summary: 'still running' });
  expect(parseVerdict('keep watching')).toMatchObject({ notify: false });
  expect(parseVerdict('I think it is done')).toBeUndefined();
});

it('a fresh check sees the condition and view, may look closer, and corrects a missing decision', async () => {
  requests.length = 0;
  let looked = 0;
  script = [{ tool: 'terminal_view', args: {} }, 'Hmm, not sure.', 'NOTIFY: the build printed "ready".'];
  const verdict = await judgeWatch({
    ...(await model()),
    channelId: 'chat-1',
    tools: [tool('terminal_view', () => `screen ${++looked}`)],
    text: 'Condition to watch for: the server is ready',
    images: [],
    signal: new AbortController().signal,
  });
  expect(verdict).toEqual({ notify: true, summary: 'the build printed "ready".' });
  expect(looked).toBe(1);
  expect(JSON.stringify(requests[0].messages)).toContain('You are a watcher');
  expect(JSON.stringify(requests[0].messages)).toContain('the server is ready');
  expect(requests[0].tools?.map(item => item.function.name)).toEqual(['terminal_view']);
  expect(JSON.stringify(requests[2].messages)).toContain('no decision was recorded');
});

it("a fork sends the main agent's exact system prompt and tools, and runs only the watcher's reads", async () => {
  requests.length = 0;
  let sent = 0;
  const basis: ForkBasis = {
    sessionId: 'main-session',
    systemPrompt: 'You are A. MAIN SYSTEM PROMPT.',
    tools: [tool('send_message', () => `sent ${++sent}`), tool('terminal_view', () => 'main view')],
    messages: [{ role: 'user', content: 'Earlier: start Claude and wait for it', timestamp: 1 }],
  };
  script = [{ tool: 'send_message', args: {} }, 'KEEP_WATCHING: Claude is still thinking'];
  const verdict = await judgeWatch({
    ...(await model()),
    channelId: 'chat-1',
    fork: basis,
    tools: [tool('terminal_view', () => 'watch view')],
    text: 'Condition to watch for: Claude finished',
    images: [],
    signal: new AbortController().signal,
  });
  expect(verdict).toEqual({ notify: false, summary: 'Claude is still thinking' });
  const [first, second] = requests;
  expect(first.messages[0]).toEqual({ role: 'system', content: basis.systemPrompt });
  expect(first.tools?.map(item => item.function.name)).toEqual(['send_message', 'terminal_view']);
  expect(JSON.stringify(first.messages)).toContain('Earlier: start Claude and wait for it');
  expect(JSON.stringify(first.messages)).toContain('temporary fork of your own conversation');
  expect(sent).toBe(0); // refused, never executed
  expect(JSON.stringify(second.messages)).toContain('only terminal_view can run here');
  expect(basis.messages).toHaveLength(1); // the main transcript is untouched
});

it('gives up after ten model turns', async () => {
  script = Array.from({ length: 12 }, () => ({ tool: 'terminal_view', args: {} }));
  await expect(
    judgeWatch({
      ...(await model()),
      channelId: 'chat-1',
      tools: [tool('terminal_view')],
      text: 'Condition: x',
      images: [],
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('No decision within 10 model turns');
});
