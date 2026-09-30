import { cn } from '@/lib/utils';

/** An on/off switch (shadcn/Kibo Switch look): a button with role="switch", labelled by its id's <label>. */
export function Switch({
  id,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-foreground/20',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block size-5 rounded-full bg-background shadow transition-transform duration-150 motion-reduce:transition-none',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
