import type { ReactNode } from 'react';
import { SlideUpFadeSwap } from '@/components/ui/slide-up-fade-swap';
import { renderMessagePreview } from '@/components/message-markdown';
import { cn } from '@/lib/utils';

/** One row of the Agents or Chat sidebar. The wording of `label` stays with each list, on purpose. */
export function ConversationRow({
  data,
  label,
  selected,
  onClick,
  avatar,
  name,
  time,
  preview,
  previewPrefix = '',
}: {
  data: Record<`data-${string}`, string>;
  label: string;
  selected: boolean;
  onClick: () => void;
  avatar: ReactNode;
  name: string;
  time: string;
  preview: string;
  previewPrefix?: string;
}) {
  return (
    <li>
      <button
        type="button"
        {...data}
        aria-label={label}
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          selected ? 'bg-foreground/10' : 'hover:bg-foreground/5',
        )}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            <SlideUpFadeSwap className="shrink-0 text-[11px] text-muted-foreground" text={time} />
          </span>
          <SlideUpFadeSwap
            renderText={renderMessagePreview}
            className="mt-0.5 block text-xs text-muted-foreground"
            prefix={previewPrefix}
            text={preview}
          />
        </span>
      </button>
    </li>
  );
}
