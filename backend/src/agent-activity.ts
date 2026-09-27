import { randomUUID } from 'node:crypto';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from '@sinclair/typebox';
import { activityTextPreview, type ActivityStore, type ActivitySnapshot } from './activity-store';

const kinds = ['system', 'user', 'assistant', 'thinking', 'tool_call', 'tool_result', 'reminder', 'channel', 'status', 'error'] as const;
export const ActivityEntrySchema = Type.Object({
  id: Type.String(), runId: Type.String(), channelId: Type.String(),
  kind: Type.Union(kinds.map(kind => Type.Literal(kind))),
  label: Type.String(), text: Type.String(), timestamp: Type.Number(),
  sequence: Type.Optional(Type.Integer()), revision: Type.Optional(Type.Integer()),
  offset: Type.Optional(Type.Integer({ description: 'UTF-8 byte offset. Continue using nextOffset, not JavaScript string length.' })), totalLength: Type.Optional(Type.Integer({ description: 'Complete text length in UTF-8 bytes; the durable archive is not truncated.' })),
  nextOffset: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
});
export type ActivityEntry = Static<typeof ActivityEntrySchema>;

/** Operator-only traces: coalesced durable checkpoints, never chat or private Pi context. */
export function createActivityRecorder(agentId: string, channelId: string, apiKey: string, emit: (event: object) => void, runId: string = randomUUID(), store?: ActivityStore, onFailure: () => void = () => {}) {
  let assistant = 0;
  const calls = new Map<string, string>();
  const entries = new Map<string, ActivitySnapshot>();
  const pending = new Map<string, ActivitySnapshot>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  let failure: unknown;
  const redact = (text: string) => apiKey ? text.replaceAll(apiKey, '[redacted]') : text;
  const flush = async () => {
    clearTimeout(timer); timer = undefined;
    const batch = [...pending.values()]; pending.clear();
    writes = writes.then(async () => {
      if (failure) return;
      for (const entry of batch) {
        const saved = await store!.save(agentId, { ...entry, text: redact(entry.text) });
        emit({ type: 'activity', agentId, append: false, entry: saved });
      }
    }).catch(error => { failure = error; onFailure(); });
    await writes;
    if (failure) throw new Error('Operator activity could not be saved.');
  };
  const record = (kind: ActivityEntry['kind'], label: string, text: string, id: string = randomUUID(), append = false, state?: string) => {
    const previous = entries.get(id);
    const entry: ActivitySnapshot = { id: `${runId}:${id}`, runId, channelId, kind, label: redact(label),
      text: append ? (previous?.text ?? '') + text : text, timestamp: previous?.timestamp ?? Date.now(), revision: (previous?.revision ?? 0) + 1, state };
    entries.set(id, entry);
    if (store) {
      pending.set(id, entry);
      timer ??= setTimeout(() => { void flush().catch(() => {}); }, 100);
    } else {
      emit({ type: 'activity', agentId, append: false, entry: { ...entry, ...activityTextPreview(redact(entry.text)) } });
    }
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
  return { record, onEvent, flush,
    async start() { record('status', 'Run active', 'Agent run started. Streaming entries may be unfinished.', 'run-status', false, 'active'); await flush(); },
    async finish(stopped = false) { record('status', stopped ? 'Run stopped' : 'Run ended', stopped ? 'Run stopped; committed effects remain. Partial activity may be unfinished.' : 'Run ended. See turn status and errors for its outcome.', 'run-status', false, stopped ? 'stopped' : 'ended'); await flush(); },
  };
}
