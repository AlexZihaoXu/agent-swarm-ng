import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { GroupMessages, type ShownMessage } from '@/components/group-messages';
import type { AvatarAppearance } from '@/lib/agent-avatar';

type Page =
  paths['/api/agents/{id}/discord/channels/{channelId}/messages']['get']['responses'][200]['content']['application/json'];
type Message = Page['messages'][number];
type Config = paths['/api/agents/{id}/discord']['get']['responses'][200]['content']['application/json'];
/** `label` for the "Chat with" list; `short` for its button (the header says where). */
export type DiscordPlace = { id: string; label: string; short: string; place: string; kind: string };

/**
 * The Discord places an agent's bot uses (allowed channels, threads under them, DMs), for Chat's "Chat with". Shares
 * the agent settings' query, so saving settings updates it.
 */
export function useDiscordPlaces(agentId: string, enabled: boolean): DiscordPlace[] {
  const query = useQuery({
    queryKey: ['agent-discord', agentId],
    enabled,
    // New DMs and threads appear as the bot finds them.
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/agents/{id}/discord', { params: { path: { id: agentId } }, signal });
      if (!data) throw new Error(error?.message ?? 'Could not load the Discord settings.');
      return data;
    },
  });
  const channels: Config['channels'] = query.data?.channels ?? [];
  const allowed = new Set(channels.filter(channel => channel.allowed).map(channel => channel.id));
  return channels
    .filter(
      channel =>
        channel.kind === 'dm' ||
        allowed.has(channel.id) ||
        (channel.kind === 'thread' && channel.parentId && allowed.has(channel.parentId)),
    )
    .map(channel => ({
      id: channel.id,
      kind: channel.kind,
      label:
        channel.kind === 'dm'
          ? `Discord DM ${channel.name}`
          : channel.kind === 'thread'
            ? `Discord › ${channel.name}`
            : `Discord #${channel.name}`,
      short: channel.kind === 'dm' ? `@${channel.name}` : channel.kind === 'thread' ? channel.name : `#${channel.name}`,
      place:
        channel.kind === 'dm'
          ? `DM with ${channel.name}`
          : `${channel.guildName ?? 'Server'} › ${channel.kind === 'thread' ? channel.name : `#${channel.name}`}`,
    }));
}

/** A Discord place in "Chat with": # for channels and threads, @ for DMs. */
export function DiscordPlaceIcon({ kind }: { kind: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-semibold text-muted-foreground"
    >
      {kind === 'dm' ? '@' : '#'}
    </span>
  );
}

/** While open, the newest messages are fetched this often (the bot keeps seeing new ones). */
const REFRESH_MS = 10_000;

const size = (bytes: number) =>
  bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const merge = (a: Message[], b: Message[]) =>
  [...new Map([...a, ...b].map(message => [message.id, message])).values()].sort(
    (x, y) => x.timestamp - y.timestamp || (BigInt(x.id) < BigInt(y.id) ? -1 : 1),
  );

/**
 * Chat → agent → a Discord channel: what the agent's bot saw there, read-only (people post on Discord; the agent
 * posts through its bot). The owner's accounts show as "You"; the agent's own bot as the agent.
 */
