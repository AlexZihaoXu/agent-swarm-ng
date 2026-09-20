import { useRef } from 'react';
import { cn } from '@/lib/utils';
import type { PreviewMessage } from '@/preview-data';

export function ConversationMessages({ messages, time, agentName }: {
  messages: PreviewMessage[];
  time: string;
  agentName: string;
}) {
  // Stagger the history present on entry; newly appended messages enter immediately.
  const entranceCount = useRef(messages.length);

  return (
    <div className="w-full px-4 py-5 sm:px-5">
      <p className="message-enter mb-5 origin-bottom text-center text-xs text-muted-foreground">{time}</p>
      <ol aria-label="Messages" aria-live="polite" aria-relevant="additions" className="space-y-2">
        {messages.map((message, index) => (
          <li key={message.id} className={cn('flex', message.author === 'user' && 'justify-end')}>
            <p data-message-id={message.id} style={{ animationDelay: `${index < entranceCount.current ? (index + 1) * 75 : 0}ms` }} className={cn(
              'message-enter origin-top max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-5 [overflow-wrap:anywhere] sm:max-w-[75%]',
              message.author === 'user' ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.07]',
            )}>
              <span className="sr-only">{message.author === 'user' ? 'You' : agentName}: </span>
              {message.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
