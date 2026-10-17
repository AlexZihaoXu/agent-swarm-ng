import { GearIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

/**
 * Global settings (the person and the whole swarm, `/settings`) at the top right of the header, where Portal's button
 * sat; on a phone, at the right of the slim top bar. A link, so it can open in a new tab; current while on Settings,
 * when the gear turns a quarter (not with reduced motion).
 */
export function SettingsButton({
  active,
  onOpen,
  className,
}: {
  active: boolean;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <a
      href="/settings"
      aria-label="Settings"
      title="Settings"
      aria-current={active ? 'page' : undefined}
      onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen();
      }}
      className={cn(
        'group ao-raised flex size-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none aria-[current=page]:bg-background aria-[current=page]:text-foreground',
        className,
      )}
    >
      <GearIcon className="size-[18px] transition-transform duration-300 ease-out group-aria-[current=page]:rotate-90 motion-reduce:transition-none" />
    </a>
  );
}
