import { useRef } from 'react';
import { MessageMarkdown } from '@/components/message-markdown';
import { cn } from '@/lib/utils';
import { AgentDmNotice } from '@/components/agent-dm-notice';
import type { DmNotice } from '@/use-dm-inbox';
import type { AvatarAppearance } from '@/lib/agent-avatar';
import { agentBubbleStyle } from '@/lib/bubble-color';
import { conversationTimeline } from '@/lib/conversation-timeline';
import type { ChatMessage } from '@/chat-types';
import { MessageReactions, useMessageReactions, ReactionLoadError } from '@/components/message-reactions';
import { MessageReply } from '@/components/message-reply';

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

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-5">
      <p className="message-enter mb-5 origin-bottom text-center text-xs text-muted-foreground">{time}</p>
      <ReactionLoadError
        failed={Boolean(reactionChannel) && reactions.isError}
        retry={() => void reactions.refetch()}
      />
      <ol aria-label="Messages" aria-live="polite" aria-relevant="additions" className="space-y-2">
        {timeline.map((item, index) => {
          if (item.kind === 'dm')
            return (
              <li key={`dm:${item.notice.id}`} className="flex">
                <AgentDmNotice notice={item.notice} onOpen={() => onViewDm?.(item.notice)} />
              </li>
            );
          const message = item.message;
          const senderColor = senderStyles?.[message.author].color;
          const bubble = (
            <div
              data-message-id={message.id}
              tabIndex={reactionChannel && message.sequence !== undefined ? 0 : undefined}
              style={{
                animationDelay: `${index >= entranceStart && index < entranceCount.current ? (index - entranceStart + 1) * 30 : 0}ms`,
                '--enter-x': message.author === 'user' ? '14px' : '-14px',
                ...(senderColor ? agentBubbleStyle(senderColor) : {}),
              } as React.CSSProperties}
              className={cn(
                'message-enter message-context-target min-w-0 whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-5 [overflow-wrap:anywhere]',
                message.author === 'user'
                  ? 'origin-top-right bg-primary text-primary-foreground'
                  : 'origin-top-left bg-foreground/[0.07]',
                reactionChannel
                  ? 'max-w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                  : 'max-w-[85%] md:max-w-[75%]',
              )}
            >
              <span className={senderStyles ? 'mb-1 block text-[11px] font-medium opacity-80' : 'sr-only'}>
                {message.author === 'user' ? counterpartName : agentName}
                {senderStyles ? '' : ': '}
              </span>
              {message.replyTo && (
                <div className="mb-2">
                  <MessageReply
                    author={message.replyTo.role === 'user' ? counterpartName : agentName}
                    text={message.replyTo.text}
                  />
                </div>
              )}
              <MessageMarkdown text={message.text} />
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
            <li
              key={message.id}
              data-window-id={message.id}
              className={cn('relative flex', message.author === 'user' && 'justify-end')}
            >
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
            </li>
          );
        })}
      </ol>
    </div>
  );
}
