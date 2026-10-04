import type { ReactNode } from 'react';
import { m } from 'motion/react';
import { glide } from '@/lib/motion';
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
  selectionGroup,
  onPrefetch,
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
  /** Rows sharing a group share one highlight that glides to the selected row. */
  selectionGroup: string;
  /** Warm the conversation before a click (hover or keyboard focus). */
  onPrefetch?: () => void;
}) {
  return (
    // `layout="position"` lets a conversation that moves to the top slide there instead of jumping.
    <m.li layout="position" transition={glide}>
      <button
        type="button"
        {...data}
        aria-label={label}
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
        onPointerEnter={onPrefetch}
        onFocus={onPrefetch}
        className={cn(
          'relative isolate flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-[background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] motion-reduce:active:scale-100',
          !selected && 'hover:bg-foreground/5',
        )}
      >
        {selected && (
          <m.span
            aria-hidden="true"
            data-slot="row-selection"
            layoutId={`${selectionGroup}-selection`}
            transition={glide}
            className="ao-raised absolute inset-0 -z-10 rounded-lg bg-foreground/10"
          />
        )}
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
    </m.li>
  );
}
