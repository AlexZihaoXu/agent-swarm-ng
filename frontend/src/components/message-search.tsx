import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Command } from 'cmdk';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { FolderIcon, SearchIcon } from '@/components/ui/icons';
import { AgentAvatarArt } from '@/components/agent-avatar-art';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import { useSignedIn } from '@/lib/auth';
import { messageTime } from '@/lib/format-time';
import { initialsOf, useOrganizations } from '@/lib/organizations';
import { humanName } from '@/lib/people';
import { cn } from '@/lib/utils';
import {
  FILTER_KEYS,
  HISTORY_KEY,
  SORTS,
  absorbTokens,
  addFilter,
  describeSearch,
  filterChoices,
  highlightParts,
  pageItems,
  parseHistory,
  rememberSearch,
  searchQuery,
  searchable,
  typingFilter,
  withoutTyping,
  type Filter,
  type Person,
  type SearchState,
  type Sort,
} from '@/lib/message-search';

export type SearchResult =
  paths['/api/search/messages']['get']['responses'][200]['content']['application/json']['results'][number];
type Avatared = Person & { avatar?: AvatarAppearance | null };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const searchShortcut = isMac ? '⌘F' : 'Ctrl+F';

/** The conversation header's way in (beside Files and Activity, in their style). */
export function MessageSearchButton({
  open,
  onOpen,
  className,
}: {
  open: boolean;
  onOpen: (opener: HTMLElement) => void;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Search messages"
      title={`Search messages (${searchShortcut})`}
      aria-keyshortcuts={isMac ? 'Meta+F' : 'Control+F'}
      aria-expanded={open}
      onClick={event => onOpen(event.currentTarget)}
      className={cn('size-11 border-0 p-0 sm:size-8', open && 'bg-muted', className)}
    >
      <SearchIcon className="size-4" />
    </Button>
  );
}

/**
 * Phones' one header control for a conversation (below 768px, where Search and Files would crowd the title): a ⋯
 * menu, in the app's dropdown style, with Search messages and Chat files. The chosen action runs once the menu has
 * closed, with this button as its opener, so focus comes back here.
 */
export function ConversationMoreMenu({
  conversation,
  onSearch,
  onFiles,
  className,
}: {
  conversation: string;
  onSearch: (opener: HTMLElement) => void;
  onFiles: (opener: HTMLElement) => void;
  className?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const chosen = useRef<((opener: HTMLElement) => void) | null>(null);
  const item =
    'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 outline-none focus:bg-muted focus:text-foreground';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          ref={trigger}
          variant="outline"
          size="sm"
          aria-label={`More for ${conversation}`}
          title="More"
          className={cn('size-11 shrink-0 p-0', className)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={5}
          collisionPadding={12}
          aria-label={`More for ${conversation}`}
          onCloseAutoFocus={event => {
            const action = chosen.current;
            chosen.current = null;
            if (!action || !trigger.current) return;
            event.preventDefault();
            action(trigger.current);
          }}
          className="z-50 w-52 rounded-lg border border-border bg-background p-1 text-sm ao-top shadow-lg motion-safe:data-[state=open]:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_130ms_ease-in]"
        >
          <DropdownMenu.Item className={item} onSelect={() => (chosen.current = onSearch)}>
            <SearchIcon className="size-4 text-muted-foreground" />
            Search messages
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => (chosen.current = onFiles)}>
            <FolderIcon className="size-4 text-muted-foreground" />
            Chat files
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Each person's own (a shared browser never shows another person's searches); cleared at sign-out (lib/auth.tsx).
const historyKey = (person: string) => `${HISTORY_KEY}:${person}`;
const readHistory = (person: string) => {
  try {
    return parseHistory(localStorage.getItem(historyKey(person)));
  } catch {
    return [];
  }
};
const writeHistory = (person: string, history: SearchState[]) => {
  try {
    if (history.length) localStorage.setItem(historyKey(person), JSON.stringify(history));
    else localStorage.removeItem(historyKey(person));
  } catch {
    // Blocked storage: history lasts for this page only.
  }
};
function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(value), ms]);
  return settled;
}

/** Each filter's own icon in the Filters list (as Discord marks its filters). */
const line = (paths: string) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4"
  >
    <path d={paths} />
  </svg>
);
const FILTER_ICONS: Record<string, React.ReactNode> = {
  // A person.
  from: line('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'),
  // A paperclip.
  has: line(
    'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
  ),
  // A calendar.
  before: line('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'),
  during: line('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'),
  after: line('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'),
  // Chat bubbles.
  in: line(
    'M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2zM18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1',
  ),
};
const filterIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4">
    <path d="M4 5h16l-6 8v5l-4 2v-7z" strokeLinejoin="round" />
  </svg>
);
const historyIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const itemClass =
  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-[selected=true]:bg-muted';
