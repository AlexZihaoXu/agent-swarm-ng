import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Button } from '@/components/ui/button';
import { SearchIcon } from '@/components/ui/icons';
import { dialogMotion, dialogOverlay } from '@/lib/styles';

/**
 * A searchable multi-picker (Kibo command-dialog-3): a search box over grouped choices, each toggled in place with a
 * check, and Done. Used to add Discord channels to an agent and agents to a group. With `search`, the caller
 * filters (server-side); otherwise the choices' keywords are matched here.
 */
export function PickerDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  empty,
  status,
  search,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder: string;
  empty: string;
  /** The footer line, e.g. "3 chosen · save to apply". */
  status: string;
  search?: { value: string; onChange: (value: string) => void };
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-describedby={undefined}
          className={`fixed left-1/2 top-[max(1rem,12dvh)] z-50 flex max-h-[min(80dvh,36rem)] w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl ${dialogMotion}`}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Command
            label={title}
            shouldFilter={!search}
            filter={(_, value, keywords) =>
              keywords?.join(' ').toLowerCase().includes(value.trim().toLowerCase()) ? 1 : 0
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <Command.Input
                autoFocus
                placeholder={placeholder}
                {...(search ? { value: search.value, onValueChange: search.onChange } : {})}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  ×
                </button>
              </Dialog.Close>
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</Command.Empty>
              {children}
            </Command.List>
          </Command>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{status}</p>
            <Dialog.Close asChild>
              <Button type="button" size="sm" className="min-h-10">
                Done
              </Button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A group of choices under a heading (a Discord server, say). */
export function PickerGroup({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="border-b border-border py-1 last:border-b-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </Command.Group>
  );
}

/** One choice: selecting it toggles; a check shows it is chosen. */
export function PickerItem({
  value,
  keywords,
  checked,
  disabled,
  onSelect,
  children,
}: {
  value: string;
  keywords?: string[];
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      disabled={disabled}
      onSelect={onSelect}
      aria-checked={checked}
      className="relative flex min-h-11 cursor-pointer items-center gap-2 rounded-md py-2 pl-3 pr-9 text-sm outline-none select-none transition-colors duration-100 hover:bg-muted data-[selected=true]:bg-muted data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-40 motion-reduce:transition-none sm:min-h-9"
    >
      {children}
      {checked && (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="absolute right-3 size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="m5 12 4 4L19 6" />
        </svg>
      )}
    </Command.Item>
  );
}
