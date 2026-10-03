import { useOrganizations } from '@/lib/organizations';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { computersQuery } from '@/lib/computers-query';
import { terminalSessionsQuery } from '@/lib/computer-terminals';
import type { ChatAgent } from '@/use-chat';
import {
  agentPath,
  chatAgentDmPath,
  chatAgentPath,
  chatGroupPath,
  computerPath,
  computerTerminalPath,
  knowledgePath,
} from '@/lib/dashboard-location';
import {
  enterAction,
  parseQuery,
  PREFIXES,
  search,
  type PortalItem,
  type PortalKind,
  type PortalPrefix,
} from '@/lib/portal-search';
import { openWindow } from '@/lib/portal-windows';
import {
  AgentsIcon,
  BookIcon,
  SearchIcon,
  ChatIcon,
  ComputerIcon,
  SettingsIcon,
  TerminalIcon,
} from '@/components/ui/icons';
import { AgentAvatarArt } from './agent-avatar-art';
import { defaultAvatar } from '@/lib/agent-avatar';
import { cn } from '@/lib/utils';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The shortcut as this keyboard writes it. */
export const portalShortcut = isMac ? '⌘K' : 'Ctrl K';

/**
 * Ctrl/⌘+K opens Portal from anywhere, except while a computer's desktop or terminal has the keyboard: those keep
 * every key (Ctrl+K deletes to the line end in a shell), and the desktop is a frame the page never hears from.
 */
export function usePortalShortcut(toggle: () => void) {
  const latest = useRef(toggle);
  latest.current = toggle;
  useEffect(() => {
    const press = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(isMac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey)
        return;
      if ((event.target as Element | null)?.closest?.('[data-keys-to-computer]')) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, []);
}

const PAGES: { title: string; path: string; keywords?: string[] }[] = [
  { title: 'Agents', path: '/agents' },
  { title: 'New agent', path: '/agents/new', keywords: ['create'] },
  { title: 'Chat', path: '/chat', keywords: ['conversations'] },
  { title: 'New group', path: '/chat/groups/new', keywords: ['create'] },
  { title: 'Computers', path: '/computers', keywords: ['desktops'] },
  { title: 'New computer', path: '/computers/new', keywords: ['create'] },
  { title: 'Dashboard', path: '/dashboard', keywords: ['usage', 'cpu', 'memory', 'disk', 'tokens', 'spend', 'cost'] },
  { title: 'Settings', path: '/settings', keywords: ['models', 'endpoints', 'swarm', 'storage', 'discord'] },
  { title: 'Knowledge', path: '/settings/knowledge', keywords: ['docs', 'guide'] },
  { title: 'Audit log', path: '/settings/audit', keywords: ['log', 'sign-in', 'login', 'history', 'security'] },
];
const icons: Record<PortalKind, ReactNode> = {
  agent: <AgentsIcon className="size-4" />,
  chat: <ChatIcon className="size-4" />,
  computer: <ComputerIcon className="size-4" />,
  terminal: <TerminalIcon className="size-4" />,
  page: <SettingsIcon className="size-4" />,
  file: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  ),
  knowledge: <BookIcon className="size-4" />,
  command: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="m6 8 4 4-4 4M12 16h6" />
    </svg>
  ),
};

