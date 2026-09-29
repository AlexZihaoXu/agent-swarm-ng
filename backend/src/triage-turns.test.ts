import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createChatSession } from './chat-runtime';
import { evaluateInterruption } from './interruption-triage';
import { evaluateReaction } from './reaction-triage';
import { createActivityRecorder } from './agent-activity';

type Step = 'raw' | 'invalid' | 'blank' | 'historical' | 'truncated' | 'valid' | 'error';
let server: Server, baseUrl: string;
let steps: Step[], requests: any[], traces: any[], cancel: (() => void) | undefined;
beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const step = requests.length > 12 ? 'valid' : (steps[requests.length - 1] ?? steps.at(-1)!);
    cancel?.();
    if (step === 'error') {
      response.writeHead(400).end('PRIVATE PROVIDER ERROR secret-token');
      return;
    }
    const name = body.tools[0].function.name;
    const action = name === 'triage_decision' ? 'interrupt' : 'engage';
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'triage', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    chunk({ role: 'assistant', content: 'PRIVATE FORK OUTPUT' });
    if (step !== 'raw')
      chunk({
        tool_calls: [
          {
            index: 0,
            id: `call-${requests.length}`,
            type: 'function',
            function: {
              name: step === 'historical' ? 'send_message' : name,
              arguments: JSON.stringify(
                step === 'invalid'
                  ? { action: 'bad', reason: '' }
                  : { action, reason: step === 'blank' ? ' ' : 'Changed requirement.' },
              ),
            },
          },
        ],
      });
    chunk({}, step === 'truncated' ? 'length' : step === 'raw' ? 'stop' : 'tool_calls');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function evaluate(kind: 'interruption' | 'reaction', sequence: Step[], abortFirst = false) {
  steps = sequence;
  requests = [];
  traces = [];
  const activity = createActivityRecorder('agent', 'channel', '', event => traces.push(event), 'test-run');
  const controller = new AbortController();
  cancel = abortFirst ? () => controller.abort() : undefined;
  const config = {
    name: 'Triage test',
    endpointId: 'mock',
    model: 'test-model',
    thinkingLevel: 'off' as const,
    baseUrl,
    channel: { id: 'channel', agentId: 'agent', kind: 'platform-chat' as const },
  };
  const history = [{ role: 'user' as const, text: 'Original task' }];
  const publish = vi.fn();
  const main = await createChatSession(config, history, publish);
  const before = structuredClone(main.messages);
  try {
    const result =
      kind === 'interruption'
        ? await evaluateInterruption(
            main,
            'channel',
            [{ role: 'user', text: 'Correction: change the task.' }],
            controller.signal,
            activity.branch('Interruption triage'),
          )
        : await evaluateReaction(
            config,
            history,
            'Human reacted with a question mark.',
            controller.signal,
            undefined,
            activity.branch('Reaction triage'),
          );
    expect(main.messages).toEqual(before);
    expect(publish).not.toHaveBeenCalled();
    expect(
      requests.every(
        body =>
          body.tools.length === 1 &&
          body.tools[0].function.name === (kind === 'interruption' ? 'triage_decision' : 'reaction_decision'),
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).not.toContain('secret-token');
    return result;
  } finally {
    cancel = undefined;
    main.dispose();
  }
}
for (const kind of ['interruption', 'reaction'] as const) {
  it(`${kind}: corrects prose, invalid arguments, forbidden tools and truncated output in the same private fork`, async () => {
    const result = await evaluate(kind, ['raw', 'invalid', 'blank', 'historical', 'truncated', 'valid']);
    expect(requests).toHaveLength(6);
    expect(JSON.stringify(traces)).toContain('PRIVATE FORK OUTPUT');
    expect(JSON.stringify(traces)).toContain('Model response details');
    expect(JSON.stringify(traces)).toContain('Provider request');
    expect(JSON.stringify(traces)).toContain('Provider HTTP response');
    expect(JSON.stringify(traces)).toContain('Triage correction');
    expect(result.action).toBe(kind === 'interruption' ? 'interrupt' : 'engage');
    const context = JSON.stringify(requests.at(-1).messages);
    expect(context).toContain('Triage correction');
    expect(context).toContain('Original task');
    expect(context).toContain('output token limit');
    expect(context).toContain('send_message');
    expect(requests[1].messages.at(-1).content[0].text).toContain('No valid decision');
  });
  it.each(['raw', 'invalid'] as const)(
    `${kind}: stops after exactly ten %s turns, including SDK tool-error continuations`,
    async step => {
      const result = await evaluate(kind, [step]);
      expect(requests).toHaveLength(10);
      expect(result.reason).toContain('10 turns');
      expect(result.action).toBe(kind === 'interruption' ? 'interrupt' : 'ignore');
    },
  );
  it(`${kind}: accepts a valid decision on the tenth turn`, async () => {
    const result = await evaluate(kind, [...Array<Step>(9).fill('raw'), 'valid']);
    expect(requests).toHaveLength(10);
    expect(result.reason).toBe('Changed requirement.');
  });
  it(`${kind}: does not retry provider failures or expose raw errors`, async () => {
    const result = await evaluate(kind, ['error']);
    expect(requests).toHaveLength(1);
    expect(result.reason).toContain('provider request failed');
    // A failed interruption triage interrupts the agent so the new messages are not missed.
    if (kind === 'interruption') expect(result.action).toBe('interrupt');
    expect(JSON.stringify(traces)).not.toContain('secret-token');
    expect(JSON.stringify(traces)).toContain('Model request error');
  });
  it(`${kind}: cancellation prevents another correction turn`, async () => {
    await evaluate(kind, ['raw'], true);
    expect(requests).toHaveLength(1);
  });
}
