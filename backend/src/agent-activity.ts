import { randomUUID } from 'node:crypto';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from '@sinclair/typebox';

const kinds = ['system', 'user', 'assistant', 'thinking', 'tool_call', 'tool_result', 'reminder', 'channel', 'status', 'error'] as const;
export const ActivityEntrySchema = Type.Object({
  id: Type.String(), runId: Type.String(), channelId: Type.String(),
  kind: Type.Union(kinds.map(kind => Type.Literal(kind))),
  label: Type.String(), text: Type.String(), timestamp: Type.Number(),
});
type ActivityEntry = Static<typeof ActivityEntrySchema>;

/** Operator-only activity. Never converted into a channel publication or written to disk. */
export function createActivityRecorder(agentId: string, channelId: string, apiKey: string, emit: (event: object) => void) {
  const runId = randomUUID();
  let assistant = 0;
  const calls = new Map<string, string>();
  const redact = (text: string) => apiKey ? text.replaceAll(apiKey, '[redacted]') : text;
  const record = (kind: ActivityEntry['kind'], label: string, text: string, id: string = randomUUID(), append = false) => {
    emit({ type: 'activity', agentId, append, entry: { id: `${runId}:${id}`, runId, channelId, kind, label, text: redact(text), timestamp: Date.now() } });
  };
  const contentText = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n') : '';

  const onEvent = (event: AgentSessionEvent) => {
    if (event.type === 'message_start') {
      if (event.message.role === 'assistant') assistant++;
      else if (event.message.role === 'user') record('user', 'User message', contentText(event.message.content));
      else if (event.message.role === 'custom') record('reminder', 'System reminder', contentText(event.message.content));
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (!('contentIndex' in update)) return;
      const id = `assistant-${assistant}-${update.contentIndex}`;
      if (update.type === 'thinking_delta') record('thinking', 'Thinking', update.delta, id, true);
      else if (update.type === 'text_delta') record('assistant', 'Direct model output', update.delta, id, true);
      else if (update.type === 'thinking_end') record('thinking', 'Thinking', update.content, id);
      else if (update.type === 'text_end') record('assistant', 'Direct model output', update.content, id);
      else if (update.type === 'toolcall_start' || update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
        const tool = update.type === 'toolcall_end' ? update.toolCall : update.partial.content[update.contentIndex];
        if (tool?.type === 'toolCall') {
          calls.set(tool.id, id);
          record('tool_call', tool.name || 'Tool call', JSON.stringify(tool.arguments ?? {}, null, 2), id);
        }
      }
    } else if (event.type === 'tool_execution_start') {
      record('tool_call', event.toolName, JSON.stringify(event.args ?? {}, null, 2), calls.get(event.toolCallId) ?? event.toolCallId);
    } else if (event.type === 'tool_execution_end') {
      record('tool_result', `${event.toolName}${event.isError ? ' — failed' : ' — result'}`, contentText(event.result.content));
    } else if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.errorMessage) {
      record('error', 'Model request error', event.message.errorMessage);
    }
  };
  return { record, onEvent };
}
