import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import type { PlatformStore } from './platform-store';
import type { Channel } from './chat-runtime';
import { ChannelHistory } from './channel-history';
import { messageText } from './message-text';

type Row = Awaited<ReturnType<PlatformStore['appendMessage']>>;
function integer(value: number | undefined, fallback: number, min: number, max: number) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`Expected an integer from ${min} to ${max}.`);
  return result;
}
function timestamp(value?: string) {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Use an ISO timestamp with a timezone, such as 2026-09-21T12:00:00Z.');
  return new Date(value);
}
const position = (row: Row) => ({ id: row.id, sequence: row.sequence, timestamp: row.createdAt.toISOString() });
const range = (rows: Row[]) => rows.length ? { from: position(rows[0]), to: position(rows.at(-1)!) } : null;
const result = (data: object) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: data });

export function createChatHistoryTools(store: PlatformStore, channel: Channel, name: string): ToolDefinition[] {
  const history = new ChannelHistory(store, channel.id);
  const author = (row: Row) => ({ role: row.role, name: row.role === 'user' ? 'Human' : name });
  const view = (row: Row, offset = 0, length = 1000) => ({ ...position(row), author: author(row), ...messageText(row.text, offset, length) });
  const authorize = async (channelId?: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (channelId !== undefined && channelId !== channel.id) throw new Error('Only the current channel is granted.');
    await store.initialize();
    if (!await store.client.channel.findFirst({ where: { id: channel.id, agentId: channel.agentId, kind: channel.kind }, select: { id: true } })) throw new Error('Channel is not available.');
  };
  const channelParameter = Type.Optional(Type.String({ description: 'Defaults to the current channel. Other channels are not granted.' }));
  const cursor = Type.Optional(Type.Integer({ minimum: 1, description: 'Exclusive message sequence cursor returned by this tool.' }));
  return [
    defineTool({
      name: 'read_messages', label: 'Read chat section',
      description: 'Read a bounded section of the current chat, like scrolling a chat window. Defaults to the latest 20 messages, oldest first. Choose at most one anchor: at (ISO time/latest/now), messageId, before, or after. To expand a truncated message, pass its messageId and returned nextOffset as offset; this reads one chunk, not the surrounding section. Reading does not mark messages as read.',
      parameters: Type.Object({ channelId: channelParameter, at: Type.Optional(Type.String()), messageId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })), before: cursor, after: cursor,
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 40, default: 20 })), offset: Type.Optional(Type.Integer({ minimum: 0, description: 'With messageId only: retrieve up to 6000 characters starting at this returned offset.' })),
      }, { additionalProperties: false }),
      async execute(_id, args, signal) {
        const anchors = [args.at, args.messageId, args.before, args.after].filter(value => value !== undefined);
        if (anchors.length > 1 || (args.offset !== undefined && !args.messageId)) throw new Error('Choose one navigation anchor; offset requires messageId.');
        const limit = integer(args.limit, 20, 1, 40);
        if (args.before !== undefined) integer(args.before, 1, 1, Number.MAX_SAFE_INTEGER);
        if (args.after !== undefined) integer(args.after, 1, 1, Number.MAX_SAFE_INTEGER);
        const at = args.at === 'latest' || args.at === 'now' ? undefined : timestamp(args.at);
        await authorize(args.channelId, signal);
        if (args.offset !== undefined) {
          const row = await history.message(args.messageId!);
          const message = view(row, args.offset, 6000);
          const cursors = await history.cursors([row]); signal?.throwIfAborted();
          return result({ channelId: channel.id, mode: 'message', range: range([row]), messages: [message], cursors });
        }
        const page = await history.section({ at, messageId: args.messageId, before: args.before, after: args.after, limit });
        signal?.throwIfAborted();
        const length = Math.min(1000, Math.floor(20000 / Math.max(1, page.messages.length)));
        return result({ channelId: channel.id, mode: 'window', order: 'oldest-first', range: range(page.messages), messages: page.messages.map(row => view(row, 0, length)), cursors: page.cursors });
      },
    }),
    defineTool({
      name: 'search_messages', label: 'Search chat history',
      description: 'Search the current channel for a literal phrase (ASCII case-insensitive; other characters literal). Returns at most 20 bounded snippets, newest first. Open a hit in context using read_messages({messageId}). Use nextCursor as before for more matches. Does not search other channels or internal thinking/tool traces.',
      parameters: Type.Object({ channelId: channelParameter, query: Type.String({ minLength: 1, maxLength: 200 }), before: cursor,
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 10 })), author: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('assistant')])),
        since: Type.Optional(Type.String({ description: 'Inclusive ISO timestamp with timezone.' })), until: Type.Optional(Type.String({ description: 'Inclusive ISO timestamp with timezone.' })),
      }, { additionalProperties: false }),
      async execute(_id, args, signal) {
        if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200) throw new Error('Provide a nonempty search phrase of at most 200 characters.');
        const limit = integer(args.limit, 10, 1, 20);
        if (args.before !== undefined) integer(args.before, 1, 1, Number.MAX_SAFE_INTEGER);
        if (args.author !== undefined && !['user', 'assistant'].includes(args.author)) throw new Error('Invalid author filter.');
        const since = timestamp(args.since), until = timestamp(args.until);
        if (since && until && since > until) throw new Error('since must not be later than until.');
        await authorize(args.channelId, signal);
        const page = await history.search(args.query, { limit, before: args.before, author: args.author, since, until });
        signal?.throwIfAborted();
        const fold = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());
        const matches = page.messages.map(row => {
          const matchOffset = fold(row.text).indexOf(fold(args.query));
          let offset = Math.max(0, matchOffset - 80);
          if (row.text.charCodeAt(offset) >= 0xdc00 && row.text.charCodeAt(offset) <= 0xdfff && row.text.charCodeAt(offset - 1) >= 0xd800 && row.text.charCodeAt(offset - 1) <= 0xdbff) offset--;
          return { ...position(row), author: author(row), matchOffset, snippet: messageText(row.text, offset, 320) };
        });
        return result({ channelId: channel.id, query: args.query, order: 'newest-first', matches, nextCursor: page.nextCursor });
      },
    }),
  ];
}
