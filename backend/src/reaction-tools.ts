import { defineTool } from '@earendil-works/pi-coding-agent';
import { classify, type AgentTool } from './tool-access';
import { Type } from '@earendil-works/pi-ai';
import { MAX_REACTION_LENGTH, type ReactionStore } from './reaction-store';
import { emojiLabel, searchEmoji } from './emoji-catalog';
import type { Channel } from './chat-runtime';

export function createReactionTools(
  store: ReactionStore,
  channel: Channel,
  canPublishHuman: () => boolean,
  changed: (channelId: string, messageId: string) => void,
) {
  const ids = {
    channelId: Type.String({ minLength: 1, maxLength: 120 }),
    messageId: Type.String({ minLength: 1, maxLength: 100 }),
  };
  const result = (reactions: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ reactions }) }],
    details: {},
  });
  return classify({ search_emojis: 'r', read_reactions: 'r', react_to_message: 'w' }, [
    defineTool({
      name: 'search_emojis',
      label: 'Search emojis',
      description:
        'Search the same supported emoji names and keywords as the human picker. Without a query, browse from the start. Returns your own four recent emoji choices, bounded results, total count and continuation offset. Search before reacting with an unfamiliar emoji; use returned emoji exactly.',
      parameters: Type.Object(
        {
          query: Type.Optional(Type.String({ maxLength: 80 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40 })),
        },
        { additionalProperties: false },
      ),
      async execute(_id, { query = '', offset = 0, limit = 20 }, signal) {
        signal?.throwIfAborted();
        const recent = (await store.recent(channel.agentId)).map(emoji => ({ emoji, label: emojiLabel(emoji) }));
        signal?.throwIfAborted();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ recent, ...searchEmoji(query, offset, limit) }) }],
          details: {},
        };
      },
    }),
    defineTool({
      name: 'read_reactions',
      label: 'Read message reactions',
      description:
        'Inspect emoji counts on one message in your own human chat or a current member group. Does not mark it read or trigger work. Agent-to-agent DM reactions are not supported.',
      parameters: Type.Object(ids, { additionalProperties: false }),
      async execute(_id, { channelId, messageId }, signal) {
        signal?.throwIfAborted();
        return result((await store.read(channelId, [messageId], channel.agentId))[messageId]);
      },
    }),
    defineTool({
      name: 'react_to_message',
      label: 'React to message',
      description:
        'Explicitly add or remove your own emoji reaction in your human chat or a current member group. Identity is backend-bound; membership is rechecked. Reactions do not wake other agents or substitute for a requested answer. Set active=true to add (idempotent), false to remove. Reacting in the private human chat requires a human-authored input in this batch.',
      parameters: Type.Object(
        { ...ids, emoji: Type.String({ minLength: 1, maxLength: MAX_REACTION_LENGTH }), active: Type.Boolean() },
        { additionalProperties: false },
      ),
      async execute(_id, { channelId, messageId, emoji, active }, signal) {
        signal?.throwIfAborted();
        if (channelId === channel.id && !canPublishHuman())
          throw new Error('Private human publication is not granted for this input.');
        const reactions = await store.set(channelId, messageId, emoji, active, channel.agentId);
        changed(channelId, messageId);
        const recent = (await store.recent(channel.agentId)).map(value => ({ emoji: value, label: emojiLabel(value) }));
        return { content: [{ type: 'text' as const, text: JSON.stringify({ reactions, recent }) }], details: {} };
      },
    }),
  ]);
}