/** Debounced text for server searches. */
function useSettled(value: string, ms = 180) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Portal: one search over everything (agents, chats, computers and terminals, pages, files, Knowledge, commands).
 * Enter pulls a chat, terminal or desktop out as a floating window (on a phone it opens the page), Shift+Enter goes
 * to its page, and a prefix (@ # : / > ?) narrows the search; the empty state teaches them as chips. Kibo
 * command-dialog-2 (Command Dialog with Icons and Shortcuts), in frosted glass.
 */
export function Portal({
  open,
  onOpenChange,
  agents,
  busy,
  onNavigate,
  onStop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: ChatAgent[];
  busy: Record<string, boolean>;
  onNavigate: (path: string) => void;
  onStop: (channelId: string) => void;
}) {
  const [prefix, setPrefix] = useState<PortalPrefix | undefined>();
  const [text, setText] = useState('');
  const [selected, setSelected] = useState('');
  const [phone, setPhone] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setPrefix(undefined);
    setText('');
    setPhone(window.matchMedia('(max-width: 767px)').matches);
  }, [open]);
  const query = useSettled(text.trim());

  const computersData = useQuery({ ...computersQuery, enabled: open });
  // Portal searches the organization shown (docs/organizations.md); its agents prop is already scoped.
  const { inScope } = useOrganizations();
  const computers = useMemo(
    () => ({
      data: computersData.data && {
        computers: computersData.data.computers.filter(computer => inScope(computer.organizationId)),
      },
    }),
    [computersData.data, inScope],
  );
  const running = (computers.data?.computers ?? []).filter(computer => computer.state === 'running');
  const terminals = useQueries({
    queries: running.slice(0, 20).map(computer => ({ ...terminalSessionsQuery(computer.id), enabled: open })),
  });
  // Groups load when Portal opens (not with the page).
  const groups = useQuery({
    queryKey: ['portal-groups'],
    enabled: open,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET('/api/groups', { params: { query: {} }, signal });
      return data?.groups ?? [];
    },
    select: list => list.filter(group => inScope(group.organizationId)),
  });
  const knowledge = useQuery({
    queryKey: ['portal-knowledge', query],
    enabled: open && (prefix?.prefix === '?' || query.length >= 2),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      if (!query) {
        const { data } = await api.GET('/api/knowledge', { params: { query: { limit: 20 } }, signal });
        return (data?.entries ?? []).map(entry => ({ ...entry, found: false }));
      }
      const { data } = await api.GET('/api/knowledge/search', { params: { query: { query, limit: 8 } }, signal });
      return (data?.matches ?? []).map(entry => ({ ...entry, found: true }));
    },
  });
  const files = useQuery({
    queryKey: ['portal-files', query],
    enabled: open && !prefix && query.length >= 2,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET('/api/files/find', { params: { query: { q: query } }, signal });
      return data ?? { files: [], scratch: [] };
    },
  });

  const items = useMemo<PortalItem[]>(() => {
    const byChannel = new Map(agents.map(agent => [agent.channelId, agent]));
    const name = (id: string) => agents.find(agent => agent.id === id)?.name ?? 'an agent';
    const out: PortalItem[] = [];
    for (const agent of agents) {
      out.push({
        id: `agent:${agent.id}`,
        kind: 'agent',
        title: agent.name,
        subtitle: busy[agent.channelId] ? 'Working' : undefined,
        path: chatAgentPath(agent.id),
        float: { kind: 'chat', agentId: agent.id },
      });
      out.push({
        id: `chat:${agent.id}`,
        kind: 'chat',
        title: agent.name,
        subtitle: 'Private chat',
        path: chatAgentPath(agent.id),
        float: { kind: 'chat', agentId: agent.id },
        prefixOnly: true,
      });
      out.push({
        id: `page:agent:${agent.id}`,
        kind: 'page',
        title: `${agent.name} settings`,
        keywords: ['agent', 'model', 'instructions', 'heartbeat'],
        path: agentPath(agent.id),
      });
      if (busy[agent.channelId])
        out.push({
          id: `command:stop:${agent.id}`,
          kind: 'command',
          title: `Stop ${agent.name}`,
          subtitle: 'Stop its current turn',
          run: () => onStop(agent.channelId),
        });
    }
    for (const group of groups.data ?? [])
      out.push({
        id: `chat:group:${group.id}`,
        kind: 'chat',
        title: group.name,
        subtitle: 'Group',
        path: chatGroupPath(group.id),
      });
    for (const computer of computers.data?.computers ?? [])
      out.push({
        id: `computer:${computer.id}`,
        kind: 'computer',
        title: computer.name,
        subtitle: computer.state === 'running' ? 'Running' : computer.state,
        path: computerPath(computer.id),
        float: { kind: 'computer', computerId: computer.id },
      });
    running.slice(0, 20).forEach((computer, index) => {
      for (const session of terminals[index]?.data?.sessions ?? [])
        out.push({
          id: `terminal:${computer.id}:${session.id}`,
          kind: 'terminal',
          title: session.name,
          subtitle: `${computer.name}${session.alive ? '' : ' · exited'}`,
          keywords: [computer.name],
          path: computerTerminalPath(computer.id, session.id),
          float: { kind: 'terminal', computerId: computer.id, session: session.id },
        });
    });
    for (const page of PAGES) out.push({ id: `page:${page.path}`, kind: 'page', ...page });
    for (const entry of knowledge.data ?? [])
      out.push({
        id: `knowledge:${entry.id}`,
        kind: 'knowledge',
        title: entry.title,
        subtitle: entry.id,
        keywords: [entry.summary],
        path: knowledgePath(entry.id),
        found: entry.found,
      });
    const scopedGroups = new Set((groups.data ?? []).map(group => group.id));
    for (const file of files.data?.files ?? []) {
      const [kind, a, b] = file.channelKey.split(':');
      const owner = kind === 'chat' ? byChannel.get(a) : undefined;
      // Only files of chats in the organization shown.
      if (kind === 'chat' ? !owner : kind === 'group' ? !scopedGroups.has(a) : !agents.some(agent => agent.id === a))
        continue;
      const path =
        kind === 'chat' && owner
          ? chatAgentPath(owner.id)
          : kind === 'group'
            ? chatGroupPath(a)
            : kind === 'dm'
              ? chatAgentDmPath(a, b)
              : '/chat';
      out.push({
        id: `file:${file.id}`,
        kind: 'file',
        title: file.name,
        subtitle: kind === 'chat' && owner ? `Chat with ${owner.name}` : kind === 'group' ? 'Group chat' : 'Chat file',
        path,
        found: true,
      });
    }
    for (const file of (files.data?.scratch ?? []).filter(item => agents.some(agent => agent.id === item.agentId)))
      out.push({
        id: `file:scratch:${file.agentId}:${file.path}`,
        kind: 'file',
        title: file.path.split('/').at(-1) ?? file.path,
        subtitle: `${name(file.agentId)}'s scratchpad · ${file.path}`,
        path: agentPath(file.agentId),
        found: true,
      });
    out.push(
      { id: 'command:new-agent', kind: 'command', title: 'New agent', run: () => onNavigate('/agents/new') },
      { id: 'command:new-group', kind: 'command', title: 'New group', run: () => onNavigate('/chat/groups/new') },
      { id: 'command:new-computer', kind: 'command', title: 'New computer', run: () => onNavigate('/computers/new') },
    );
    return out;
  }, [
    agents,
    busy,
    groups.data,
    computers.data,
    terminals.map(item => item.dataUpdatedAt).join(),
    knowledge.data,
    files.data,
  ]);

  const input = `${prefix?.prefix ?? ''}${text}`;
  const results = useMemo(() => search(items, input), [items, input]);
  const flat = results.flatMap(group => group.items);
  const current = flat.find(item => item.id === selected) ?? flat[0];
  // The best result is highlighted again whenever the search, or what is best, changes (results arrive late).
  useEffect(() => setSelected(flat[0]?.id ?? ''), [input, open, flat[0]?.id]);

  const go = (item: PortalItem) => {
    if (!item.path) return;
    onOpenChange(false);
    onNavigate(item.path);
  };
  const enter = (item: PortalItem) => {
    if (item.run) {
      onOpenChange(false);
      void item.run();
      return;
    }
    if (!item.float || phone) return go(item);
    const row = list.current?.querySelector(`[data-portal-id="${CSS.escape(item.id)}"]`)?.getBoundingClientRect();
    openWindow(item.float, item.title, row ? { x: row.left + row.width / 2, y: row.top + row.height / 2 } : null);
    onOpenChange(false);
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.shiftKey && current) {
      // Shift+Enter always goes to the page (cmdk would treat it as Enter).
      event.preventDefault();
      go(current);
    } else if (event.key === 'Backspace' && !text && prefix) {
      event.preventDefault();
      setPrefix(undefined);
    }
  };
  const type = (value: string) => {
    // A prefix typed first becomes a chip.
    const parsed = !prefix ? parseQuery(value) : undefined;
    if (parsed?.prefix && value.length >= 1 && PREFIXES.some(item => item.prefix === value[0])) {
      setPrefix(parsed.prefix);
      setText(value.slice(1));
    } else setText(value);
  };
  const action = current ? (phone && current.float ? 'go to' : enterAction(current)) : 'open';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="portal-scrim fixed inset-0 z-50 motion-safe:data-[state=open]:animate-[fade-in_160ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_120ms_ease-in]" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={keys}
          className="portal-glass fixed left-1/2 top-[max(0.75rem,12dvh)] z-50 flex max-h-[min(75dvh,32rem)] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 origin-top flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/60 motion-safe:data-[state=open]:animate-[portal-in_200ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[portal-out_120ms_ease-in]"
        >
          <Dialog.Title className="sr-only">Portal</Dialog.Title>
          <Command
            label="Portal"
            shouldFilter={false}
            value={current?.id ?? ''}
            onValueChange={setSelected}
            loop
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-4">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              {prefix && (
                <button
                  type="button"
                  onClick={() => setPrefix(undefined)}
                  aria-label={`Searching ${prefix.label}; remove`}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-mono text-muted-foreground">{prefix.prefix}</span>
                  {prefix.label}
                </button>
              )}
              <Command.Input
                autoFocus
                value={text}
                onValueChange={type}
                placeholder={prefix ? `Search ${prefix.label.toLowerCase()}…` : 'Open, go to or run anything…'}
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
              />
            </div>
            {!prefix && !text && (
              <div className="flex flex-wrap gap-1.5 border-b border-white/10 px-3 py-2.5" aria-label="Search in">
                {PREFIXES.map(item => (
                  <button
                    key={item.prefix}
                    type="button"
                    onClick={() => setPrefix(item)}
                    className="flex min-h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 text-xs outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                  >
                    <span className="font-mono text-muted-foreground">{item.prefix}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            <Command.List ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
                {files.isFetching || knowledge.isFetching ? 'Searching…' : 'Nothing found.'}
              </Command.Empty>
              {results.map(group => (
                <Command.Group
                  key={group.kind}
                  heading={group.heading}
                  className="py-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {group.items.map(item => {
                    const agent = item.kind === 'agent' ? agents.find(a => `agent:${a.id}` === item.id) : undefined;
                    return (
                      <Command.Item
                        key={item.id}
                        value={item.id}
                        data-portal-id={item.id}
                        onSelect={() => enter(item)}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none select-none transition-colors duration-100 data-[selected=true]:bg-white/10 motion-reduce:transition-none sm:min-h-10"
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                          {agent ? (
                            <AgentAvatarArt {...(agent.avatar ?? defaultAvatar(agent.id))} size={22} />
                          ) : (
                            icons[item.kind]
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.title}</span>
                          {item.subtitle && (
                            <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                          )}
                        </span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
          <footer className="flex shrink-0 items-center gap-4 border-t border-white/10 px-4 py-2 text-[11px] text-muted-foreground max-sm:hidden">
            <Hint keys="↵">{action}</Hint>
            {current?.path && action !== 'go to' && <Hint keys="⇧↵">go to</Hint>}
            <Hint keys="esc">close</Hint>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-px font-sans text-[10px] text-foreground">
        {keys}
      </kbd>
      {children}
    </span>
  );
}

/** The header's way into Portal (and the only one on a phone), with the shortcut beside it. */
export function PortalButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open Portal"
      aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        className,
      )}
    >
      <SearchIcon className="size-4" />
      <span className="max-md:sr-only">Portal</span>
      <kbd className="rounded border border-border px-1 font-sans text-[10px] max-md:hidden">{portalShortcut}</kbd>
    </button>
  );
}
