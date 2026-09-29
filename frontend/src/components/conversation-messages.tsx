import { useRef } from 'react';
import { MessageMarkdown } from '@/components/message-markdown';
import { cn } from '@/lib/utils';
import { MESSAGE_TIME_GAP, messageTime } from '@/lib/format-time';
import { AgentDmNotice } from '@/components/agent-dm-notice';
import type { DmNotice } from '@/use-dm-inbox';
import type { AvatarAppearance } from '@/lib/agent-avatar';
import { agentBubbleStyle } from '@/lib/bubble-color';
import { conversationTimeline } from '@/lib/conversation-timeline';
import type { ChatMessage } from '@/chat-types';
import { MessageReactions, useMessageReactions, ReactionLoadError } from '@/components/message-reactions';
import { MessageReply } from '@/components/message-reply';
import { MessageFiles } from '@/components/message-files';

export function ConversationMessages({
  messages,
  time,
  agentName,
  notices = [],
  onViewDm,
  counterpartName = 'You',
  senderStyles,
  reactionChannel,
  onReply,
}: {
  messages: ChatMessage[];
  time: string;
  agentName: string;
  notices?: DmNotice[];
  onViewDm?: (notice: DmNotice) => void;
  counterpartName?: string;
  reactionChannel?: string;
  senderStyles?: { agent: AvatarAppearance; user: AvatarAppearance };
  onReply?: (message: ChatMessage) => void;
}) {
  // Stagger the history present on entry; newly appended messages enter immediately.
  const reactions = useMessageReactions(
    reactionChannel,
    messages.filter(message => message.sequence !== undefined).map(message => message.id),
  );
  const entranceCount = useRef(messages.length);
  // Long restored histories must not delay the visible latest messages: at most 8 steps of 30ms, so the
  // newest bubble (where the reader looks) lands within about half a second.
  const entranceStart = Math.max(0, entranceCount.current - 8);

  const timeline = conversationTimeline(messages, notices);
  // A time label opens the conversation and every stretch that starts more than five minutes after the one before;
  // messages closer together share the label above them. Unsent messages (no time yet) never start a stretch.
  let previous = 0;
  const labels = timeline.map((item, index) => {
    if (!item.timestamp) return index === 0 ? time : null;
    const opens = !previous || item.timestamp - previous > MESSAGE_TIME_GAP;
    previous = item.timestamp;
    return opens ? messageTime(item.timestamp) : null;
  });
  const label = (index: number) =>
    labels[index] && (
      <p
        data-slot="message-time"
        className="message-enter mb-3 mt-3 origin-bottom text-center text-xs text-muted-foreground first:mt-0"
      >
        {labels[index]}
      </p>
    );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-5">
      <ReactionLoadError
        failed={Boolean(reactionChannel) && reactions.isError}
        retry={() => void reactions.refetch()}
      />
      <ol aria-label="Messages" aria-live="polite" aria-relevant="additions" className="space-y-2">
        {timeline.map((item, index) => {
          if (item.kind === 'dm')
            return (
              <li key={`dm:${item.notice.id}`}>
                {label(index)}
                <div className="flex">
                  <AgentDmNotice notice={item.notice} onOpen={() => onViewDm?.(item.notice)} />
                </div>
              </li>
            );
          const message = item.message;
          const senderColor = senderStyles?.[message.author].color;
          const user = message.author === 'user';
          const hasFiles = Boolean(message.files?.length);
          // Files sit below the text bubble as their own blocks; a message of only files has no text bubble.
          const hasText = Boolean(message.text.trim() || message.replyTo);
          const sender = (
            <span className={senderStyles && hasText ? 'mb-1 block text-[11px] font-medium opacity-80' : 'sr-only'}>
              {user ? counterpartName : agentName}
              {senderStyles && hasText ? '' : ': '}
            </span>
          );
          const textClass = cn(
            'min-w-0 max-w-full whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-5 [overflow-wrap:anywhere]',
            user ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.07]',
          );
          const textBody = (
            <>
              {sender}
              {message.replyTo && (
                <div className="mb-2">
                  <MessageReply
                    author={message.replyTo.role === 'user' ? counterpartName : agentName}
                    text={message.replyTo.text}
                  />
                </div>
              )}
              {message.text.trim() && <MessageMarkdown text={message.text} />}
            </>
          );
          // The message element: the text bubble itself, or (with files) a column of the bubble and file blocks.
          const outer = {
            'data-message-id': message.id,
            tabIndex: reactionChannel && message.sequence !== undefined ? 0 : undefined,
            className: cn(
              'message-enter message-context-target min-w-0',
              user ? 'origin-top-right' : 'origin-top-left',
              reactionChannel
                ? 'max-w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                : 'max-w-[85%] md:max-w-[75%]',
            ),
            style: {
              animationDelay: `${index >= entranceStart && index < entranceCount.current ? (index - entranceStart + 1) * 30 : 0}ms`,
              '--enter-x': user ? '14px' : '-14px',
            } as React.CSSProperties,
          };
          const colour = senderColor ? agentBubbleStyle(senderColor) : undefined;
          const bubble = hasFiles ? (
            <div
              {...outer}
              className={cn(
                outer.className,
                'flex w-full flex-col gap-1.5 rounded-2xl',
                user ? 'items-end' : 'items-start',
              )}
            >
              {hasText ? (
                <div className={textClass} style={colour}>
                  {textBody}
                </div>
              ) : (
                sender
              )}
              <MessageFiles files={message.files!} align={user ? 'end' : 'start'} />
            </div>
          ) : (
            <div {...outer} className={cn(outer.className, textClass)} style={{ ...outer.style, ...colour }}>
              {textBody}
            </div>
          );
          const content =
            reactionChannel && message.sequence !== undefined ? (
              <MessageReactions
                channelId={reactionChannel}
                messageId={message.id}
                reactions={reactions.data?.[message.id]}
                onReply={onReply ? () => onReply(message) : undefined}
              >
                {bubble}
              </MessageReactions>
            ) : (
              bubble
            );
          return (
            <li key={message.id} data-window-id={message.id} className="relative">
              {label(index)}
              <div className={cn('flex', message.author === 'user' && 'justify-end')}>
                {reactionChannel ? (
                  <div
                    className={cn(
                      'min-w-0 max-w-[85%] md:max-w-[75%]',
                      message.author === 'user' && 'flex flex-col items-end',
                    )}
                  >
                    {content}
                  </div>
                ) : (
                  content
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
