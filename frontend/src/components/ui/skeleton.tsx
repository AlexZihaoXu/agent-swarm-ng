import { cn } from '@/lib/utils';

/** A placeholder in the shape of the content that is on its way; a soft sheen shows it is loading. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div aria-hidden="true" data-slot="skeleton" className={cn('skeleton rounded-md', className)} {...props} />;
}

/** Chat history on its way: alternating bubbles of plausible widths, settled at the bottom like a real chat. */
export function ChatSkeleton({ label = 'Loading messages…' }: { label?: string }) {
  const bubbles = [
    ['start', 'w-[62%] h-14'],
    ['end', 'w-[38%] h-9'],
    ['start', 'w-[70%] h-20'],
    ['end', 'w-[46%] h-9'],
    ['start', 'w-[54%] h-9'],
  ] as const;
  return (
    <div role="status" aria-label={label} className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 py-5 sm:px-5">
      <Skeleton className="mx-auto mb-3 h-3 w-24" />
      {bubbles.map(([side, size], index) => (
        <Skeleton
          key={index}
          className={cn('rounded-2xl', size, side === 'end' && 'self-end')}
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </div>
  );
}

/** A short run of bubble placeholders at the edge of a chat window while more history arrives or is revealed. */
export function EdgeSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-4 py-3 sm:px-5">
      <Skeleton className="h-10 w-[55%] rounded-2xl" />
      <Skeleton className="h-9 w-[35%] self-end rounded-2xl" style={{ animationDelay: '120ms' }} />
    </div>
  );
}
