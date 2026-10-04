import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SearchIcon } from './icons';
import { cn } from '@/lib/utils';
import { Command } from 'cmdk';

/** Lists longer than this get a search field. */
const SEARCH_AFTER = 7;

type Option = {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  /** The group's key; groupLabel (or the key) is its heading. */
  group?: string;
  groupLabel?: string;
};

// Adapted from Kibo combobox/standard/combobox-standard-1 (Popover + Command). The trigger's width comes from its
// container only (`contain: inline-size`), so a longer or shorter choice never resizes it; the label truncates.
// Options may carry a second line (description) and a group: groups keep their first-seen order and, when there
// is more than one, they are divided; each named group shows its label (like the organization switcher's sections).
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
  searchable: forceSearch,
  searchPlaceholder = 'Search…',
  searchLabel = 'Search options',
  empty = 'No matches',
  search,
  onSearchChange,
  footer,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  /** Accepted for form semantics; the owning form's submit button enforces a choice. */
  required?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  triggerContent?: ReactNode;
  ariaLabel?: string;
  /** Show the search field however many options there are. */
  searchable?: boolean;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Shown when nothing matches; null while a caller's search is still answering. */
  empty?: ReactNode;
  /** A search the caller runs (for example on the server): the options are shown as given, unfiltered. */
  search?: string;
  onSearchChange?: (search: string) => void;
  /** Below the options, outside the listbox (for example a Load more button). */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find(option => option.value === value);
  const searchable = forceSearch ?? options.length > SEARCH_AFTER;
  const groups = [...new Set(options.map(option => option.group ?? ''))];
  // A caller's search starts afresh on every open, as cmdk's own does.
  const close = () => {
    setOpen(false);
    onSearchChange?.('');
  };
  const item = (option: Option) => (
    <Command.Item
      key={option.value}
      value={option.value}
      keywords={[option.label]}
      onSelect={() => {
        close();
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
  );
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
    // Modal: the open list takes over the page's scroll lock, so it scrolls by wheel/trackpad even inside a dialog
    // (whose own lock would otherwise swallow wheel events over this portalled list).
    <Popover.Root open={open} onOpenChange={next => (next ? setOpen(true) : close())} modal>
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
        className={cn(
          'ao-raised flex h-11 min-h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-sidebar px-3 text-left text-sm outline-none [contain:inline-size] data-[placeholder]:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted enabled:data-[state=open]:bg-muted transition-colors duration-120 motion-reduce:transition-none sm:h-10 sm:min-h-0',
          triggerClassName,
        )}
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
          className={cn(
            `z-[60] flex flex-col max-h-[min(18rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-sidebar text-foreground ao-top shadow-lg origin-[var(--radix-popover-content-transform-origin)] motion-safe:data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_100ms_ease-in]`,
            options.some(option => option.icon) && 'min-w-48',
            contentClassName,
          )}
          // Portalled, its right-clicks still bubble to the page's menus in React: mark them handled (the
          // document-level guard still hides the browser's own menu).
          onContextMenu={event => event.preventDefault()}
        >
          <Command
            ref={root}
            defaultValue={value}
            label={searchLabel}
            shouldFilter={onSearchChange === undefined}
            filter={(_, term, keywords) => (keywords?.join(' ').toLowerCase().includes(term.toLowerCase()) ? 1 : 0)}
            className="flex min-h-0 flex-col outline-none"
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-border px-3">
                <SearchIcon className="text-muted-foreground" />
                <Command.Input
                  ref={input}
                  placeholder={searchPlaceholder}
                  {...(onSearchChange ? { value: search ?? '', onValueChange: onSearchChange } : {})}
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            )}
            <Command.List label={ariaLabel ?? 'Options'} className="min-h-0 overflow-y-auto overscroll-contain p-1">
              {empty !== null && (
                <Command.Empty className="px-3 py-2 text-sm text-muted-foreground">{empty}</Command.Empty>
              )}
              {groups.length === 1 && !groups[0]
                ? options.map(item)
                : groups.map((group, index) => (
                    <Fragment key={group}>
                      {/* While cmdk filters, it hides separators (an emptied group would leave two); a caller's own search shows only matches. */}
                      {index > 0 && (
                        <Command.Separator
                          alwaysRender={onSearchChange !== undefined}
                          className="-mx-1 my-1 h-px bg-border"
                        />
                      )}
                      <Command.Group
                        heading={options.find(option => option.group === group)?.groupLabel ?? (group || undefined)}
                        className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                      >
                        {options.filter(option => (option.group ?? '') === group).map(item)}
                      </Command.Group>
                    </Fragment>
                  ))}
            </Command.List>
            {footer}
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function OptionLabel({ option, truncate = false }: { option: Option; truncate?: boolean }) {
  const wrap = truncate ? 'truncate' : 'break-words [overflow-wrap:anywhere]';
  return (
    <span className={`flex min-w-0 flex-1 items-center ${option.description ? 'gap-2.5' : 'gap-2'}`}>
      {option.icon && (
        <span
          aria-hidden="true"
          className={`flex shrink-0 items-center justify-center ${option.description ? 'size-8' : 'size-5'}`}
        >
          {option.icon}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span data-option-label className={`min-w-0 ${wrap}`}>
          {option.label}
        </span>
        {option.description && (
          <span className={`min-w-0 text-xs text-muted-foreground ${wrap}`}>{option.description}</span>
        )}
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
