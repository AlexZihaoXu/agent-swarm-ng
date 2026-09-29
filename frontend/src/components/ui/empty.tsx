import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Kibo empty/standard-2 and empty/actions-1 composition (shadcn Empty), with the app's quick entrance.
export function Empty({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'view-enter flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-6 text-center text-balance md:p-12',
        className,
      )}
      {...props}
    />
  );
}

export function EmptyHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex max-w-sm flex-col items-center gap-2 text-center', className)} {...props} />;
}

export function EmptyMedia({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-icon"
      className={cn(
        'mb-2 flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-5',
        className,
      )}
      {...props}
    />
  );
}

export function EmptyTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-lg font-medium tracking-tight', className)} {...props} />;
}

export function EmptyDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm/relaxed text-muted-foreground', className)} {...props} />;
}

export function EmptyContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm', className)} {...props} />
  );
}
