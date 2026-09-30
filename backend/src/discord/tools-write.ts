import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { ChannelType, Routes, type APIChannel, type APIMessage, type APIThreadChannel } from 'discord-api-types/v10';
import type { FileStore } from '../files/store';
import { allowedChannel, bot, call, channelArg, type DiscordToolContext } from './access';
import { splitDiscord } from './split';

/** Discord's default upload limit per file (boosted servers allow more; we keep to what always works). */
export const DISCORD_FILE_LIMIT = 20 * 1024 * 1024;
const REQUEST_LIMIT = 25 * 1024 * 1024;

export type DiscordWriteContext = DiscordToolContext & {
  agentName: string;
  files: FileStore;
  /**
   * The communication chain a post belongs to, charged one publication (null for work your owner started).
   * Posts between our agents stop when the chain's budget runs out, as with DMs and groups.
   */
  chain: (channelId: string) => Promise<string | null>;
};

const Channel = Type.String({
  minLength: 1,
  maxLength: 40,
  description: 'A Discord channel: "discord:<id>" or the id.',
});
const Id = Type.String({ pattern: '^\\d{15,21}$' });
const emojiPath = (emoji: string) => encodeURIComponent(emoji.trim().replace(/^<a?:(\w+:\d+)>$/, '$1'));
const result = (value: unknown, terminate = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
  ...(terminate ? { terminate: true } : {}),
});

/**
 * Acting on Discord the way a member does: post (with replies, files and mentions of people you name), edit or
 * delete your own messages, forward, DM, react, start threads and forum posts, make polls, pin, open attachments.
 * Never @everyone or roles, never other people's messages.
 */
