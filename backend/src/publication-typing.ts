import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

/** Typing is publication intent, not plain model output; destinations contain IDs, never draft text. */
export function createPublicationTyping(agentId: string, emit: (event: object) => void) {
  const pending = new Map<string, string | undefined>();
  let previous = '';
  const publication = (name: string) => name === 'send_message' || name === 'send_dm';
  const update = () => {
    const targets = [...new Set([...pending.values()].filter((id): id is string => Boolean(id)))].sort();
    const event = { type: 'typing', active: targets.length > 0, targets };
    const key = JSON.stringify(event);
    if (key !== previous && (previous || event.active)) {
      previous = key;
      emit(event);
    }
  };
  const published = (id: string) => {
    pending.delete(id);
    update();
  };
  const clear = () => {
    pending.clear();
    update();
  };
  return {
    published,
    clear,
    onEvent(event: AgentSessionEvent) {
      if (event.type === 'message_update') {
        const updateEvent = event.assistantMessageEvent;
        if (!['toolcall_start', 'toolcall_delta', 'toolcall_end'].includes(updateEvent.type)) return;
        const tool =
          updateEvent.type === 'toolcall_end'
            ? updateEvent.toolCall
            : 'contentIndex' in updateEvent
              ? updateEvent.partial.content[updateEvent.contentIndex]
              : undefined;
        if (tool?.type !== 'toolCall' || !publication(tool.name)) return;
        const value = tool.name === 'send_dm' ? tool.arguments?.recipientId : tool.arguments?.channelId;
        const target =
          typeof tool.arguments?.text === 'string' &&
          tool.arguments.text.length > 0 &&
          typeof value === 'string' &&
          value.length > 0 &&
          value.length <= 220
            ? tool.name === 'send_dm'
              ? `dm:${[agentId, value].sort().join(':')}`
              : value
            : undefined;
        pending.set(tool.id, target);
        update();
      } else if (event.type === 'tool_execution_end' && publication(event.toolName)) published(event.toolCallId);
    },
  };
}
