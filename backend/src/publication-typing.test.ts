import { expect, it } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { createPublicationTyping } from './publication-typing';

it('tracks streamed send_dm arguments, destination changes, overlapping calls, and completion', () => {
  const events: object[] = [];
  const tracker = createPublicationTyping('a', event => events.push(event));
  const streamed = (id: string, name: string, args: object) => tracker.onEvent({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, partial: { content: [{ type: 'toolCall', id, name, arguments: args }] } } } as AgentSessionEvent);
  streamed('dm', 'send_dm', {});
  expect(events).toEqual([]);
  streamed('dm', 'send_dm', { recipientId: 'b' });
  expect(events).toEqual([]);
  streamed('dm', 'send_dm', { recipientId: 'b', text: 'Still generating' });
  expect(events.at(-1)).toEqual({ type: 'typing', active: true, targets: ['dm:a:b'] });
  streamed('reply', 'send_message', { channelId: 'dm:a:c', text: 'Reply' });
  expect(events.at(-1)).toEqual({ type: 'typing', active: true, targets: ['dm:a:b', 'dm:a:c'] });
  tracker.onEvent({ type: 'tool_execution_end', toolName: 'send_dm', toolCallId: 'dm' } as AgentSessionEvent);
  expect(events.at(-1)).toEqual({ type: 'typing', active: true, targets: ['dm:a:c'] });
  tracker.published('reply');
  expect(events.at(-1)).toEqual({ type: 'typing', active: false, targets: [] });
  streamed('search', 'web_search', {}); expect(events).toHaveLength(4);
  streamed('again', 'send_dm', { recipientId: 'b', text: 'Draft' }); tracker.clear();
  expect(events.at(-1)).toEqual({ type: 'typing', active: false, targets: [] });
});
