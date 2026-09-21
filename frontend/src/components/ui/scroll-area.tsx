import type { CSSProperties, ReactNode, Ref, UIEventHandler } from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';

// Follows Kibo's scroll-area/layout/scroll-area-layout-3 composition.
export function ScrollArea({ children, className, style, viewportRef, onScroll, label }: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  viewportRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  label: string;
}) {
  return (
    <ScrollAreaPrimitive.Root type="scroll" scrollHideDelay={700} style={style} className={cn('relative overflow-hidden', className)}>
      <ScrollAreaPrimitive.Viewport ref={viewportRef} onScroll={onScroll} role="region" aria-label={label} tabIndex={0} className="size-full outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" data-slot="scroll-area-scrollbar" style={{ right: 4 }} className="flex w-2.5 touch-none select-none p-0.5 cursor-pointer motion-safe:data-[state=visible]:animate-[fade-in_120ms_ease-out] motion-safe:data-[state=hidden]:animate-[fade-out_200ms_ease-in]">
        <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" className="relative min-h-8 flex-1 cursor-grab rounded-full bg-[#555555] transition-colors hover:bg-[#707070] active:cursor-grabbing" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}
