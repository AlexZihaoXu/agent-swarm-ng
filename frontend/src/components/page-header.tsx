import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The header every top-level page shares: same height, gutters, title scale and rule, so moving between
 * Agents, Computers and Settings never changes where the title sits. `width` matches the page's content column.
 */
export function PageHeader({
  title,
  description,
  leading,
  action,
  width = 'max-w-none',
  sticky = false,
  actionShrinks = false,
}: {
  title: string;
  description?: ReactNode;
  leading?: ReactNode;
  action?: ReactNode;
  width?: string;
  /** Keeps the header in view when the page itself is the scroll container. */
  sticky?: boolean;
  /** The action may narrow (and scroll inside itself) when the header is tight, like a row of section links. */
  actionShrinks?: boolean;
}) {
  return (
    <header className={cn('shrink-0 border-b border-border', sticky && 'sticky top-0 z-10 bg-background')}>
      <div
        className={cn(
          'mx-auto flex min-h-14 w-full items-center gap-3 px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] md:px-6 md:py-3',
          width,
        )}
      >
        {leading}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
        {action && <div className={actionShrinks ? 'min-w-0' : 'shrink-0'}>{action}</div>}
      </div>
    </header>
  );
}
