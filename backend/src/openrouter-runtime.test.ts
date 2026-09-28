import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession } from './chat-runtime';
import { OPENROUTER_URL } from './openrouter';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const config = {
  name: 'Router',
  model: 'openai/gpt-5.4',
  thinkingLevel: 'low' as const,
  baseUrl: OPENROUTER_URL,
  apiKey: '!literal-$NOT_ENV',
  channel: { id: 'channel', agentId: 'agent', kind: 'platform-chat' as const },
};
function stream(api: 'chat' | 'messages', args: object) {
  if (api === 'chat') {
    const deltas = [
      {
        role: 'assistant',
        content: 'PRIVATE',
        tool_calls: [
          {
            index: 0,
            id: 'call-1',
            type: 'function',
            function: { name: 'send_message', arguments: JSON.stringify(args) },
          },
        ],
      },
      {},
    ];
    return new Response(
      deltas
        .map(
          (delta, i) =>
            `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: config.model, choices: [{ index: 0, delta, finish_reason: i ? 'tool_calls' : null }] })}\n\n`,
        )
        .join('') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  }
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'anthropic/claude-sonnet-4.6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call-1', name: 'send_message', input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
it.each(['chat', 'messages'] as const)(
  'uses native OpenRouter %s protocol, literal endpoint key, explicit tools, and channel publication',
  async api => {
    vi.stubEnv('OPENROUTER_API_KEY', 'developer-secret');
    const requests: { url: string; init: any; body: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        requests.push({ url: String(input), init, body: JSON.parse(init.body) });
        return stream(api, { channelId: 'channel', text: 'Delivered', final: true });
      }),
    );
    const publish = vi.fn();
    const session = await createChatSession(
      { ...config, model: api === 'chat' ? config.model : 'anthropic/claude-sonnet-4.6' },
      [],
      publish,
    );
    try {
      expect(session.model).toMatchObject({ provider: 'openrouter', input: ['text', 'image'], maxTokens: 4096 });
      expect(session.agent.state.tools.map(tool => tool.name)).toEqual(['send_message']);
      await session.prompt('Hello', { expandPromptTemplates: false });
      expect((session.messages.at(-1) as any)?.errorMessage).toBeUndefined();
      expect(publish).toHaveBeenCalledWith('Delivered', expect.any(String), true, undefined);
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request.url).toBe(OPENROUTER_URL + (api === 'chat' ? '/chat/completions' : '/messages?beta=true'));
      expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer !literal-$NOT_ENV');
      expect(request.init.redirect).toBe('error');
      expect(JSON.stringify(request)).not.toContain('developer-secret');
      if (api === 'chat') expect(request.body.reasoning).toMatchObject({ effort: 'low' });
      else expect(request.body.thinking).toBeDefined();
    } finally {
      session.dispose();
    }
  },
);
it('does not fall back to developer keys or Codex when an OpenRouter key is absent', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'developer-secret');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(createChatSession({ ...config, apiKey: undefined }, [], () => {})).rejects.toThrow('OpenRouter API key');
  expect(fetcher).not.toHaveBeenCalled();
});
