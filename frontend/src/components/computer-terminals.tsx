import { TerminalTypist } from './terminal-typist';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ConfirmDialog } from './confirm-dialog';
import { NewTerminalDialog } from './new-terminal-dialog';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ChevronLeftIcon, PlusIcon, TrashIcon } from '@/components/ui/icons';
import { backLink } from '@/lib/styles';
import { m } from 'motion/react';
import { glide } from '@/lib/motion';
import { computerTerminal, type TerminalRequest, type TerminalResult } from '@/lib/computer-terminals';
import type { Computer } from './computer-card';
import { dialogMotion, dialogOverlay } from '@/lib/styles';
const TerminalEmulator = lazy(() =>
  import('./terminal-emulator').then(module => ({ default: module.TerminalEmulator })),
);

/** Window sizes offered for a session (columns × rows); the guest accepts 40..240 × 10..80. */
const terminalSizes = [
  [80, 24, 'Classic'],
  [100, 30, 'Medium'],
  [120, 36, 'Default'],
  [160, 48, 'Large'],
  [200, 50, 'Wide'],
] as const;

const exitText = (item: { exitCode: number | null; exitSignal?: string | null }) =>
  `exited${item.exitCode !== null ? ` (${item.exitCode})` : item.exitSignal ? ` (${item.exitSignal})` : ''}`;

/**
 * The terminal workspace: session tabs, the new-terminal form and the live console. Used by the Terminals dialog
 * and by the desktop viewer's Terminal view, so both behave the same.
 */