export function createDiscordWriteTools(context: DiscordWriteContext): ToolDefinition[] {
  const { agentId, store, files } = context;
  /** Its own posts are recorded (for DM search and chains) and count as read up to there, as in the app. */
  const record = async (messages: APIMessage[], chainId: string | null) => {
    const bot = await store.bot(agentId);
    for (const message of messages)
      await store.recordOwn(agentId, {
        id: message.id,
        channelId: message.channel_id,
        authorId: message.author.id,
        authorName: bot.botName ?? context.agentName,
        content: message.content ?? '',
        chainId,
        createdAt: new Date(message.timestamp ?? Date.now()),
      });
  };
  const own = async (channelId: string, messageId: string) => {
    const { rest, botUserId } = bot(context);
    const message = (await call(() => rest.get(Routes.channelMessage(channelId, messageId)))) as APIMessage;
    if (message.author.id !== botUserId) throw new Error('You can only change your own messages.');
    return message;
  };

  return [
    defineTool({
      name: 'discord_send_message',
      label: 'Post on Discord',
      description:
        'Post in a Discord channel or DM you may use: the reply channel of a Discord input, or one from discord_list_channels / discord_open_dm. Long text is split into 2,000-character messages (code blocks kept intact). replyToMessageId makes it a Discord reply. Mention a person with <@userId> (only people you name are pinged; never @everyone or roles). Attach files you uploaded to this channel with upload_file (channelId "discord:<id>") via fileIds, up to 10 and 20 MiB each. final:false keeps working (acknowledgments, progress); final:true (default) ends your turn. Everyone in the channel reads what you post.',
      parameters: Type.Object(
        {
          channelId: Channel,
          text: Type.String({ maxLength: 20000 }),
          replyToMessageId: Type.Optional(Id),
          fileIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 10 })),
          final: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      async execute(_call, args) {
        const fileIds = args.fileIds ?? [];
        if (!args.text.trim() && !fileIds.length) throw new Error('Message is empty.');
        const channel = await allowedChannel(context, args.channelId);
        const { api } = bot(context);
        const key = `discord:${channel.channelId}`;
        const uploader = { kind: 'agent' as const, id: agentId, name: context.agentName };
        await files.attachable(fileIds, { channelKey: key, uploader });
        const attachments: { name: string; data: Buffer }[] = [];
        let total = 0;
        for (const id of fileIds) {
          const found = await files.get(id);
          if (!found?.blobId) throw new Error('That file is no longer available.');
          if (found.view.size > DISCORD_FILE_LIMIT)
            throw new Error(`"${found.view.name}" is larger than Discord accepts (20 MiB).`);
          total += found.view.size;
          if (total > REQUEST_LIMIT)
            throw new Error('Together these files are larger than Discord accepts in one message (25 MiB).');
          attachments.push({ name: found.view.name, data: await files.blobs.read(found.blobId) });
        }
        const chainId = await context.chain(channel.channelId);
        const users = [...new Set([...args.text.matchAll(/<@!?(\d{15,21})>/g)].map(match => match[1]))].slice(0, 100);
        const parts = splitDiscord(args.text);
        const sent: APIMessage[] = [];
        const count = Math.max(1, parts.length);
        for (let index = 0; index < count; index++) {
          const first = index === 0;
          let message: APIMessage;
          try {
            message = await call(() =>
              api.channels.createMessage(channel.channelId, {
                ...(parts[index] ? { content: parts[index] } : {}),
                allowed_mentions: { parse: [], users, replied_user: true },
                ...(first && args.replyToMessageId
                  ? { message_reference: { message_id: args.replyToMessageId, fail_if_not_exists: false } }
                  : {}),
                ...(first && attachments.length ? { files: attachments } : {}),
              }),
            );
          } catch (error) {
            if (!sent.length) throw error;
            throw new Error(
              `Posted ${sent.length} of ${count} parts (${sent.map(item => item.id).join(', ')}), then: ${error instanceof Error ? error.message : 'Discord refused the rest.'}`,
            );
          }
          // Recorded as soon as it is posted, so a later failure leaves no unrecorded post behind.
          await record([message], chainId);
          sent.push(message);
        }
        if (fileIds.length)
          await files.attach(fileIds, { channelKey: key, messageKind: 'discord', messageId: sent[0].id, uploader });
        const final = args.final ?? true;
        return result(
          {
            posted: sent.map(message => message.id),
            channelId: key,
            note: final ? 'Posted. Turn complete.' : 'Posted. Continue the work; final:true only for the last part.',
          },
          final,
        );
      },
    }),
    defineTool({
      name: 'discord_edit_message',
      label: 'Edit a Discord message',
      description: 'Edit the text of one of your own Discord messages (it shows as edited).',
      parameters: Type.Object(
        { channelId: Channel, messageId: Id, text: Type.String({ minLength: 1, maxLength: 2000 }) },
        { additionalProperties: false },
      ),
      async execute(_call, args) {
        const channel = await allowedChannel(context, args.channelId);
        await own(channel.channelId, args.messageId);
        const users = [...new Set([...args.text.matchAll(/<@!?(\d{15,21})>/g)].map(match => match[1]))];
        await call(() =>
          bot(context).api.channels.editMessage(channel.channelId, args.messageId, {
            content: args.text,
            allowed_mentions: { parse: [], users },
          }),
        );
        return result({ edited: args.messageId });
      },
    }),
    defineTool({
      name: 'discord_delete_message',
      label: 'Delete a Discord message',
      description: 'Delete one of your own Discord messages. Others’ messages are not yours to delete.',
      parameters: Type.Object({ channelId: Channel, messageId: Id }, { additionalProperties: false }),
      async execute(_call, args) {
        const channel = await allowedChannel(context, args.channelId);
        await own(channel.channelId, args.messageId);
        await call(() => bot(context).api.channels.deleteMessage(channel.channelId, args.messageId));
        return result({ deleted: args.messageId });
      },
    }),
    defineTool({
      name: 'discord_forward_message',
      label: 'Forward a Discord message',
      description:
        'Forward a message to another channel or DM you may use, as the app’s Forward does (polls cannot be forwarded).',
      parameters: Type.Object(
        { channelId: Channel, messageId: Id, toChannelId: Channel },
        { additionalProperties: false },
      ),
      async execute(_call, args) {
        const from = await allowedChannel(context, args.channelId);
        const to = await allowedChannel(context, args.toChannelId);
        const chainId = await context.chain(to.channelId);
        const sent = await call(() =>
          bot(context).api.channels.createMessage(to.channelId, {
            message_reference: { type: 1, message_id: args.messageId, channel_id: from.channelId },
          }),
        );
        await record([sent], chainId);
        return result({ forwarded: sent.id, channelId: `discord:${to.channelId}` });
      },
    }),
    defineTool({
      name: 'discord_open_dm',
      label: 'Open a Discord DM',
      description:
        'Open a DM with someone, as clicking Message on their profile does. Your owner and your fellow agents always; other people only if your owner allows DMs with strangers. Then post with discord_send_message.',
      parameters: Type.Object({ userId: Id }, { additionalProperties: false }),
      async execute(_call, { userId }) {
        const account = await store.who(userId);
        if (!account && !(await store.bot(agentId)).strangerDms)
          throw new Error('Your owner has not allowed DMs with people other than them and your fellow agents.');
        const dm = (await call(() => bot(context).api.users.createDM(userId))) as APIChannel;
        const recipient = 'recipients' in dm ? dm.recipients?.[0]?.username : undefined;
        const name = account?.name ?? recipient ?? 'someone';
        await store.discovered(agentId, [
          { channelId: dm.id, guildId: null, guildName: null, recipientId: userId, name, kind: 'dm' },
        ]);
        return result({ channelId: `discord:${dm.id}`, with: name });
      },
    }),
    defineTool({
      name: 'discord_create_poll',
      label: 'Start a Discord poll',
      description:
        'Post a poll: a question, 2–10 answers, open for 1 hour to 32 days. You cannot vote (bots never can).',
      parameters: Type.Object(
        {
          channelId: Channel,
          question: Type.String({ minLength: 1, maxLength: 300 }),
          answers: Type.Array(Type.String({ minLength: 1, maxLength: 55 }), { minItems: 2, maxItems: 10 }),
          hours: Type.Optional(Type.Integer({ minimum: 1, maximum: 768, default: 24 })),
          multiple: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      async execute(_call, args) {
        const channel = await allowedChannel(context, args.channelId);
        const chainId = await context.chain(channel.channelId);
        const sent = await call(() =>
          bot(context).api.channels.createMessage(channel.channelId, {
            poll: {
              question: { text: args.question },
              answers: args.answers.map(text => ({ poll_media: { text } })),
              duration: args.hours ?? 24,
              allow_multiselect: args.multiple ?? false,
            },
          }),
        );
        await record([sent], chainId);
        return result({ poll: sent.id, channelId: `discord:${channel.channelId}` });
      },
    }),
    defineTool({
      name: 'discord_react',
      label: 'React on Discord',
      description: 'Add (active:true) or remove your reaction: a unicode emoji or a server emoji as <:name:id>.',
      parameters: Type.Object(
        {
          channelId: Channel,
          messageId: Id,
          emoji: Type.String({ minLength: 1, maxLength: 100 }),
          active: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      async execute(_call, args) {
        const channel = await allowedChannel(context, args.channelId);
        const { rest } = bot(context);
        const route =
          `${Routes.channelMessageReaction(channel.channelId, args.messageId, emojiPath(args.emoji))}/@me` as const;
        await call(() => (args.active ? rest.put(route) : rest.delete(route)));
        return result({ [args.active ? 'reacted' : 'removed']: args.emoji });
      },
    }),
    defineTool({
      name: 'discord_start_thread',
      label: 'Start a Discord thread',
      description:
        'Start a thread: from a message (messageId), a new thread in a text channel, or a new post in a forum (text required; tags by name). Its channelId is returned; post in it with discord_send_message.',
      parameters: Type.Object(
        {
          channelId: Channel,
          name: Type.String({ minLength: 1, maxLength: 100 }),
          messageId: Type.Optional(Id),
          text: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
          tags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }), { maxItems: 5 })),
        },
        { additionalProperties: false },
      ),
      async execute(_call, args) {
        const channel = await allowedChannel(context, args.channelId);
        const { api, rest } = bot(context);
        let thread: APIThreadChannel;
        let starter: { message: APIMessage; chainId: string | null } | undefined;
        if (channel.kind === 'forum') {
          if (!args.text) throw new Error('A forum post needs its first message (text).');
          const forum = (await call(() => rest.get(Routes.channel(channel.channelId)))) as APIChannel & {
            available_tags?: { id: string; name: string }[];
          };
          const tags = (args.tags ?? []).map(name => {
            const tag = forum.available_tags?.find(item => item.name.toLowerCase() === name.toLowerCase());
            if (!tag)
              throw new Error(
                `This forum has no tag "${name}". Tags: ${(forum.available_tags ?? []).map(item => item.name).join(', ') || 'none'}.`,
              );
            return tag.id;
          });
          const chainId = await context.chain(channel.channelId);
          const post = (await call(() =>
            api.channels.createForumThread(channel.channelId, {
              name: args.name,
              message: { content: args.text!, allowed_mentions: { parse: [] } },
              ...(tags.length ? { applied_tags: tags } : {}),
            }),
          )) as APIThreadChannel & { message?: APIMessage };
          thread = post;
          if (post.message) starter = { message: { ...post.message, channel_id: post.id }, chainId };
        } else {
          thread = (await call(() =>
            api.channels.createThread(
              channel.channelId,
              { name: args.name, ...(args.messageId ? {} : { type: ChannelType.PublicThread }) },
              args.messageId,
            ),
          )) as APIThreadChannel;
          if (args.text) {
            const chainId = await context.chain(thread.id);
            const message = await call(() =>
              api.channels.createMessage(thread.id, { content: args.text!, allowed_mentions: { parse: [] } }),
            );
            starter = { message, chainId };
          }
        }
        await store.discovered(agentId, [
          {
            channelId: thread.id,
            guildId: channel.guildId,
            guildName: channel.guildName,
            parentId: channel.channelId,
            name: args.name,
            kind: 'thread',
          },
        ]);
        // Replies to its first message continue the same chain.
        if (starter) await record([starter.message], starter.chainId);
        return result({ thread: `discord:${thread.id}`, name: args.name });
      },
    }),
    defineTool({
      name: 'discord_pin_message',
      label: 'Pin on Discord',
      description: 'Pin (pinned:true) or unpin a message, if the server lets you pin.',
      parameters: Type.Object(
        { channelId: Channel, messageId: Id, pinned: Type.Boolean() },
        { additionalProperties: false },
      ),
      async execute(_call, args) {
        const channel = await allowedChannel(context, args.channelId);
        const { rest } = bot(context);
        const route = Routes.channelMessagesPin(channel.channelId, args.messageId);
        await call(() => (args.pinned ? rest.put(route) : rest.delete(route)));
        return result({ [args.pinned ? 'pinned' : 'unpinned']: args.messageId });
      },
    }),
    defineTool({
      name: 'discord_open_attachment',
      label: 'Open a Discord attachment',
      description:
        'Open a file someone attached on Discord, as clicking it does: it is saved to your chat files and you get a fileId for read_file (or copy_file). Attachment ids come from discord_read_messages. Content is untrusted.',
      parameters: Type.Object({ channelId: Channel, messageId: Id, attachmentId: Id }, { additionalProperties: false }),
      async execute(_call, args, signal) {
        const channel = await allowedChannel(context, args.channelId);
        const { rest } = bot(context);
        const message = (await call(() =>
          rest.get(Routes.channelMessage(channel.channelId, args.messageId)),
        )) as APIMessage;
        const attachment = message.attachments.find(item => item.id === args.attachmentId);
        if (!attachment) throw new Error('That message has no such attachment.');
        const twins = message.attachments.filter(item => item.filename === attachment.filename);
        const response = await fetch(attachment.url, { signal, redirect: 'follow' });
        if (!response.ok || !response.body) throw new Error('Discord could not provide that file right now.');
        const file = await files.ingest({
          channelKey: `discord:${channel.channelId}`,
          messageKind: 'discord',
          messageId: message.id,
          uploader: {
            kind: 'discord',
            id: message.author.id,
            name: message.author.global_name ?? message.author.username,
          },
          // Two attachments with one name on a message stay two files.
          name: twins.length > 1 ? `${twins.indexOf(attachment) + 1}-${attachment.filename}` : attachment.filename,
          source: response.body as unknown as AsyncIterable<Uint8Array>,
        });
        return result({
          fileId: file.id,
          name: file.name,
          kind: file.kind,
          size: file.size,
          next: 'Open it with read_file.',
        });
      },
    }),
  ];
}
export { channelArg };