const groupClass =
  'py-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground';

/**
 * Message search (docs/chat-and-groups.md#search), after Discord's: a field whose suggestions list the filters
 * (from:, has:, before:, during:, after:, in:) and recent searches (Kibo command-popover-3), chips for the filters
 * chosen, then "N Results" with Sort and scope, result cards with Jump, and pages (Kibo pagination-basic-5 at
 * pagination-sizes-1's size). Docked on the right like Agent activity (Kibo sheet-standard-2); a full-screen sheet
 * on phones. The server decides what may be read; this only asks.
 */
export function MessageSearchPanel({
  open,
  onOpenChange,
  conversation,
  people,
  everyone,
  focusRequest,
  returnFocus,
  onJump,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The conversation shown, when it can be searched on its own. */
  conversation: { key: string; name: string } | null;
  /** Who writes in this conversation (from: choices), and everyone in the organization shown (all chats). */
  people: Avatared[];
  everyone: Avatared[];
  /** Changes when Ctrl/⌘+F asks for the field again. */
  focusRequest: number;
  returnFocus: () => HTMLElement | null;
  onJump: (result: SearchResult) => void;
}) {
  const { name: me } = useSignedIn();
  const { current: organization } = useOrganizations();
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const [input, setInput] = useState('');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(1);
  const [suggesting, setSuggesting] = useState(false);
  const [history, setHistory] = useState<SearchState[]>(() => readHistory(me));
  const field = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!open || !focusRequest) return;
    field.current?.focus();
    field.current?.select();
  }, [focusRequest]);

  const typing = typingFilter(input);
  const state: SearchState = { text: typing ? withoutTyping(input) : input, filters };
  const scope = filters.find(filter => filter.key === 'in')?.value ?? (conversation ? 'this' : 'all');
  const choices = scope === 'this' ? people : everyone;
  const settled = useSettled(
    searchQuery(state, {
      conversation: conversation?.key ?? null,
      organizationId: organization === 'all' ? null : organization,
      sort,
      page,
    }),
    250,
  );
  const ready = searchable(state);
  const found = useQuery({
    queryKey: ['message-search', settled],
    enabled:
      open &&
      ready &&
      Boolean(settled.q || settled.from || settled.has || settled.before || settled.after || settled.during),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/search/messages', { params: { query: settled }, signal });
      if (!data || error) throw new Error(error?.message ?? 'Could not search.');
      return data;
    },
  });
  // A new search starts at its first page, scrolled to the top.
  const change = (next: Partial<{ input: string; filters: Filter[]; sort: Sort }>) => {
    if (next.input !== undefined) setInput(next.input);
    if (next.filters) setFilters(next.filters);
    if (next.sort) setSort(next.sort);
    setPage(1);
  };
  useEffect(() => {
    // Not returned: Chromium's scroll methods now return a promise.
    results.current?.scrollTo({ top: 0 });
  }, [found.data]);

  const remember = () => {
    const next = rememberSearch(history, state);
    if (next === history) return;
    setHistory(next);
    writeHistory(me, next);
  };
  const type = (value: string) => {
    setSuggesting(true);
    // A finished token (`has:link `) becomes a chip.
    if (/\s$/.test(value)) {
      const absorbed = absorbTokens({ text: value, filters });
      if (absorbed.filters !== filters) return change({ input: absorbed.text, filters: absorbed.filters });
    }
    change({ input: value });
  };
  const choose = (filter: Filter) => {
    const text = withoutTyping(input);
    change({ input: text ? `${text} ` : '', filters: addFilter(filters, filter) });
    setSuggesting(false);
    field.current?.focus();
  };
  const startFilter = (key: Filter['key']) => {
    const text = input.trimEnd();
    setInput(`${text ? `${text} ` : ''}${key}:`);
    setSuggesting(true);
    field.current?.focus();
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !input && filters.length) {
      event.preventDefault();
      change({ filters: filters.slice(0, -1) });
    } else if (event.key === 'Enter' && !showSuggestions) {
      event.preventDefault();
      remember();
    }
  };
  const showSuggestions = open && suggesting && (!input.trim() || Boolean(typing));
  const chips = filters.filter(filter => filter.key !== 'in');
  const data = found.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const total = data ? (data.more ? '1000+' : String(data.total)) : '';

  const suggestionList = (
    <Command.List className="max-h-80 overflow-y-auto overscroll-contain p-1">
      {typing ? (
        <Command.Group heading={`${typing.key}:`} className={groupClass}>
          {filterChoices(typing.key, typing.value, choices).map(choice => (
            <Command.Item
              key={`${choice.key}:${choice.value}`}
              value={`${choice.key}:${choice.value}`}
              onSelect={() => choose(choice)}
              className={itemClass}
            >
              {choice.key === 'from' ? (
                <PersonAvatar
                  name={choice.label}
                  avatar={
                    choice.personId
                      ? (choices.find(person => person.id === choice.personId)?.avatar ??
                        defaultAvatar(choice.personId))
                      : null
                  }
                  size={20}
                />
              ) : (
                <span className="flex size-5 items-center justify-center text-muted-foreground">{filterIcon}</span>
              )}
              <span className="min-w-0 flex-1 truncate">{choice.label}</span>
              {choice.description && <span className="text-xs text-muted-foreground">{choice.description}</span>}
            </Command.Item>
          ))}
          {['before', 'after', 'during'].includes(typing.key) && (
            <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Or type a date as YYYY-MM-DD.</p>
          )}
          <Command.Empty className="px-2.5 py-3 text-sm text-muted-foreground">No matches.</Command.Empty>
        </Command.Group>
      ) : (
        <>
          <Command.Group heading="Filters" className={groupClass}>
            {FILTER_KEYS.filter(item => item.key !== 'in' || conversation).map(item => (
              <Command.Item
                key={item.key}
                value={`filter:${item.key}`}
                onSelect={() => startFilter(item.key)}
                className={itemClass}
              >
                <span className="flex size-5 items-center justify-center text-muted-foreground">
                  {FILTER_ICONS[item.key] ?? filterIcon}
                </span>
                <span className="font-medium">{item.key}:</span>
                <span className="min-w-0 truncate text-muted-foreground">{item.hint}</span>
              </Command.Item>
            ))}
          </Command.Group>
          {history.length > 0 && (
            <Command.Group heading="History" className={cn(groupClass, 'border-t border-border')}>
              {history.map(item => (
                <Command.Item
                  key={describeSearch(item)}
                  value={`history:${describeSearch(item)}`}
                  onSelect={() => {
                    change({ input: item.text, filters: item.filters });
                    setSuggesting(false);
                    field.current?.focus();
                  }}
                  className={itemClass}
                >
                  <span className="flex size-5 items-center justify-center text-muted-foreground">{historyIcon}</span>
                  <span className="min-w-0 flex-1 truncate">{describeSearch(item)}</span>
                </Command.Item>
              ))}
              {/* An option (not a button in the heading, which cmdk hides from assistive technology). */}
              <Command.Item
                value="history:clear"
                onSelect={() => {
                  setHistory([]);
                  writeHistory(me, []);
                  field.current?.focus();
                }}
                className={cn(itemClass, 'text-xs text-muted-foreground')}
              >
                <span className="size-5" aria-hidden="true" />
                Clear history
              </Command.Item>
            </Command.Group>
          )}
        </>
      )}
    </Command.List>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!wide}>
      <Dialog.Portal>
        {!wide && (
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 motion-safe:data-[state=open]:animate-[fade-in_200ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_160ms_ease-in]" />
        )}
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed bottom-0 right-0 top-0 z-50 flex w-full min-w-0 flex-col border-l border-border bg-sidebar shadow-xl outline-none sm:top-14 sm:max-w-sm motion-safe:data-[state=open]:animate-[activity-in_180ms_ease-out] motion-safe:data-[state=closed]:animate-[activity-out_140ms_ease-in]"
          onInteractOutside={event => {
            if (wide) event.preventDefault();
          }}
          // The first Escape closes the suggestions; the next closes the panel.
          onEscapeKeyDown={event => {
            if (!showSuggestions) return;
            event.preventDefault();
            setSuggesting(false);
          }}
          onOpenAutoFocus={event => {
            event.preventDefault();
            field.current?.focus();
            setSuggesting(true);
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const opener = returnFocus();
            if (opener?.isConnected) opener.focus();
          }}
        >
          <header className="shrink-0 border-b border-border px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-3">
            <div className="flex items-center gap-2">
              <Dialog.Title className="text-sm font-semibold">Search messages</Dialog.Title>
              <Dialog.Close asChild>
                <Button
                  variant="flat"
                  size="sm"
                  aria-label="Close search"
                  className="ml-auto size-11 border-0 p-0 sm:size-7"
                >
                  <span aria-hidden="true">×</span>
                </Button>
              </Dialog.Close>
            </div>
            <Command label="Search messages" shouldFilter={false} loop className="relative mt-2">
              <div
                className="ao-inset flex min-h-10 flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1 focus-within:ring-1 focus-within:ring-ring"
                onClick={() => field.current?.focus()}
              >
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                {chips.map(filter => (
                  <span
                    key={`${filter.key}:${filter.value}`}
                    className="card-enter flex max-w-full items-center gap-1 rounded bg-muted py-0.5 pl-1.5 pr-0.5 text-xs"
                  >
                    <span className="text-muted-foreground">{filter.key}:</span>
                    <span className="min-w-0 truncate font-medium">{filter.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove filter ${filter.key}: ${filter.label}`}
                      onClick={event => {
                        event.stopPropagation();
                        change({ filters: filters.filter(item => item !== filter) });
                        field.current?.focus();
                      }}
                      className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                ))}
                <Command.Input
                  ref={field}
                  value={input}
                  onValueChange={type}
                  onKeyDown={keys}
                  onFocus={() => setSuggesting(true)}
                  onBlur={() => setSuggesting(false)}
                  maxLength={240}
                  aria-label="Search messages"
                  placeholder={
                    chips.length
                      ? ''
                      : conversation && scope === 'this'
                        ? `Search ${conversation.name}`
                        : 'Search all chats'
                  }
                  className="h-8 min-w-24 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
                />
                {(input || chips.length > 0) && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onMouseDown={event => event.preventDefault()}
                    onClick={event => {
                      event.stopPropagation();
                      change({ input: '', filters: filters.filter(filter => filter.key === 'in') });
                      field.current?.focus();
                    }}
                    className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
              {showSuggestions && (
                <div
                  // Choosing with the mouse must not blur the field (which would close this list first).
                  onMouseDown={event => event.preventDefault()}
                  className="context-menu-content absolute inset-x-0 top-full z-10 mt-1 rounded-lg border border-border bg-background ao-top shadow-lg"
                  data-state="open"
                >
                  {suggestionList}
                </div>
              )}
            </Command>
          </header>

          {ready && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <h3 aria-live="polite" className="mr-auto text-sm font-semibold tabular-nums">
                {data ? `${total} ${data.total === 1 && !data.more ? 'Result' : 'Results'}` : 'Searching…'}
              </h3>
              {conversation && (
                <div className="w-36">
                  <Select
                    id="message-search-scope"
                    ariaLabel="Search in"
                    value={scope}
                    onValueChange={value =>
                      change({
                        filters: addFilter(filters, {
                          key: 'in',
                          value: value as 'this' | 'all',
                          label: value === 'all' ? 'All chats' : 'This conversation',
                        }),
                      })
                    }
                    options={[
                      { value: 'this', label: 'This conversation' },
                      { value: 'all', label: 'All chats' },
                    ]}
                    triggerClassName="!h-7 !min-h-0 !w-full !px-2 !text-xs"
                  />
                </div>
              )}
              <div className="w-24">
                <Select
                  id="message-search-sort"
                  ariaLabel="Sort"
                  value={sort}
                  onValueChange={value => change({ sort: value as Sort })}
                  options={SORTS.map(item => ({ value: item.value, label: item.label }))}
                  triggerClassName="!h-7 !min-h-0 !w-full !px-2 !text-xs"
                />
              </div>
            </div>
          )}

          <ScrollArea label="Search results" viewportRef={results} className="min-h-0 flex-1">
            <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
              {!ready ? (
                <Empty className="p-6 md:p-6">
                  <EmptyHeader>
                    <EmptyMedia>
                      <SearchIcon />
                    </EmptyMedia>
                    <EmptyTitle className="text-base">Search messages</EmptyTitle>
                    <EmptyDescription>
                      Type words to find, or add a filter such as <strong>from:</strong> or <strong>has:</strong>.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : found.isError ? (
                <div role="alert" className="space-y-2 p-3 text-sm text-muted-foreground">
                  <p>{found.error.message}</p>
                  <Button variant="outline" size="sm" onClick={() => void found.refetch()}>
                    Retry search
                  </Button>
                </div>
              ) : !data ? (
                <div role="status" aria-label="Searching…" className="space-y-2">
                  {[0, 1, 2].map(index => (
                    <Skeleton key={index} className="h-20 rounded-lg" style={{ animationDelay: `${index * 90}ms` }} />
                  ))}
                </div>
              ) : !data.results.length ? (
                <Empty className="p-6 md:p-6">
                  <EmptyHeader>
                    <EmptyMedia>
                      <SearchIcon />
                    </EmptyMedia>
                    <EmptyTitle className="text-base">No results</EmptyTitle>
                    <EmptyDescription>Try other words, fewer filters or all chats.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ol
                  key={`${JSON.stringify(settled)}`}
                  aria-label="Search results"
                  aria-busy={found.isFetching}
                  className={cn('view-enter space-y-2', found.isFetching && 'opacity-70')}
                >
                  {data.results.map(result => (
                    <ResultCard
                      key={`${result.kind}:${result.id}`}
                      result={result}
                      me={me}
                      showConversation={scope === 'all'}
                      onJump={() => {
                        remember();
                        onJump(result);
                      }}
                    />
                  ))}
                </ol>
              )}
              {data && pages > 1 && (
                <Pages page={data.page} pages={pages} busy={found.isFetching} onPage={next => setPage(next)} />
              )}
            </div>
          </ScrollArea>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PersonAvatar({ name, avatar, size }: { name: string; avatar: AvatarAppearance | null; size: number }) {
  return avatar ? (
    <AgentAvatarArt {...avatar} size={size} />
  ) : (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-medium text-foreground/75"
    >
      {initialsOf(name)}
    </span>
  );
}

function ResultCard({
  result,
  me,
  showConversation,
  onJump,
}: {
  result: SearchResult;
  me: string;
  showConversation: boolean;
  onJump: () => void;
}) {
  const name = result.author.kind === 'human' ? humanName(result.author.name, me) : (result.author.name ?? 'Agent');
  const avatar =
    result.author.kind === 'agent' ? (result.author.avatar ?? defaultAvatar(result.author.id ?? name)) : null;
  const { snippet } = result;
  return (
    <li
      onClick={event => {
        if (!(event.target as Element).closest('button, a')) onJump();
      }}
      className="group/result cursor-pointer rounded-lg border border-border bg-background p-3 ao-card transition-colors hover:border-foreground/20 motion-reduce:transition-none"
    >
      <div className="flex items-start gap-2.5">
        <PersonAvatar name={name} avatar={avatar} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
            <time
              dateTime={new Date(result.timestamp).toISOString()}
              className="shrink-0 text-[11px] text-muted-foreground"
            >
              {messageTime(result.timestamp)}
            </time>
            <Button
              variant="outline"
              size="sm"
              onClick={onJump}
              aria-label={`Jump to ${name}'s message`}
              className="ml-auto h-6 shrink-0 px-2 text-xs opacity-0 transition-opacity group-hover/result:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
            >
              Jump
            </Button>
          </div>
          {showConversation && (
            <p className="truncate text-[11px] text-muted-foreground">
              {result.kind === 'group' ? '# ' : ''}
              {result.conversation.name}
            </p>
          )}
          {snippet.text && (
            <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
              {snippet.clippedStart && '…'}
              {highlightParts(snippet.text, snippet.ranges).map((part, index) =>
                part.match ? (
                  <mark key={index} className="rounded-sm bg-amber-300/25 px-0.5 text-foreground">
                    {part.text}
                  </mark>
                ) : (
                  <Fragment key={index}>{part.text}</Fragment>
                ),
              )}
              {snippet.clippedEnd && '…'}
            </p>
          )}
          {result.files.length > 0 && (
            <ul aria-label="Files" className="mt-1.5 flex flex-wrap gap-1">
              {result.files.map(file => (
                <li
                  key={file.id}
                  className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {file.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function Pages({
  page,
  pages,
  busy,
  onPage,
}: {
  page: number;
  pages: number;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  const step =
    'h-7 min-w-7 cursor-pointer rounded-md px-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent motion-reduce:transition-none';
  return (
    <nav aria-label="Result pages" className="mt-3 flex justify-center">
      <ul className="flex flex-wrap items-center gap-0.5">
        <li>
          <button type="button" className={step} disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
            ‹ Previous
          </button>
        </li>
        {pageItems(page, pages).map((item, index) => (
          <li key={item === 'gap' ? `gap-${index}` : item}>
            {item === 'gap' ? (
              <span aria-hidden="true" className="px-1 text-xs text-muted-foreground">
                …
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Page ${item}`}
                aria-current={item === page ? 'page' : undefined}
                disabled={busy && item !== page}
                onClick={() => item !== page && onPage(item)}
                className={cn(step, item === page && 'ao-raised border border-border bg-background font-semibold')}
              >
                {item}
              </button>
            )}
          </li>
        ))}
        <li>
          <button type="button" className={step} disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>
            Next ›
          </button>
        </li>
      </ul>
    </nav>
  );
}
