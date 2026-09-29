import { clockTime } from '@/lib/format-time';
import { Fragment } from 'react';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { MessageMarkdown } from '@/components/message-markdown';
import { defaultAvatar } from '@/lib/agent-avatar';
import { continuesGroup } from '@/lib/group-message-layout';
import { cn } from '@/lib/utils';
import { MessageReactions, useMessageReactions, ReactionLoadError } from '@/components/message-reactions';
import { MessageReply } from '@/components/message-reply';
import { MessageFiles } from '@/components/message-files';
import type { GroupChat, GroupMessage } from '@/use-groups';

const clock = clockTime;
// Kibo scroll-area-layout-3, adapted to the requested adjacent-author blocks and time gutter.
export function GroupMessages({
  messages,
  members,
  onReply,
}: {
  messages: GroupMessage[];
  members: GroupChat['members'];
  onReply?: (message: GroupMessage) => void;
}) {
  const channelId = messages.length ? `group:${messages[0].groupId}` : undefined;
  const reactions = useMessageReactions(
    channelId,
    messages.map(message => message.id),
  );
  return (
    <ol aria-label="Messages" aria-live="polite" aria-relevant="additions" className="mx-auto max-w-4xl py-3">
      {reactions.isError && (
        <li>
          <ReactionLoadError failed retry={() => void reactions.refetch()} />
        </li>
      )}
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const continued = continuesGroup(previous, message);
        const human = message.role === 'user';
        const bare = !message.text.trim() && !message.replyTo && Boolean(message.files?.length);
        const date = new Date(message.timestamp);
        const newDay = !previous || new Date(previous.timestamp).toDateString() !== date.toDateString();
        const avatar =
          members.find(member => member.id === message.authorId)?.avatar ??
          message.authorAvatar ??
          defaultAvatar(message.authorId ?? message.id);
        const content = (
          <div
            tabIndex={channelId ? 0 : undefined}
            className={cn(
              'message-context-target w-fit max-w-full min-w-0 rounded-md whitespace-pre-wrap text-sm leading-5 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              bare
                ? 'max-w-[90%] md:max-w-[75%]'
                : human
                  ? 'max-w-[90%] rounded-2xl bg-primary px-3.5 py-2 text-primary-foreground md:max-w-[75%]'
                  : 'max-w-[90%] rounded-2xl bg-foreground/[0.07] px-3.5 py-2 md:max-w-full md:rounded-md md:bg-transparent md:px-0 md:py-0.5',
            )}
          >
            {message.replyTo && (
              <div className="mb-1">
                <MessageReply
                  author={message.replyTo.role === 'user' ? 'You' : message.replyTo.authorName}
                  text={message.replyTo.text}
                />
              </div>
            )}
            {message.text.trim() && <MessageMarkdown text={message.text} />}
            {message.files?.length ? (
              <div className={cn(!bare && 'mt-2')}>
                <MessageFiles files={message.files} align={human ? 'end' : 'start'} />
              </div>
            ) : null}
            <time
              dateTime={date.toISOString()}
              title={date.toLocaleString()}
              className="mt-1 block text-right text-[10px] leading-none opacity-60 md:hidden"
            >
              {clock(message.timestamp)}
            </time>
          </div>
        );
        return (
          <Fragment key={message.id}>
            {newDay && (
              <li className="mx-5 my-4 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <time dateTime={date.toISOString()}>
                  {date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </time>
                <span className="h-px flex-1 bg-border" />
              </li>
            )}
            <li
              data-message-id={message.id}
              data-window-id={message.id}
              data-grouped={continued || undefined}
              className={cn(
                'group relative grid grid-cols-[2.25rem_minmax(0,1fr)] px-2 py-0.5 md:grid-cols-[3rem_minmax(0,1fr)] md:px-3',
                !continued && 'mt-3 pt-1.5',
              )}
            >
              <div className="relative flex justify-center pt-0.5">
                {!continued && !human && (
                  <span className="md:group-hover:opacity-0 md:group-focus-within:opacity-0">
                    <AgentAvatarArt {...avatar} size={32} />
                  </span>
                )}
                <time
                  dateTime={date.toISOString()}
                  title={date.toLocaleString()}
                  className="absolute inset-x-0 top-1.5 hidden text-center text-[10px] leading-5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 md:block"
                >
                  {clock(message.timestamp)}
                </time>
              </div>
              <div className={cn('min-w-0 pr-3', human && 'flex flex-col items-end')}>
                {!continued && (
                  <div className={cn('mb-0.5 flex max-w-full items-baseline gap-2', human && 'max-md:hidden')}>
                    <span className="truncate text-sm font-semibold">{human ? 'You' : message.authorName}</span>
                    <time
                      dateTime={date.toISOString()}
                      title={date.toLocaleString()}
                      className="hidden shrink-0 text-[11px] text-muted-foreground md:inline"
                    >
                      {clock(message.timestamp)}
                    </time>
                  </div>
                )}
                {continued && <span className="sr-only">{human ? 'You' : message.authorName}: </span>}
                {channelId ? (
                  <MessageReactions
                    channelId={channelId}
                    messageId={message.id}
                    reactions={reactions.data?.[message.id]}
                    onReply={onReply ? () => onReply(message) : undefined}
                  >
                    {content}
                  </MessageReactions>
                ) : (
                  content
                )}
              </div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
