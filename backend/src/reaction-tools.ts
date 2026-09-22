import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { REACTION_EMOJIS, type ReactionStore } from './reaction-store';
import type { Channel } from './chat-runtime';

export function createReactionTools(store: ReactionStore, channel: Channel, canPublishHuman: () => boolean, changed: (channelId: string, messageId: string) => void) {
  const ids = { channelId: Type.String({ minLength: 1, maxLength: 120 }), messageId: Type.String({ minLength: 1, maxLength: 100 }) };
  const result = (reactions: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ reactions }) }], details: {} });
  return [
    defineTool({ name: 'read_reactions', label: 'Read message reactions', description: 'Inspect emoji counts on one message in your own human chat or a current member group. Does not mark it read or trigger work. Agent-to-agent DM reactions are not supported.', parameters: Type.Object(ids, { additionalProperties: false }),
      async execute(_id, { channelId, messageId }, signal) { signal?.throwIfAborted(); return result((await store.read(channelId, [messageId], channel.agentId))[messageId]); },
    }),
    defineTool({ name: 'react_to_message', label: 'React to message', description: 'Explicitly add or remove your own emoji reaction in your human chat or a current member group. Identity is backend-bound; membership is rechecked. Reactions do not wake other agents or substitute for a requested answer. Set active=true to add (idempotent), false to remove. Reacting in the private human chat requires a human-authored input in this batch.',
      parameters: Type.Object({ ...ids, emoji: Type.Union(REACTION_EMOJIS.map(value => Type.Literal(value))), active: Type.Boolean() }, { additionalProperties: false }),
      async execute(_id, { channelId, messageId, emoji, active }, signal) {
        signal?.throwIfAborted();
        if (channelId === channel.id && !canPublishHuman()) throw new Error('Private human publication is not granted for this input.');
        const reactions = await store.set(channelId, messageId, emoji, active, channel.agentId);
        changed(channelId, messageId); return result(reactions);
      },
    }),
  ];
}
