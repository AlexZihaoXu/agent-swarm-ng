import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';

/** Lists longer than this get a search field. */
const SEARCH_AFTER = 7;

// Adapted from Kibo combobox/standard/combobox-standard-1 (Popover + Command). The trigger's width comes from its
// container only (`contain: inline-size`), so a longer or shorter choice never resizes it; the label truncates.
export function Select({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  triggerClassName = '',
  contentClassName = '',
  triggerContent,
  ariaLabel,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; icon?: ReactNode }[];
  placeholder?: string;
  disabled?: boolean;
  /** Accepted for form semantics; the owning form's submit button enforces a choice. */
  required?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  triggerContent?: ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find(option => option.value === value);
  const searchable = options.length > SEARCH_AFTER;
  // Focus on every open, including a reopen during the closing animation (which keeps the old content mounted).
  // The portal mounts its content a render later, hence the frame.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      // Phones would raise the keyboard for a field nobody asked to type into.
      const touch = matchMedia('(pointer: coarse)').matches;
      (searchable && !touch ? input.current : root.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, searchable]);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        data-placeholder={selected ? undefined : ''}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex h-11 min-h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-sidebar px-3 text-left text-sm outline-none [contain:inline-size] data-[placeholder]:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted enabled:data-[state=open]:bg-muted transition-colors duration-120 motion-reduce:transition-none sm:h-10 sm:min-h-0 ${triggerClassName}`}
      >
        {triggerContent ?? (
          <>
            {selected ? <OptionLabel option={selected} truncate /> : <span className="truncate">{placeholder}</span>}
            <Chevron />
          </>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          data-slot="combobox-content"
          onOpenAutoFocus={event => event.preventDefault()}
          className={`z-[60] flex flex-col ${options.some(option => option.icon) ? 'min-w-48' : ''} max-h-[min(18rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-sidebar text-foreground shadow-lg origin-[var(--radix-popover-content-transform-origin)] motion-safe:data-[state=open]:animate-[dialog-in_120ms_ease-out] motion-safe:data-[state=closed]:animate-[dialog-out_100ms_ease-in] ${contentClassName}`}
        >
          <Command
            ref={root}
            defaultValue={value}
            label="Search options"
            filter={(_, search, keywords) => (keywords?.join(' ').toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
            className="flex min-h-0 flex-col outline-none"
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-border px-3">
                <SearchIcon />
                <Command.Input
                  ref={input}
                  placeholder="Search…"
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            )}
            <Command.List label={ariaLabel ?? 'Options'} className="min-h-0 overflow-y-auto overscroll-contain p-1">
              <Command.Empty className="px-3 py-2 text-sm text-muted-foreground">No matches</Command.Empty>
              {options.map(option => (
                <Command.Item
                  key={option.value}
                  value={option.value}
                  keywords={[option.label]}
                  onSelect={() => {
                    setOpen(false);
                    if (option.value !== value) onValueChange(option.value);
                  }}
                  className="relative flex min-h-11 cursor-pointer items-center rounded-md py-2 pl-3 pr-8 text-sm outline-none select-none sm:min-h-0 hover:bg-muted data-[selected=true]:bg-muted transition-colors duration-120 motion-reduce:transition-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40"
                >
                  <OptionLabel option={option} />
                  {option.value === value && (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="absolute right-2 size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    >
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  )}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function OptionLabel({
  option,
  truncate = false,
}: {
  option: { label: string; icon?: ReactNode };
  truncate?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {option.icon && (
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
          {option.icon}
        </span>
      )}
      <span data-option-label className={`min-w-0 ${truncate ? 'truncate' : 'break-words [overflow-wrap:anywhere]'}`}>
        {option.label}
      </span>
    </span>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
