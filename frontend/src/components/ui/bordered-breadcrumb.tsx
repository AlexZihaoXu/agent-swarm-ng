import { cn } from '@/lib/utils';

type Crumb = { id: string; text: string; onSelect?: () => void; current?: boolean };

/** Kibo breadcrumb-standard-4, shared with Settings → Swarm Knowledge. */
export function BorderedBreadcrumb({ label, items, disabled = false, className }: { label: string; items: Crumb[]; disabled?: boolean; className?: string }) {
  return <nav aria-label={label} className={cn('w-fit min-w-0 max-w-full rounded-lg border border-border px-3 py-2', className)}>
    <ol className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      {items.map((item, index) => <li key={item.id} className="flex min-w-0 items-center gap-2">
        {index > 0 && <span aria-hidden="true" className="shrink-0 text-muted-foreground">›</span>}
        {item.onSelect ? <button type="button" disabled={disabled} aria-current={item.current ? 'page' : undefined} onClick={item.onSelect} className={cn('min-w-0 rounded-sm text-left [overflow-wrap:anywhere] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', item.current ? 'text-foreground' : 'text-muted-foreground')}>{item.text}</button>
          : <span aria-current={item.current ? 'page' : undefined} className="min-w-0 [overflow-wrap:anywhere]">{item.text}</span>}
      </li>)}
    </ol>
  </nav>;
}
