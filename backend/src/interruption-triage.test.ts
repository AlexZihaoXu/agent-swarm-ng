import { expect, it, vi } from 'vitest';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { createDecisionTool, forkContext } from './interruption-triage';
it('forks context without mutating main state or claiming pending tools succeeded', () => {
  const messages = [
    { role: 'user', content: 'Original task', timestamp: 1 },
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'pending-call', name: 'send_message', arguments: { text: 'draft' } }],
      timestamp: 2,
    },
  ];
  const main = {
    messages,
    agent: { state: { streamingMessage: { role: 'assistant', content: [{ type: 'text', text: 'Partial output' }] } } },
  } as unknown as AgentSession;
  const fork = forkContext(main);
  expect(fork).toHaveLength(4);
  expect(fork[2]).toMatchObject({ role: 'toolResult', toolCallId: 'pending-call', isError: true });
  expect(JSON.stringify(fork[2])).toContain('outcome unknown');
  expect(JSON.stringify(fork[3])).toContain('Partial output');
  (fork[0] as any).content = 'changed';
  expect(messages[0].content).toBe('Original task');
  expect(messages).toHaveLength(2);
});
it('gives no placeholder result to tool calls of aborted or errored turns, which the provider never sees', () => {
  // Regression: an aborted turn's call got a placeholder output, the provider rejected the orphan output (HTTP
  // 400: "No tool call found for function call output") and every later triage in the run failed.
  const messages = [
    { role: 'user', content: 'Original task', timestamp: 1 },
    {
      role: 'assistant',
      stopReason: 'aborted',
      content: [{ type: 'toolCall', id: 'abandoned', name: 'terminal_view', arguments: {} }],
      timestamp: 2,
    },
    {
      role: 'assistant',
      stopReason: 'error',
      content: [{ type: 'toolCall', id: 'failed', name: 'terminal_view', arguments: {} }],
      timestamp: 3,
    },
    {
      role: 'assistant',
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'running', name: 'terminal_view', arguments: {} }],
      timestamp: 4,
    },
  ];
  const main = { messages, agent: { state: {} } } as unknown as AgentSession;
  const results = forkContext(main).filter(message => message.role === 'toolResult');
  expect(results.map(message => (message as { toolCallId: string }).toolCallId)).toEqual(['running']);
});
it('records only bounded structured decisions and terminates the fork', async () => {
  const decide = vi.fn();
  const tool = createDecisionTool(decide);
  const result = await tool.execute(
    'decision',
    { action: 'queue', reason: 'Unrelated follow-up' },
    undefined,
    undefined,
    undefined as never,
  );
  expect(result.terminate).toBe(true);
  expect(decide).toHaveBeenCalledWith({ action: 'queue', reason: 'Unrelated follow-up' });
  await expect(
    tool.execute('invalid', { action: 'interrupt', reason: 'x'.repeat(501) }, undefined, undefined, undefined as never),
  ).rejects.toThrow('Invalid triage decision');
});
