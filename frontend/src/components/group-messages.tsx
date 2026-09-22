import { Fragment } from 'react';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { MessageMarkdown } from '@/components/message-markdown';
import { defaultAvatar } from '@/lib/agent-avatar';
import { continuesGroup } from '@/lib/group-message-layout';
import { cn } from '@/lib/utils';
import { MessageReactions, useMessageReactions, ReactionLoadError } from '@/components/message-reactions';
import type { GroupChat, GroupMessage } from '@/use-groups';

const clock = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// Kibo scroll-area-layout-3, adapted to the requested adjacent-author blocks and time gutter.
export function GroupMessages({ messages, members }: { messages: GroupMessage[]; members: GroupChat['members'] }) {
  const channelId = messages.length ? `group:${messages[0].groupId}` : undefined;
  const reactions = useMessageReactions(channelId, messages.map(message => message.id));
  return <ol aria-label="Messages" aria-live="polite" aria-relevant="additions" className="py-3">
    {reactions.isError && <li><ReactionLoadError failed retry={() => void reactions.refetch()} /></li>}
    {messages.map((message, index) => {
      const previous = messages[index - 1];
      const continued = continuesGroup(previous, message);
      const human = message.role === 'user';
      const date = new Date(message.timestamp);
      const newDay = !previous || new Date(previous.timestamp).toDateString() !== date.toDateString();
      const avatar = members.find(member => member.id === message.authorId)?.avatar ?? message.authorAvatar ?? defaultAvatar(message.authorId ?? message.id);
      return <Fragment key={message.id}>
        {newDay && <li className="mx-5 my-4 flex items-center gap-3 text-[11px] text-muted-foreground"><span className="h-px flex-1 bg-border" /><time dateTime={date.toISOString()}>{date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</time><span className="h-px flex-1 bg-border" /></li>}
        <li tabIndex={0} data-message-id={message.id} data-grouped={continued || undefined} className={cn('group relative grid grid-cols-[3rem_minmax(0,1fr)] px-2 py-0.5 outline-none transition-colors hover:bg-foreground/[0.045] focus-within:bg-foreground/[0.045] sm:px-3', !continued && 'mt-3 pt-1.5')}>
          <div className="relative flex justify-center pt-0.5">
            {!continued && !human && <span className="group-hover:opacity-0 group-focus-within:opacity-0"><AgentAvatarArt {...avatar} size={32} /></span>}
            <time dateTime={date.toISOString()} title={date.toLocaleString()} className="absolute inset-x-0 top-1.5 text-center text-[10px] leading-5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">{clock(message.timestamp)}</time>
          </div>
          <div className={cn('min-w-0 pr-3', human && 'flex flex-col items-end')}>
            {!continued && <div className="mb-0.5 flex max-w-full items-baseline gap-2"><span className="truncate text-sm font-semibold">{human ? 'You' : message.authorName}</span><time dateTime={date.toISOString()} title={date.toLocaleString()} className="shrink-0 text-[11px] text-muted-foreground">{clock(message.timestamp)}</time></div>}
            {continued && <span className="sr-only">{human ? 'You' : message.authorName}: </span>}
            <div className={cn('min-w-0 whitespace-pre-wrap text-sm leading-5 [overflow-wrap:anywhere]', human ? 'max-w-[90%] rounded-2xl bg-primary px-3.5 py-2 text-primary-foreground sm:max-w-[75%]' : 'py-0.5')}><MessageMarkdown text={message.text} /></div>
            {channelId && <MessageReactions channelId={channelId} messageId={message.id} reactions={reactions.data?.[message.id]} />}
          </div>
        </li>
      </Fragment>;
    })}
  </ol>;
}
