import { useRef } from 'react';
import { MessageMarkdown } from '@/components/message-markdown';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/chat-types';

export function ConversationMessages({ messages, time, agentName }: {
  messages: ChatMessage[];
  time: string;
  agentName: string;
}) {
  // Stagger the history present on entry; newly appended messages enter immediately.
  const entranceCount = useRef(messages.length);
  // Long restored histories must not delay the visible latest messages by many seconds.
  const entranceStart = Math.max(0, entranceCount.current - 8);

  return (
    <div className="w-full px-4 py-5 sm:px-5">
      <p className="message-enter mb-5 origin-bottom text-center text-xs text-muted-foreground">{time}</p>
      <ol aria-label="Messages" aria-live="polite" aria-relevant="additions" className="space-y-2">
        {messages.map((message, index) => (
          <li key={message.id} className={cn('flex', message.author === 'user' && 'justify-end')}>
            <div data-message-id={message.id} style={{ animationDelay: `${index >= entranceStart && index < entranceCount.current ? (index - entranceStart + 1) * 75 : 0}ms` }} className={cn(
              'message-enter min-w-0 origin-top max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-5 [overflow-wrap:anywhere] sm:max-w-[75%]',
              message.author === 'user' ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.07]',
            )}>
              <span className="sr-only">{message.author === 'user' ? 'You' : agentName}: </span>
              <MessageMarkdown text={message.text} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