export function TerminalWorkspace({
  computer,
  connected,
  active,
  initialSession = null,
  onSessionChange,
}: {
  computer: Computer;
  connected: boolean;
  /** Session to show first (from the address in the viewer). */
  initialSession?: string | null;
  /** Reports the shown session so the viewer can keep it in the address. */
  onSessionChange?: (session: string | null) => void;
  /** Mounted and on screen: polls the session list and attaches the console only while true. */
  active: boolean;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(initialSession);
  const reportSession = useRef(onSessionChange);
  reportSession.current = onSessionChange;
  useEffect(() => reportSession.current?.(selected), [selected]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Phones show the list first and one session at a time; wider screens show both.
  const [phoneDetail, setPhoneDetail] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Rename opens an inline field; the menu must not hand focus back to the row as it closes.
  const renameField = useRef<HTMLInputElement>(null);
  const focusRename = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const available = connected && computer.state === 'running';
  // Keyed by computer only and keeping the previous list: choosing a terminal or a background poll must never blank the panel.
  const queryKey = ['computer-terminals', computer.id];
  const query = useQuery({
    queryKey,
    enabled: active && available && !busy,
    retry: false,
    gcTime: 0,
    placeholderData: keepPreviousData,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const list = await computerTerminal(computer.id, { operation: 'list' }, signal);
      return { sessions: list.sessions ?? [] };
    },
  });
  const sessions = query.data?.sessions ?? [];
  const session = sessions.find(item => item.id === selected);
  const showDetail = phoneDetail || Boolean(session);
  // A background refresh must not disable the controls: a click that lands mid-poll would be silently dropped.
  const actionable = available && !busy && !query.isError && session?.id === selected;
  useEffect(() => {
    if (active && selected === null && sessions[0] && window.matchMedia('(min-width: 768px)').matches)
      setSelected(sessions[0].id);
  }, [active, selected, sessions]);
  useEffect(() => {
    setDeleting(false);
  }, [selected]);
  useEffect(() => {
    if (!active || !available) {
      void client.cancelQueries({ queryKey: ['computer-terminals', computer.id] });
      setCreating(false);
      setDeleting(false);
      setError('');
      setNotice('');
    }
  }, [active, available, computer.id, client]);
  const act = async (body: TerminalRequest, done?: (value: TerminalResult) => void) => {
    if (inFlight.current || !available) return false;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await computerTerminal(computer.id, body);
      done?.(result);
      setNotice(body.operation === 'interrupt' ? 'Ctrl+C sent; inspect the output to confirm.' : 'Request accepted.');
      await client.invalidateQueries({ queryKey: ['computer-terminals', computer.id] });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terminal request failed. Inspect before retrying.');
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!available ? (
        <p role="status" className="p-5 text-sm text-muted-foreground">
          Computer unavailable. Reconnect or power it on before using terminals.
        </p>
      ) : (
        // List of sessions on the left, the selected console centered in the main area (list → detail on phones).
        <div className="flex min-h-0 min-w-0 flex-1">
          <aside
            className={`min-h-0 w-full shrink-0 flex-col border-border md:flex md:w-56 md:border-r ${showDetail ? 'hidden' : 'flex'}`}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sessions</h3>
              <Button
                variant="outline"
                size="sm"
                aria-label="New terminal"
                title="New terminal"
                className="size-10 shrink-0 p-0 md:size-8"
                disabled={busy}
                onClick={() => {
                  setCreating(true);
                  setDeleting(false);
                  setError('');
                }}
              >
                <PlusIcon />
              </Button>
            </div>
            <div
              role="tablist"
              aria-label="Terminal sessions"
              aria-orientation="vertical"
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3"
            >
              {query.isPending && <p className="px-2 py-2 text-xs text-muted-foreground">Loading terminals…</p>}
              {query.isError && (
                <p role="alert" className="px-2 py-2 text-xs text-red-400">
                  Session list unavailable: {query.error.message}
                </p>
              )}
              {query.isSuccess && !sessions.length && (
                <p className="px-2 py-2 text-xs text-muted-foreground">No terminals yet. Use + to start one.</p>
              )}
              {sessions.map(item => {
                const on = item.id === selected;
                return (
                  // Right-click (or long-press / Shift+F10) a session for its settings.
                  <ContextMenu.Root key={item.id}>
                    <ContextMenu.Trigger asChild disabled={busy}>
                      <div className="group relative">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={on}
                          title={item.cwd}
                          disabled={busy}
                          onClick={() => {
                            setSelected(item.id);
                            setCreating(false);
                            setPhoneDetail(true);
                            setNotice('');
                            setError('');
                          }}
                          className={`relative isolate flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 pr-10 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-0 ${on ? 'text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}`}
                        >
                          {on && (
                            <m.span
                              aria-hidden="true"
                              layoutId={`terminal-session-${computer.id}`}
                              transition={glide}
                              className="absolute inset-0 -z-10 rounded-lg bg-foreground/10"
                            />
                          )}
                          <span
                            aria-hidden="true"
                            className={`size-2 shrink-0 rounded-full ${item.alive ? 'bg-teal-400' : 'bg-muted-foreground/50'}`}
                          />
                          <span className="min-w-0 flex-1">
                            {renaming === item.id ? (
                              <input
                                ref={renameField}
                                aria-label="Terminal name"
                                defaultValue={item.name}
                                maxLength={48}
                                pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-){0,47}"
                                onClick={event => event.stopPropagation()}
                                onKeyDown={event => {
                                  event.stopPropagation();
                                  if (event.key === 'Escape') setRenaming(null);
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    const next = event.currentTarget.value.trim();
                                    setRenaming(null);
                                    if (next && next !== item.name)
                                      void act({ operation: 'rename', session: item.id, name: next });
                                  }
                                }}
                                onBlur={() => setRenaming(null)}
                                className="w-full rounded border border-ring bg-background px-1 font-mono text-xs text-foreground outline-none"
                              />
                            ) : (
                              <span className="block truncate font-mono text-xs">{item.name}</span>
                            )}
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {item.alive ? (item.currentCommand ?? 'running') : exitText(item)} · {item.columns}×
                              {item.rows}
                            </span>
                          </span>
                          <span className="sr-only">{item.alive ? ' (running)' : ` (${exitText(item)})`}</span>
                        </button>
                        {on && (
                          <button
                            type="button"
                            aria-label="Delete terminal"
                            title="Delete terminal"
                            disabled={!actionable}
                            onClick={() => setDeleting(true)}
                            className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                          >
                            <TrashIcon className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content
                        className="context-menu-content phone-menu-targets z-[60] min-w-52 rounded-lg border border-border bg-background p-1 text-sm ao-top shadow-lg"
                        aria-label={`Settings for ${item.name}`}
                        onCloseAutoFocus={event => {
                          if (!focusRename.current) return;
                          focusRename.current = false;
                          event.preventDefault();
                          requestAnimationFrame(() => renameField.current?.select());
                        }}
                      >
                        <ContextMenu.Item
                          className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 md:min-h-0"
                          onSelect={() => {
                            focusRename.current = true;
                            setRenaming(item.id);
                          }}
                        >
                          Rename…
                        </ContextMenu.Item>
                        <ContextMenu.Sub>
                          <ContextMenu.SubTrigger className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 md:min-h-0 justify-between data-[state=open]:bg-muted">
                            Window size
                            <span className="text-xs text-muted-foreground">
                              {item.columns} × {item.rows}
                            </span>
                          </ContextMenu.SubTrigger>
                          <ContextMenu.Portal>
                            <ContextMenu.SubContent
                              className="context-menu-content z-[60] min-w-44 rounded-lg border border-border bg-background p-1 text-sm ao-top shadow-lg"
                              sideOffset={4}
                            >
                              <ContextMenu.RadioGroup
                                value={`${item.columns}x${item.rows}`}
                                onValueChange={value => {
                                  const [columns, rows] = value.split('x').map(Number);
                                  void act({ operation: 'resize', session: item.id, columns, rows });
                                }}
                              >
                                {terminalSizes.map(([columns, rows, label]) => (
                                  <ContextMenu.RadioItem
                                    key={label}
                                    value={`${columns}x${rows}`}
                                    className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 md:min-h-0 pl-7 relative"
                                  >
                                    <ContextMenu.ItemIndicator className="absolute left-2.5 size-1.5 rounded-full bg-foreground" />
                                    <span className="flex-1">{label}</span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {columns}×{rows}
                                    </span>
                                  </ContextMenu.RadioItem>
                                ))}
                              </ContextMenu.RadioGroup>
                            </ContextMenu.SubContent>
                          </ContextMenu.Portal>
                        </ContextMenu.Sub>
                        <ContextMenu.Separator className="my-1 h-px bg-border" />
                        <ContextMenu.Item
                          className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 md:min-h-0 text-red-400"
                          onSelect={() => {
                            setSelected(item.id);
                            setCreating(false);
                            setDeleting(true);
                          }}
                        >
                          Delete terminal…
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                );
              })}
            </div>
          </aside>
          <div className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${showDetail ? 'flex' : 'hidden'}`}>
            <button
              type="button"
              onClick={() => {
                setPhoneDetail(false);
                setCreating(false);
                setSelected(null);
              }}
              className={`${backLink} ml-1 mt-1 self-start md:hidden`}
            >
              <ChevronLeftIcon />
              Sessions
            </button>
            {selected && query.isSuccess && sessions.length > 0 && !sessions.some(item => item.id === selected) && (
              <p role="status" className="m-auto text-sm text-muted-foreground">
                This terminal was deleted. Select another terminal.
              </p>
            )}
            {!session && query.isSuccess && !sessions.length && (
              <p className="m-auto text-sm text-muted-foreground">No terminals yet. Create one to start.</p>
            )}
            {session && (
              <div className="flex min-h-60 min-w-0 flex-1 flex-col pt-2">
                {!session.alive && (
                  <p role="status" className="px-1 pb-1 text-center text-xs text-muted-foreground">
                    {session.name} has {exitText(session)}. Its last output stays below; start a new terminal to run
                    more.
                  </p>
                )}
                {active && available && (
                  <Suspense
                    fallback={
                      <p role="status" className="p-3 text-sm">
                        Loading terminal…
                      </p>
                    }
                  >
                    <TerminalEmulator
                      key={session.id}
                      computerId={computer.id}
                      badge={<TerminalTypist computerId={computer.id} session={session.id} />}
                      onClosed={() => void client.invalidateQueries({ queryKey })}
                      sessionId={session.id}
                      columns={session.columns}
                      rows={session.rows}
                      interactive={session.alive && !busy && !creating && !deleting}
                      title={`${session.name}${session.cwd ? ` — ${session.cwd}` : ''}`}
                    />
                  </Suspense>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {(error || busy || notice) && (
        <div role="status" className="shrink-0 px-3 pb-2 text-xs [overflow-wrap:anywhere] sm:px-5">
          {error ? <span className="text-red-400">{error} Do not resend blindly.</span> : busy ? 'Sending…' : notice}
        </div>
      )}
      {/* New terminal opens as its own modal over the Terminals window, like the app's other create dialogs. */}
      <NewTerminalDialog
        open={creating}
        onOpenChange={setCreating}
        busy={busy}
        onSubmit={body =>
          act(body, result => {
            if (result.session) setSelected(result.session.id);
            setCreating(false);
          })
        }
      />
      <ConfirmDialog
        open={deleting && Boolean(session)}
        onOpenChange={setDeleting}
        title="Delete terminal"
        description={
          <>Delete “{session?.name}”? This stops the session and discards its output; programs running in it end.</>
        }
        confirmLabel="Delete terminal"
        busyLabel="Deleting…"
        onConfirm={async () => {
          if (!session || !(await act({ operation: 'delete', session: session.id }, () => setSelected(null))))
            throw new Error('Could not delete the terminal. Inspect it before retrying.');
        }}
      />
    </div>
  );
}

/** Retains the Kibo dialog shell; a trusted fixed-size xterm renders the guest PTY stream. */
export function ComputerTerminals({
  computer,
  open,
  connected,
  onOpenChange,
}: {
  computer: Computer;
  open: boolean;
  connected: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          onEscapeKeyDown={event => {
            if ((event.target as HTMLElement)?.closest('[data-terminal-emulator]')) event.preventDefault();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            document
              .querySelector<HTMLElement>(
                `[data-computer-id="${CSS.escape(computer.id)}"] button[aria-label^="Actions for"]`,
              )
              ?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(90dvh,52rem)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background ao-card shadow-xl motion-safe:data-[state=open]:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)] motion-safe:data-[state=closed]:animate-[dialog-out_130ms_ease-in] sm:w-[calc(100%-2rem)]"
        >
          <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <Dialog.Title className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
                Terminals · {computer.name}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="flat" size="sm" className="size-10 shrink-0 p-0" aria-label="Close terminals">
                  ×
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-1 text-xs text-muted-foreground">
              Shared tmux sessions. Closing this view or releasing control leaves programs running. Powering off ends
              them.
            </Dialog.Description>
          </header>
          <TerminalWorkspace computer={computer} connected={connected} active={open} />
          <footer className="flex min-w-0 shrink-0 items-center justify-end gap-3 border-t border-border px-3 py-3 sm:px-5">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm" className="min-h-10">
                Close
              </Button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
