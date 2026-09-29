import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRetained } from '@/lib/use-retained';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ComputerIcon } from '@/components/ui/icons';
import { randomUuid } from '@/lib/random-uuid';
import { generateComputerName } from '@/lib/computer-name';
import { defaultComputerSettings, parseComputerSettings, type ComputerSettingsDraft } from '@/lib/computer-settings';
import { ComputerCard, type Computer } from './computer-card';
import { ComputerViewer } from './computer-viewer';
import { ComputerResourceFields } from './computer-resource-fields';
import { ComputerFileBrowser } from './computer-file-browser';
import { ComputerTerminals } from './computer-terminals';
import { ConfirmDialog } from './confirm-dialog';
import { PageHeader } from './page-header';
import type { ComputerAgentState } from './computer-control';
import { computerPath } from '@/lib/dashboard-location';
import { computersQuery } from '@/lib/computers-query';
import { dialogOverlay } from '@/lib/styles';
type ComputerList = { computers: Computer[] };

function MenuIcon({ path, label }: { path: string; label: string }) {
  return (
    <svg
      aria-hidden="true"
      role="img"
      aria-label={label}
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

function ComputerDialog({ children }: { children: ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className={dialogOverlay} />
      <Dialog.Content className="computer-dialog fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl">
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function ComputersPanel({
  viewingId,
  viewerView,
  terminalId,
  dialog,
  deleteId,
  settingsId,
  onOpen,
  onNavigate,
  onBack,
  agentState,
}: {
  agentState?: ComputerAgentState;
  viewingId: string | null;
  viewerView: 'desktop' | 'terminal';
  terminalId: string | null;
  dialog: 'new' | 'delete' | 'settings' | null;
  deleteId: string | null;
  settingsId: string | null;
  onOpen: (id: string) => void;
  onNavigate: (path: string, options?: { replace?: boolean }) => void;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const query = useQuery({
    ...computersQuery,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const computers = query.data?.computers ?? [];
  const limitsQuery = useQuery({
    queryKey: ['computer-settings-limits'],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/computers/settings-limits', { signal });
      if (!data || error) throw new Error(error?.message ?? 'Could not detect computer limits.');
      return data;
    },
    enabled: Boolean(query.data?.controllerConnected),
    staleTime: 60_000,
  });
  const maxComputers = limitsQuery.data?.maxComputers;
  const counted = computers.filter(computer => computer.state !== 'failed').length; // failed records have no container
  const atLimit = maxComputers !== undefined && counted >= maxComputers;
  const createOpen = dialog === 'new';
  const [name, setName] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<ComputerSettingsDraft | null>(null);
  const [editDraft, setEditDraft] = useState<ComputerSettingsDraft | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const suggestedSettings = limitsQuery.data ? defaultComputerSettings(limitsQuery.data) : null;
  const formSettings = settingsDraft ?? suggestedSettings;
  const parsedSettings =
    formSettings && limitsQuery.data ? parseComputerSettings(formSettings, limitsQuery.data) : null;
  const suggestion = useRef<string | null>(null);
  const alignedToRoster = useRef(false);
  // A default suggestion is generated locally, then aligned once with the live
  // roster; the backend still rejects any duplicate name authoritatively.
  const suggestName = () => {
    const previous = suggestion.current;
    const taken = new Set(computers.map(computer => computer.name));
    if (previous) taken.add(previous);
    suggestion.current = generateComputerName(taken);
    return suggestion.current;
  };
  useEffect(() => {
    if (alignedToRoster.current) return;
    if (query.data) alignedToRoster.current = true;
    else if (suggestion.current) return;
    const previous = suggestion.current;
    const next = suggestName();
    setName(current => (!current.trim() || current === previous ? (next ?? current) : current));
  }, [query.data]);

  const [requestKey, setRequestKey] = useState(randomUuid);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const selected = dialog === 'delete' ? (computers.find(computer => computer.id === deleteId) ?? null) : null;
  const settingsComputer =
    dialog === 'settings' ? (computers.find(computer => computer.id === settingsId) ?? null) : null;
  // While a dialog animates closed it keeps showing its computer, instead of emptying at once.
  const shownDelete = useRetained(selected, selected !== null);
  const shownSettings = useRetained(settingsComputer, settingsComputer !== null);
  const editSettings =
    editDraft ??
    (settingsComputer && limitsQuery.data
      ? {
          cpuCores: String(settingsComputer.cpuCores ?? limitsQuery.data.cpuCores.default),
          memoryGiB: String(settingsComputer.memoryGiB ?? limitsQuery.data.memoryGiB.default),
          timezone: settingsComputer.timezone ?? limitsQuery.data.timezoneDefault,
        }
      : null);
  const parsedEdit = editSettings && limitsQuery.data ? parseComputerSettings(editSettings, limitsQuery.data) : null;
  const timezoneChanged = Boolean(
    settingsComputer && editSettings && editSettings.timezone !== settingsComputer.timezone,
  );
  const viewing = computers.find(computer => computer.id === viewingId);
  const focusGridTab = useRef(false);
  useEffect(() => {
    if (viewingId !== null || !focusGridTab.current) return;
    focusGridTab.current = false;
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [viewingId]);
  const [confirmation, setConfirmation] = useState('');
  const [powerBusy, setPowerBusy] = useState(false);
  const [powerError, setPowerError] = useState('');
  const [powerOffTarget, setPowerOffTarget] = useState<Computer | null>(null);
  const holders = useQuery({
    queryKey: ['computer-control'],
    enabled: powerOffTarget !== null,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET('/api/computers/control', { signal });
      return data?.holders ?? [];
    },
  });
  const [menuTarget, setMenuTarget] = useState<Computer | null>(null);
  const [filesTarget, setFilesTarget] = useState<Computer | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [terminalsTarget, setTerminalsTarget] = useState<Computer | null>(null);
  const [terminalsOpen, setTerminalsOpen] = useState(false);
  const terminalsComputer = computers.find(computer => computer.id === terminalsTarget?.id) ?? terminalsTarget;
  const filesComputer = computers.find(computer => computer.id === filesTarget?.id) ?? filesTarget;
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const createId = useId();
  const confirmId = useId();

  const refresh = () => void client.invalidateQueries({ queryKey: ['computers'] });
  const submitCreate = async () => {
    const requested = name.trim();
    // !createOpen blocks a stray submit that lands on the dialog's exiting
    // (still-mounted, aria-modal) button during the close animation, which is
    // the only accessible "Create computer" match for a moment after Cancel.
    if (createBusy || !requested || !createOpen || !parsedSettings) return;
    const usedSuggestion = requested === suggestion.current;
    setCreateBusy(true);
    setCreateError('');
    try {
      const result = await api.POST('/api/computers', { body: { name: requested, requestKey, ...parsedSettings } });
      if (!result.data || result.error) throw new Error(result.error?.message ?? 'Could not create the computer.');
      client.setQueryData<ComputerList>(['computers'], previous => ({
        computers: [...(previous?.computers ?? []).filter(item => item.id !== result.data!.id), result.data!],
      }));
      // A consumed default must not linger: it is now a taken name. suggestName
      // still sees it as the previous suggestion, so the replacement avoids it.
      if (usedSuggestion) setName(suggestName() ?? '');
      else {
        suggestion.current = null;
        setName('');
      }
      alignedToRoster.current = true;
      onBack();
      refresh();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create the computer.');
      // An unedited suggestion is disposable: offer a fresh name so retrying is one click.
      if (requested === suggestion.current) setName(suggestName() ?? name);
    } finally {
      setCreateBusy(false);
    }
  };
  const submitSettings = async () => {
    if (
      !settingsComputer ||
      !parsedEdit ||
      settingsBusy ||
      (timezoneChanged && (settingsComputer.state !== 'exited' || !replaceConfirmed))
    )
      return;
    setSettingsBusy(true);
    setSettingsError('');
    try {
      const result = timezoneChanged
        ? await api.POST('/api/computers/{id}/settings/replacement', {
            params: { path: { id: settingsComputer.id } },
            body: { ...parsedEdit, confirmReplacement: true },
          })
        : await api.PATCH('/api/computers/{id}/settings', {
            params: { path: { id: settingsComputer.id } },
            body: parsedEdit,
          });
      if (!result.data || result.error) throw new Error(result.error?.message ?? 'Could not update computer settings.');
      client.setQueryData<ComputerList>(['computers'], previous => ({
        computers: (previous?.computers ?? []).map(item => (item.id === settingsComputer.id ? result.data! : item)),
      }));
      onBack();
      refresh();
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Could not update computer settings.');
    } finally {
      setSettingsBusy(false);
    }
  };
  const submitDelete = async () => {
    if (!selected || deleteBusy || confirmation !== selected.name) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const result = await api.DELETE('/api/computers/{id}', {
        params: { path: { id: selected.id } },
        body: { confirmation },
      });
      if (!result.data || result.error) throw new Error(result.error?.message ?? 'Could not delete the computer.');
      client.setQueryData<ComputerList>(['computers'], previous => ({
        computers: (previous?.computers ?? []).filter(item => item.id !== selected.id),
      }));
      onBack();
      refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete the computer.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const submitPower = async (computer: Computer, action: 'start' | 'stop') => {
    if (powerBusy) return;
    setPowerBusy(true);
    setPowerError('');
    try {
      const result = await api.POST('/api/computers/{id}/power', {
        params: { path: { id: computer.id } },
        body: { action },
      });
      if (!result.data || result.error)
        throw new Error(result.error?.message ?? 'Could not change the computer power state.');
      refresh();
    } catch (error) {
      setPowerError(error instanceof Error ? error.message : 'Could not change the computer power state.');
    } finally {
      setPowerBusy(false);
    }
  };

  return (
    <section aria-label="Computers" className="flex min-h-0 w-full flex-col">
      {viewing ? (
        <ComputerViewer
          key={viewing.id}
          computer={viewing}
          agentState={agentState}
          canManage={Boolean(query.data?.controllerConnected)}
          onBack={() => {
            focusGridTab.current = true;
            onBack();
          }}
          onOpenComputer={onOpen}
          view={viewerView}
          terminalId={terminalId}
          onRoute={(path: string) => onNavigate(path, { replace: true })}
        />
      ) : (viewingId || (dialog === 'delete' && !selected) || (dialog === 'settings' && !settingsComputer)) &&
        query.isSuccess ? (
        <div className="p-6 text-sm" role="alert">
          Computer not found.{' '}
          <button type="button" className="cursor-pointer underline" onClick={onBack}>
            Return to computers
          </button>
        </div>
      ) : (
        <>
          <PageHeader
            title="Computers"
            description={
              <>
                Containerized Ubuntu desktops
                {maxComputers !== undefined && (
                  <>
                    {' '}
                    ·{' '}
                    <span data-testid="computer-cap">
                      {counted} of {maxComputers}
                    </span>{' '}
                    in use
                  </>
                )}
              </>
            }
            action={
              <Dialog.Root
                open={createOpen}
                onOpenChange={open => {
                  if (createBusy) return;
                  if (open) {
                    const previous = suggestion.current;
                    if (!name.trim() || name === previous) setName(suggestName() ?? name);
                    setRequestKey(randomUuid());
                    setCreateError('');
                    setSettingsDraft(null);
                    onNavigate('/computers/new');
                  } else onBack();
                }}
              >
                <Dialog.Trigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!query.data?.controllerConnected || atLimit}
                    title={
                      atLimit ? `Limit reached (${maxComputers}). Delete a computer to create another.` : undefined
                    }
                    className="min-h-11 md:min-h-0"
                  >
                    Create computer
                  </Button>
                </Dialog.Trigger>
                <ComputerDialog>
                  <form
                    onSubmit={event => {
                      event.preventDefault();
                      void submitCreate();
                    }}
                  >
                    <Dialog.Title className="text-lg font-semibold">Create computer</Dialog.Title>
                    <Dialog.Description className="mt-2 text-sm text-muted-foreground">
                      Create a separate Ubuntu desktop with a persistent home and workspace.
                    </Dialog.Description>
                    <label htmlFor={createId} className="mt-5 block text-sm font-medium">
                      Computer name
                    </label>
                    <input
                      id={createId}
                      autoFocus
                      maxLength={80}
                      value={name}
                      disabled={createBusy}
                      onChange={event => setName(event.target.value)}
                      className="mt-2 h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-10 sm:text-sm"
                    />
                    {limitsQuery.isError && (
                      <p role="alert" className="mt-4 text-sm text-red-400">
                        {limitsQuery.error.message}{' '}
                        <button
                          type="button"
                          className="cursor-pointer underline"
                          onClick={() => void limitsQuery.refetch()}
                        >
                          Retry
                        </button>
                      </p>
                    )}
                    {!limitsQuery.isError && !limitsQuery.data && (
                      <p role="status" className="mt-4 text-sm text-muted-foreground">
                        Detecting host limits…
                      </p>
                    )}
                    {limitsQuery.data && formSettings && (
                      <ComputerResourceFields
                        limits={limitsQuery.data}
                        value={formSettings}
                        onChange={setSettingsDraft}
                        disabled={createBusy}
                      />
                    )}
                    {createError && (
                      <p role="alert" className="mt-4 text-sm text-red-400">
                        {createError}
                      </p>
                    )}
                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Dialog.Close asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11 sm:min-h-0"
                          disabled={createBusy}
                        >
                          Cancel
                        </Button>
                      </Dialog.Close>
                      <Button
                        type="submit"
                        size="sm"
                        className="min-h-11 sm:min-h-0"
                        disabled={createBusy || !name.trim() || !parsedSettings}
                      >
                        {createBusy ? 'Creating…' : 'Create computer'}
                      </Button>
                    </div>
                  </form>
                </ComputerDialog>
              </Dialog.Root>
            }
          />
          {/* Right-click on a card acts on that computer; anywhere else on the page offers page actions. */}
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <div
                className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6"
                onContextMenuCapture={event => {
                  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-computer-id]');
                  setMenuTarget(computers.find(computer => computer.id === card?.dataset.computerId) ?? null);
                }}
              >
                {query.isPending && (
                  <div
                    role="status"
                    aria-label="Loading computers…"
                    className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4 md:gap-5"
                  >
                    {[0, 1].map(index => (
                      <div key={index} className="overflow-hidden rounded-xl border border-border bg-sidebar">
                        <Skeleton
                          className="aspect-video rounded-none"
                          style={{ animationDelay: `${index * 120}ms` }}
                        />
                        <div className="space-y-3 p-3">
                          <Skeleton className="h-4 w-2/3" />
                          <Skeleton className="h-8 w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {query.isError && (
                  <div role="alert" className="space-y-3 text-sm">
                    <p>{query.error.message}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                      Retry loading computers
                    </Button>
                  </div>
                )}
                {query.isSuccess && !query.data.controllerConnected && (
                  <p
                    role="status"
                    className="mb-4 rounded-lg border border-border bg-sidebar p-3 text-sm text-muted-foreground"
                  >
                    Computer management is offline. Saved computers remain visible; creation, deletion and previews are
                    unavailable.
                  </p>
                )}
                {query.isSuccess && query.data.controllerConnected && computers.length === 0 && (
                  <Empty role="status">
                    <EmptyHeader>
                      <EmptyMedia>
                        <ComputerIcon />
                      </EmptyMedia>
                      <EmptyTitle>No computers yet</EmptyTitle>
                      {/* The page header already carries Create computer; a second copy here would compete with it. */}
                      <EmptyDescription>Use Create computer above to get started.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
                {powerError && (
                  <p role="alert" className="mb-4 text-sm text-red-400">
                    {powerError}
                  </p>
                )}
                {computers.length > 0 && (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4 md:gap-5">
                    {computers.map((computer, index) => (
                      <ComputerCard
                        key={computer.id}
                        index={index}
                        computer={computer}
                        canManage={Boolean(query.data?.controllerConnected)}
                        onOpen={target => onOpen(target.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content
                className="context-menu-content phone-menu-targets z-50 min-w-56 rounded-lg border border-border bg-background p-1 text-sm shadow-lg"
                onCloseAutoFocus={event => {
                  if (createOpen || selected !== null || settingsComputer !== null || filesOpen || terminalsOpen)
                    event.preventDefault();
                }}
              >
                {menuTarget ? (
                  <>
                    <ContextMenu.Item
                      disabled={!menuTarget || menuTarget.state !== 'running' || !query.data?.controllerConnected}
                      onSelect={() => {
                        if (menuTarget) onOpen(menuTarget.id);
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                    >
                      <MenuIcon path="M3 5.5h18v13H3zM8 21h8" label="Open desktop" />
                      Open
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      disabled={
                        !menuTarget ||
                        !query.data?.controllerConnected ||
                        (menuTarget.state !== 'running' && menuTarget.state !== 'exited') ||
                        powerBusy
                      }
                      onSelect={() => {
                        if (!menuTarget) return;
                        if (menuTarget.state === 'running') setPowerOffTarget(menuTarget);
                        else void submitPower(menuTarget, 'start');
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                    >
                      <MenuIcon path="M12 3v9M6.5 6.5a8 8 0 1 0 11 0" label="Power" />
                      {menuTarget?.state === 'running' ? 'Power off' : 'Power on'}
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      disabled={
                        !menuTarget || menuTarget.state !== 'running' || !query.data?.controllerConnected || powerBusy
                      }
                      onSelect={() => {
                        if (menuTarget) {
                          setFilesTarget(menuTarget);
                          setFilesOpen(true);
                        }
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                    >
                      <MenuIcon path="M3 7h6l2 2h10v10H3zM8 13h8" label="Files" />
                      File browser
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      disabled={
                        !menuTarget || menuTarget.state !== 'running' || !query.data?.controllerConnected || powerBusy
                      }
                      onSelect={() => {
                        if (menuTarget) {
                          setTerminalsTarget(menuTarget);
                          setTerminalsOpen(true);
                        }
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                    >
                      <MenuIcon path="m4 6 6 6-6 6M13 18h7" label="Terminal" />
                      Terminals
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      disabled={
                        !menuTarget ||
                        !query.data?.controllerConnected ||
                        (menuTarget.state !== 'running' && menuTarget.state !== 'exited')
                      }
                      onSelect={() => {
                        setEditDraft(null);
                        setSettingsError('');
                        setReplaceConfirmed(false);
                        if (menuTarget) onNavigate(`${computerPath(menuTarget.id)}/settings`);
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                    >
                      <MenuIcon
                        path="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8M12 2.4v2.4M12 19.2v2.4M4.6 7.8l2 1.2M17.4 15l2 1.2M4.6 16.2l2-1.2M17.4 9l2-1.2M2.4 12h2.4M19.2 12h2.4"
                        label="Settings"
                      />
                      Settings
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="my-1 h-px bg-border" />
                    <div className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Danger zone
                    </div>
                    <ContextMenu.Item
                      disabled={!menuTarget || !query.data?.controllerConnected}
                      onSelect={() => {
                        setConfirmation('');
                        setDeleteError('');
                        if (menuTarget) onNavigate(`${computerPath(menuTarget.id)}/delete`);
                      }}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-red-400 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                    >
                      <MenuIcon path="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" label="Remove" />
                      Remove
                    </ContextMenu.Item>
                  </>
                ) : (
                  <>
                    <ContextMenu.Item
                      disabled={!query.data?.controllerConnected}
                      onSelect={() => onNavigate('/computers/new')}
                      className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                    >
                      <MenuIcon path="M12 5v14M5 12h14" label="New" />
                      New computer
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      onSelect={() => void query.refetch()}
                      className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                    >
                      <MenuIcon path="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" label="Refresh" />
                      Refresh
                    </ContextMenu.Item>
                  </>
                )}
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        </>
      )}
      <Dialog.Root
        open={settingsComputer !== null}
        onOpenChange={open => {
          if (!open && !settingsBusy) {
            setEditDraft(null);
            onBack();
          }
        }}
      >
        {shownSettings && (
          <ComputerDialog>
            <form
              onSubmit={event => {
                event.preventDefault();
                void submitSettings();
              }}
            >
              <Dialog.Title className="text-lg font-semibold">Settings for {shownSettings.name}</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-muted-foreground">
                CPU and RAM changes apply without restarting the desktop. Lowering RAM below current use may kill
                processes.
              </Dialog.Description>
              {limitsQuery.data && editSettings && (
                <ComputerResourceFields
                  limits={limitsQuery.data}
                  value={editSettings}
                  onChange={setEditDraft}
                  disabled={settingsBusy}
                />
              )}
              {timezoneChanged && (
                <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <p role="alert">
                    Changing timezone requires replacing the container.{' '}
                    {shownSettings.state === 'exited'
                      ? 'The computer is off: its home/workspace volumes stay intact. Power it on from the menu after saving.'
                      : 'Power off the computer from the menu first, then reopen Settings. No running desktop will be restarted automatically.'}
                  </p>
                  {shownSettings.state === 'exited' && (
                    <label className="mt-3 flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={replaceConfirmed}
                        disabled={settingsBusy}
                        onChange={event => setReplaceConfirmed(event.target.checked)}
                        className="mt-1"
                      />
                      I understand this will replace the stopped container, preserving its home and workspace
                    </label>
                  )}
                </div>
              )}
              {settingsError && (
                <p role="alert" className="mt-4 text-sm text-red-400">
                  {settingsError}
                </p>
              )}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-0"
                    disabled={settingsBusy}
                  >
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  size="sm"
                  className="min-h-11 sm:min-h-0"
                  disabled={
                    settingsBusy ||
                    !parsedEdit ||
                    (timezoneChanged && (shownSettings.state !== 'exited' || !replaceConfirmed)) ||
                    !query.data?.controllerConnected
                  }
                >
                  {settingsBusy
                    ? 'Saving…'
                    : timezoneChanged
                      ? shownSettings.state === 'exited'
                        ? 'Replace stopped computer'
                        : 'Power off first'
                      : 'Save settings'}
                </Button>
              </div>
            </form>
          </ComputerDialog>
        )}
      </Dialog.Root>
      <Dialog.Root
        open={selected !== null}
        onOpenChange={open => {
          if (!open && !deleteBusy) {
            setConfirmation('');
            onBack();
          }
        }}
      >
        {shownDelete && (
          <ComputerDialog>
            <form
              onSubmit={event => {
                event.preventDefault();
                void submitDelete();
              }}
            >
              <Dialog.Title className="text-lg font-semibold">Delete computer</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
                This permanently deletes the computer, its container, and all files in its persistent home and
                workspace. This cannot be undone.
              </Dialog.Description>
              <p id={`${confirmId}-help`} className="mt-5 break-words text-sm">
                Type <strong className="select-text">{shownDelete.name}</strong> exactly to confirm.
              </p>
              <label htmlFor={confirmId} className="mt-4 block text-sm font-medium">
                Confirm computer name
              </label>
              <input
                id={confirmId}
                aria-describedby={`${confirmId}-help`}
                autoComplete="off"
                spellCheck={false}
                value={confirmation}
                disabled={deleteBusy}
                onChange={event => setConfirmation(event.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 sm:h-10 sm:text-sm"
              />
              {deleteError && (
                <p role="alert" className="mt-4 text-sm text-red-400">
                  {deleteError}
                </p>
              )}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-0"
                    disabled={deleteBusy}
                  >
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="min-h-11 border-red-500/50 text-red-400 hover:bg-red-500/10 sm:min-h-0"
                  disabled={deleteBusy || confirmation !== shownDelete.name}
                >
                  {deleteBusy ? 'Deleting…' : 'Delete computer'}
                </Button>
              </div>
            </form>
          </ComputerDialog>
        )}
      </Dialog.Root>
      <ConfirmDialog
        open={powerOffTarget !== null}
        onOpenChange={open => {
          if (!open) setPowerOffTarget(null);
        }}
        title="Power off computer"
        confirmLabel="Power off"
        busyLabel="Powering off…"
        onConfirm={async () => {
          if (!powerOffTarget) return;
          const target = powerOffTarget;
          const result = await api.POST('/api/computers/{id}/power', {
            params: { path: { id: target.id } },
            body: { action: 'stop' },
          });
          if (!result.data || result.error)
            throw new Error(result.error?.message ?? 'Could not change the computer power state.');
          refresh();
        }}
        description={
          <>
            Shuts down <strong className="text-foreground">{powerOffTarget?.name}</strong>. Open programs and every
            terminal session end. Files in its home and workspace stay.
            {(() => {
              const holder = holders.data?.find(item => item.computerId === powerOffTarget?.id);
              return holder ? (
                <>
                  {' '}
                  <strong className="text-foreground">{holder.agent.name}</strong> is using this computer right now and
                  will lose it.
                </>
              ) : null;
            })()}
          </>
        }
      />
      {terminalsComputer && (
        <ComputerTerminals
          key={terminalsComputer.id}
          computer={terminalsComputer}
          open={terminalsOpen}
          connected={
            Boolean(query.data?.controllerConnected) && computers.some(computer => computer.id === terminalsComputer.id)
          }
          onOpenChange={setTerminalsOpen}
        />
      )}
      {filesComputer && (
        <ComputerFileBrowser
          key={filesComputer.id}
          computer={filesComputer}
          open={filesOpen}
          connected={
            Boolean(query.data?.controllerConnected) && computers.some(computer => computer.id === filesComputer.id)
          }
          onOpenChange={setFilesOpen}
        />
      )}
    </section>
  );
}