export function DiscordTranscript({
  agentId,
  channelId,
  agentName,
  agentAvatar,
  avatarOf,
  viewport,
}: {
  agentId: string;
  channelId: string;
  agentName: string;
  agentAvatar: AvatarAppearance;
  /** Another of our agents' avatar, for messages from its bot. */
  avatarOf: (agentId: string) => AvatarAppearance | null | undefined;
  viewport: RefObject<HTMLDivElement | null>;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  // "ready" after the first page; "older" while Load earlier runs (refreshes stay quiet).
  const [ready, setReady] = useState(false),
    [older, setOlder] = useState(false),
    [error, setError] = useState('');
  const shownIds = useRef(new Set<string>());
  const loaded = useRef(false);
  const position = useRef<{ height: number; older: boolean; bottom: boolean } | null>(null);
  async function load(before?: string, signal?: AbortSignal) {
    if (before) setOlder(true);
    try {
      const { data, error } = await api.GET('/api/agents/{id}/discord/channels/{channelId}/messages', {
        params: { path: { id: agentId, channelId }, query: before ? { before } : {} },
        signal,
      });
      if (signal?.aborted) return;
      if (!data || error) throw new Error(error?.message ?? 'Could not load this Discord channel.');
      const element = viewport.current;
      if (element)
        position.current = {
          height: element.scrollHeight,
          older: Boolean(before),
          bottom: !shownIds.current.size || element.scrollHeight - element.scrollTop - element.clientHeight < 80,
        };
      // More arrived between refreshes than one page holds: start again from the newest rather than leave a gap.
      const gap =
        !before &&
        shownIds.current.size > 0 &&
        data.nextCursor !== null &&
        !data.messages.some(message => shownIds.current.has(message.id));
      const next = before || !gap ? merge(messagesRef.current, data.messages) : data.messages;
      messagesRef.current = next;
      shownIds.current = new Set(next.map(message => message.id));
      setMessages(next);
      if (before || gap || !loaded.current) setCursor(data.nextCursor);
      loaded.current = true;
      setReady(true);
      setError('');
    } catch (failure) {
      if (!signal?.aborted)
        setError(failure instanceof Error ? failure.message : 'Could not load this Discord channel.');
    } finally {
      if (before && !signal?.aborted) setOlder(false);
    }
  }
  const messagesRef = useRef<Message[]>([]);
  const unmounted = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller;
    void load(undefined, controller.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(undefined, controller.signal);
    }, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [agentId, channelId]);
  useLayoutEffect(() => {
    const element = viewport.current,
      previous = position.current;
    if (!element || !previous) return;
    if (previous.older) element.scrollTop += element.scrollHeight - previous.height;
    else if (previous.bottom) element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    position.current = null;
  }, [messages]);

  const shown: ShownMessage[] = messages.map(message => {
    const own = message.role === 'you';
    const unopened = message.attachments.filter(file => !message.files?.some(opened => opened.name === file.name));
    return {
      id: message.id,
      groupId: `discord:${channelId}`,
      role: message.role === 'owner' ? 'user' : 'assistant',
      authorId: message.authorId,
      authorName: own
        ? agentName
        : message.role === 'bot'
          ? `${message.authorName} · bot`
          : message.role === 'agent'
            ? `${message.authorName} · agent`
            : message.authorName,
      authorAvatar: own ? agentAvatar : message.agentId ? (avatarOf(message.agentId) ?? null) : null,
      text: message.text,
      timestamp: message.timestamp,
      files: message.files,
      replyTo: message.replyTo ? { role: message.replyTo.owner ? 'user' : 'assistant', ...message.replyTo } : null,
      note:
        [
          message.deleted ? 'deleted' : message.edited ? 'edited' : '',
          unopened.length ? `attached ${unopened.map(file => `${file.name} (${size(file.size)})`).join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    };
  });
  return (
    <section aria-label="Discord messages">
      {(cursor !== null || (error && !messages.length)) && (
        <div className="px-5 pt-3 text-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={older}
            onClick={() =>
              void load(error && !messages.length ? undefined : (cursor ?? undefined), unmounted.current?.signal)
            }
          >
            {error && !messages.length ? 'Retry' : 'Load earlier messages'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="px-5 py-2 text-center text-sm">
          {error}
        </p>
      )}
      {!messages.length && !error && (
        <p role="status" className="px-5 py-8 text-center text-sm text-muted-foreground">
          {ready ? `${agentName}’s bot has not seen any messages here yet.` : 'Loading messages…'}
        </p>
      )}
      {shown.length > 0 && <GroupMessages messages={shown} members={[]} reactions={false} />}
    </section>
  );
}
