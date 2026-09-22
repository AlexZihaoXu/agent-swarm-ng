import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { messageText } from './message-text';
import { DM_TEXT_LIMIT, type SwarmStore } from './swarm-store';

export type DmReceipt = { id: string; conversationId: string; status: string; duplicate: boolean };
export function createDmTools(store: SwarmStore, agentId: string,
  send: (recipientId: string, text: string, toolCallId: string) => Promise<DmReceipt>) {
  return [
    defineTool({
      name: 'list_dm_contacts', label: 'Allowed agent DMs',
      description: 'List agents you are currently allowed to DM in Swarm App. Enabled connections are mutual, including replies. Does not expose private human conversations.',
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_id, _args, signal) {
        signal?.throwIfAborted();
        const contacts = await store.contacts(agentId);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ contacts }) }], details: {} };
      },
    }),
    defineTool({
      name: 'read_dm_inbox', label: 'Received agent messages',
      description: 'Check messages actually received from other agents, including peers no longer enabled. An empty contact list does not mean your inbox is empty. Returns up to 20 chronological previews and a cursor for older entries. Expand a message using read_dm_messages with its senderId as peerId.',
      parameters: Type.Object({ before: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false }),
      async execute(_id, { before }, signal) {
        signal?.throwIfAborted();
        const page = await store.received(agentId, before);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ messages: page.messages.map(message => ({ id: message.id, senderId: message.senderId, author: message.sender.name, timestamp: message.createdAt.toISOString(), status: message.status, ...messageText(message.text) })), nextCursor: page.nextCursor }) }], details: {} };
      },
    }),
    defineTool({
      name: 'send_dm', label: 'Send agent DM',
      description: 'Publish a DM to an allowed agent. The backend validates current permission and schedules bounded work for the recipient. A receipt is not a reply or proof the task was completed. Do not retry blindly; inspect history after an uncertain result. Share only context needed for the requested task, never credentials or unrelated private conversation.',
      parameters: Type.Object({ recipientId: Type.String({ minLength: 1, maxLength: 100 }), text: Type.String({ minLength: 1, maxLength: DM_TEXT_LIMIT }) }, { additionalProperties: false }),
      async execute(id, { recipientId, text }, signal) {
        signal?.throwIfAborted();
        const receipt = await send(recipientId, text, id);
        return { content: [{ type: 'text' as const, text: JSON.stringify(receipt) }], details: {} };
      },
    }),
    defineTool({
      name: 'read_dm_messages', label: 'Read agent DMs',
      description: 'Read a bounded chronological section of your own DM conversation with one peer. Defaults to the latest 20, maximum 40 messages; exclusive before sequence cursor pages older messages. Previews are limited to 1,000 characters each and 20,000 total. Use peerId, messageId and offset to expand one message in chunks up to 6,000 characters. No human-channel history or other agents\' conversations are accessible.',
      parameters: Type.Object({ peerId: Type.String({ minLength: 1, maxLength: 100 }), messageId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 })), before: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })) }, { additionalProperties: false }),
      async execute(_id, { peerId, messageId, offset, before, limit }, signal) {
        signal?.throwIfAborted();
        if (offset !== undefined && !messageId || messageId && (before !== undefined || limit !== undefined)) throw new Error('Choose a message fragment or a history window, not both.');
        const page = messageId ? { messages: [await store.message(agentId, peerId, messageId)], nextCursor: null } : await store.history(agentId, peerId, before, limit);
        const budget = messageId ? 6000 : Math.min(1000, Math.floor(20000 / Math.max(1, page.messages.length)));
        const messages = page.messages.map(message => ({ id: message.id, sequence: message.sequence, senderId: message.senderId, author: message.sender.name, timestamp: message.createdAt.toISOString(), status: message.status, ...messageText(message.text, offset ?? 0, budget) }));
        return { content: [{ type: 'text' as const, text: JSON.stringify({ messages, nextCursor: page.nextCursor }) }], details: {} };
      },
    }),
  ];
}
