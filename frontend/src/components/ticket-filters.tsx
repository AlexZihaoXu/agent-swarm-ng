import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { KeyboardIcon, SearchIcon, XIcon } from '@/components/ui/icons';
import { StateDot } from '@/components/ticket-board';
import { dialogMotion, dialogOverlay } from '@/lib/styles';
import {
  clearFilters,
  filterCount,
  PRIORITIES,
  type BoardState,
  type TicketFilters,
  type TicketSort,
  type TicketSummary,
} from '@/lib/tickets';
import type { ChatAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

const toggle = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter(item => item !== value) : [...list, value];
const chip =
  'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-foreground/50 aria-pressed:bg-muted aria-pressed:text-foreground sm:min-h-7';
const SORTS: { value: TicketSort; label: string }[] = [
  { value: 'manual', label: 'Manual order' },
  { value: 'updated', label: 'Last updated' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
];
const DUES: { value: TicketFilters['due']; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'soon', label: 'Due soon' },
  { value: 'none', label: 'No due date' },
];

/** A facet of the filter popover: several chips that toggle (Kibo popover-standard-13's checkbox list, as chips). */
function Facet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}
function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={chip}>
      {children}
    </button>
  );
}

/**
 * The board's search and filters (docs/tickets.md#search-and-filters): Kibo input-group-icons-1 (search with an
 * icon) and popover-standard-13 (a Filter button opening the options), applied as they are chosen and kept in the
 * address. The list also sorts. On a phone the popover spans the screen.
 */
export function TicketToolbar({
  filters,
  onChange,
  view,
  tickets,
  states,
  agents,
  searchRef,
  onHelp,
}: {
  filters: TicketFilters;
  onChange: (next: TicketFilters) => void;
  view: 'board' | 'list';
  /** The board's tickets: their labels are the label choices. */
  tickets: TicketSummary[];
  /** The board's workflow states: the status choices (a canceled one also shows its column). */
  states: BoardState[];
  agents: ChatAgent[];
  searchRef: RefObject<HTMLInputElement | null>;
  onHelp: () => void;
}) {
  const id = useId();
  // The address follows the typing a moment later (and with it the server's search).
  const [text, setText] = useState(filters.q);
  const latest = useRef(filters);
  latest.current = filters;
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text === latest.current.q) return;
    const timer = setTimeout(() => onChange({ ...latest.current, q: text }), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const count = filterCount(filters);
  const labels = [...new Set([...tickets.flatMap(ticket => ticket.labels), ...filters.label])].sort();
  const set = (patch: Partial<TicketFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-2 sm:basis-auto">
      <div className="relative min-w-0 flex-1 sm:max-w-72">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <label htmlFor={`${id}-search`} className="sr-only">
          Search tickets
        </label>
        <input
          id={`${id}-search`}
          ref={searchRef}
          type="search"
          value={text}
          maxLength={200}
          placeholder="Search tickets"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setText('');
              if (filters.q) onChange({ ...filters, q: '' });
              event.currentTarget.blur();
            }
          }}
          className="ao-inset h-11 w-full rounded-lg border border-border bg-sidebar pl-8 pr-8 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring sm:h-8 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground sm:block"
        >
          /
        </kbd>
      </div>
      <Popover.Root>
        <Popover.Trigger asChild>
          <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-8">
            Filter
            {count > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {count}
              </span>
            )}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={16}
            aria-label="Filter tickets"
            className="z-50 max-h-[min(32rem,calc(100dvh-8rem))] w-[calc(100vw-2rem)] origin-[var(--radix-popover-content-transform-origin)] space-y-4 overflow-y-auto rounded-lg border border-border bg-background p-4 ao-top shadow-lg sm:w-96 motion-safe:data-[state=open]:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_130ms_ease-in]"
          >
            <h4 className="text-sm font-semibold">Filter tickets</h4>
            <Facet label="Status">
              {states.map(state => (
                <Toggle
                  key={state.id}
                  pressed={filters.status.includes(state.id)}
                  onClick={() => set({ status: toggle(filters.status, state.id) })}
                >
                  <StateDot color={state.color} />
                  {state.name}
                </Toggle>
              ))}
            </Facet>
            <Facet label="Assignee">
              {[
                { value: 'me', label: 'Me' },
                { value: 'agents', label: 'Any agent' },
                ...agents.map(agent => ({ value: agent.id, label: agent.name })),
                { value: 'none', label: 'Unassigned' },
              ].map(option => (
                <Toggle
                  key={option.value}
                  pressed={filters.assignee.includes(option.value)}
                  onClick={() => set({ assignee: toggle(filters.assignee, option.value) })}
                >
                  {option.label}
                </Toggle>
              ))}
            </Facet>
            <Facet label="Priority">
              {PRIORITIES.map(priority => (
                <Toggle
                  key={priority.key}
                  pressed={filters.priority.includes(priority.key)}
                  onClick={() => set({ priority: toggle(filters.priority, priority.key) })}
                >
                  {priority.label}
                </Toggle>
              ))}
            </Facet>
            {labels.length > 0 && (
              <Facet label="Label">
                {labels.map(label => (
                  <Toggle
                    key={label}
                    pressed={filters.label.includes(label)}
                    onClick={() => set({ label: toggle(filters.label, label) })}
                  >
                    {label}
                  </Toggle>
                ))}
              </Facet>
            )}
            <Facet label="Due">
              {DUES.map(option => (
                <Toggle
                  key={option.value}
                  pressed={filters.due === option.value}
                  onClick={() => set({ due: option.value })}
                >
                  {option.label}
                </Toggle>
              ))}
            </Facet>
            <Facet label="Archive">
              <Toggle pressed={filters.archived} onClick={() => set({ archived: !filters.archived })}>
                Show archived
              </Toggle>
            </Facet>
            <div className="flex justify-between gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!count}
                onClick={() => onChange(clearFilters(filters))}
              >
                Clear filters
              </Button>
              <Popover.Close asChild>
                <Button type="button" size="sm">
                  Close
                </Button>
              </Popover.Close>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {view === 'list' && (
        <div className="w-40">
          <Select
            id={`${id}-sort`}
            ariaLabel="Sort"
            value={filters.sort}
            options={SORTS}
            onValueChange={value => set({ sort: value as TicketSort })}
          />
        </div>
      )}
      {(count > 0 || filters.q) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 gap-1 text-muted-foreground sm:min-h-8"
          onClick={() => {
            setText('');
            onChange({ ...clearFilters(filters), q: '' });
          }}
        >
          <XIcon className="size-3.5" />
          Clear
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        className="ml-auto hidden size-8 p-0 text-muted-foreground md:inline-flex"
        onClick={onHelp}
      >
        <KeyboardIcon />
      </Button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['C', 'New ticket'],
  ['/', 'Search tickets'],
  ['Esc', 'Close the ticket, or clear the search'],
  ['?', 'Show these shortcuts'],
];
/** The Tickets tab's keys (Kibo kbd shortcut composition), listed in a small dialog. */
export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background ao-card p-5 shadow-xl ${dialogMotion}`}
        >
          <Dialog.Title className="text-base font-semibold">Keyboard shortcuts</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            On the Tickets tab, while you are not typing in a field or using a computer.
          </Dialog.Description>
          <dl className="mt-4 space-y-2 text-sm">
            {SHORTCUTS.map(([key, what]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{what}</dt>
                <dd>
                  <kbd className="inline-flex min-w-7 justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs shadow-[inset_0_-1px_0] shadow-border">
                    {key}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <Button type="button" size="sm">
                Close
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
