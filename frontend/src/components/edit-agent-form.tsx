import { AgentScratchpad } from '@/components/agent-scratchpad';
import { AgentMemory } from '@/components/agent-memory';
import { MoveToOrganization } from '@/components/organization-fields';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { createPortal } from 'react-dom';
import { surface } from '@/lib/motion';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentAvatarPreview } from '@/components/agent-avatar-preview';
import { AgentChannelSettings } from '@/components/agent-channel-settings';
import { AgentDiscordSettings } from '@/components/agent-discord-settings';
import { AgentComputerSettings } from '@/components/agent-computer-settings';
import { AgentModelSettings } from '@/components/agent-model-settings';
import { AgentInstructionsSettings } from '@/components/agent-instructions-settings';
import { AgentHeartbeatSettings } from '@/components/agent-heartbeat-settings';
import { AgentTimeNoteSettings } from '@/components/agent-time-note-settings';
import { defaultAvatar, sameAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import type { ChatAgent, RealAgent } from '@/use-chat';
import { agentPath, type DashboardRoute } from '@/lib/dashboard-location';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { SectionNav } from '@/components/section-nav';
import { ChevronLeftIcon } from '@/components/ui/icons';
import { backLink } from '@/lib/styles';
import type { SettingsSection } from '@/lib/settings-sections';

// Kibo's spacious section-form layout adapted to a left-aligned, scrollable
// detail pane. Channel permissions and avatar appearance save together.
export function EditAgentForm({
  agent,
  route,
  mobile,
  sectionSlot,
  onNavigate,
  onSave,
  onModelSaved,
  onBack,
  onUnsavedChange,
}: {
  agent: ChatAgent;
  onModelSaved: (agent: RealAgent) => void;
  onUnsavedChange: (labels: string[]) => void;
  route: DashboardRoute;
  mobile: boolean;
  /** On wide screens, the Agents panel's place for the section list. */
  sectionSlot?: HTMLElement | null;
  onNavigate: (path: string) => void;
  onSave: (agent: ChatAgent, avatar: AvatarAppearance, allowedDmAgentIds: string[]) => Promise<void>;
  onBack: () => void;
}) {
  const [avatar, setAvatar] = useState(() => agent.avatar ?? defaultAvatar(agent.id));
  const [savedAvatar, setSavedAvatar] = useState(() => agent.avatar ?? defaultAvatar(agent.id));
  const [allowed, setAllowed] = useState<string[]>([]),
    [savedAllowed, setSavedAllowed] = useState<string[]>([]);
  const [known, setKnown] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(false),
    [attempt, setAttempt] = useState(0);
  const channels = `${agentPath(agent.id)}/edit/settings/channels`;
  const avatarSection = useRef<HTMLElement>(null);
  const sectionList = useRef<HTMLDivElement>(null);
  // Existing Avatar bookmarks remain useful without recreating a section tab.
  useLayoutEffect(() => {
    if (route.editorTab === 'avatar') avatarSection.current?.scrollIntoView({ block: 'start' });
  }, [agent.id, route.editorTab, loaded]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    void (async () => {
      try {
        const { data, error } = await api.GET('/api/agents/{id}/settings', {
          params: { path: { id: agent.id } },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!data || error) throw new Error('Settings unavailable');
        const ids = data.allowedDmAgents.map(peer => peer.id);
        setKnown(data.allowedDmAgents);
        setAllowed(ids);
        setSavedAllowed(ids);
        setLoaded(true);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    })();
    return () => controller.abort();
  }, [agent.id, attempt, agent.real?.organizationId]);
  const dirty =
    !sameAvatar(avatar, savedAvatar) ||
    allowed.length !== savedAllowed.length ||
    allowed.some(id => !savedAllowed.includes(id));
  async function save() {
    if (busy || !loaded || !dirty) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await onSave(agent, avatar, allowed);
      setSavedAvatar(avatar);
      setSavedAllowed([...allowed]);
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save agent settings.');
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  const discardOwn = () => {
    setAvatar(savedAvatar);
    setAllowed(savedAllowed);
    setError('');
    setSaved(false);
  };
  // Every part of the page (this form, Model, Computers) registers here, so there is one Save, one Discard and one leave warning.
  const sections = useRef(new Map<string, SettingsSection>());
  const [sectionTick, setSectionTick] = useState(0);
  const register = useCallback((name: string, section?: SettingsSection) => {
    if (section) sections.current.set(name, section);
    else sections.current.delete(name);
    setSectionTick(value => value + 1);
  }, []);
  const latestOwn = useRef({ save, discard: discardOwn });
  latestOwn.current = { save, discard: discardOwn };
  useEffect(() => {
    register('own', {
      label: 'Channels and avatar',
      dirty,
      save: () => latestOwn.current.save(),
      discard: () => latestOwn.current.discard(),
    });
    return () => register('own');
  }, [dirty, register]);
  const order = ['own', 'discord', 'model', 'computers']; // fixed order, so the summary does not depend on which section mounted first
  const unsaved = [...sections.current.entries()]
    .filter(([, section]) => section.dirty)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([, section]) => section);
  const unsavedKey = unsaved.map(section => section.label).join('|');
  useEffect(() => {
    onUnsavedChange(unsavedKey ? unsavedKey.split('|') : []);
    return () => onUnsavedChange([]);
  }, [unsavedKey]);
  const [savingAll, setSavingAll] = useState(false),
    [allError, setAllError] = useState('');
  async function saveAll() {
    if (savingAll) return;
    setSavingAll(true);
    setAllError('');
    try {
      for (const section of unsaved) await section.save();
    } catch (failure) {
      setAllError(failure instanceof Error ? failure.message : 'Could not save every change.');
    } finally {
      setSavingAll(false);
    }
  }
  const discard = () => {
    for (const section of unsaved) section.discard();
    setAllError('');
  };
  void sectionTick;
  return (
    <section
      aria-label={`Settings for ${agent.name}`}
      className={cn(
        'phone-detail-enter min-h-0 min-w-0 flex-1 flex-col md:motion-safe:animate-[view-in_180ms_cubic-bezier(0.22,1,0.36,1)] md:flex',
        mobile ? 'flex' : 'hidden',
      )}
    >
      <form
        aria-label="Agent settings"
        onSubmit={event => {
          event.preventDefault();
          void saveAll();
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <PageHeader
          width="max-w-5xl"
          title="Agent settings"
          leading={
            <button type="button" onClick={onBack} aria-label="Back to agents" className={cn(backLink, 'md:hidden')}>
              <ChevronLeftIcon />
              Agents
            </button>
          }
          description={saved ? <p role="status">Saved.</p> : undefined}
        />
        {/* Wider screens list the sections in the Agents panel; phones keep a sticky strip over the page. */}
        {sectionSlot &&
          createPortal(
            // A portal's React events bubble to this form, not the panel: hand right-clicks to the panel's menu.
            <div
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                openPanelMenu(sectionSlot, event.clientX, event.clientY);
              }}
              // The menu key and Shift+F10 too, as the panel itself handles them.
              onKeyDown={event => {
                if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                event.preventDefault();
                const bounds = (event.target as HTMLElement).getBoundingClientRect();
                openPanelMenu(sectionSlot, bounds.left + 16, bounds.top + 16);
              }}
            >
              <SectionNav container={sectionList} vertical />
            </div>,
            sectionSlot,
          )}
        <ScrollArea label="Agent editor" viewportTabIndex={-1} className="min-h-0 flex-1">
          {!sectionSlot && <SectionNav container={sectionList} />}
          <div ref={sectionList} className="mx-auto w-full max-w-5xl space-y-8 px-4 pb-8 pt-6 md:px-6">
            <section aria-label="Channels" className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Channels</h3>
                <p className="mt-1 text-sm text-muted-foreground">Manage this agent's communication permissions.</p>
              </div>
              <div className="rounded-lg border border-border bg-sidebar/30 p-4">
                <AgentChannelSettings
                  agentId={agent.id}
                  screen={route.channelScreen ?? 'channels'}
                  peerId={route.peerId}
                  onNavigate={next =>
                    onNavigate(
                      next === 'channels'
                        ? channels
                        : next === 'swarm'
                          ? `${channels}/swarm`
                          : `${channels}/swarm/dm/${encodeURIComponent(next.id)}`,
                    )
                  }
                  selected={allowed}
                  known={known}
                  organizationId={agent.real?.organizationId}
                  onChange={ids => {
                    setAllowed(ids);
                    setSaved(false);
                    setError('');
                  }}
                  disabled={busy || !loaded}
                />
                {agent.real && (
                  <div className="mt-6 border-t border-border pt-5">
                    <AgentDiscordSettings
                      key={`discord:${agent.id}`}
                      agentId={agent.id}
                      agentName={agent.name}
                      register={register}
                    />
                  </div>
                )}
              </div>
            </section>
            {agent.real && (
              <AgentModelSettings
                key={`model:${agent.id}`}
                agent={{ ...agent, real: agent.real }}
                onSaved={onModelSaved}
                register={register}
              />
            )}
            {agent.real && (
              <AgentInstructionsSettings
                key={`instructions:${agent.id}`}
                agent={{ ...agent, real: agent.real }}
                onSaved={onModelSaved}
                register={register}
              />
            )}
            {agent.real && (
              <AgentHeartbeatSettings
                key={`heartbeat:${agent.id}`}
                agent={{ ...agent, real: agent.real }}
                onSaved={onModelSaved}
                register={register}
              />
            )}
            {agent.real && (
              <AgentTimeNoteSettings
                key={`time-notes:${agent.id}`}
                agent={{ ...agent, real: agent.real }}
                onSaved={onModelSaved}
                register={register}
              />
            )}
            <AgentComputerSettings
              key={`${agent.id}:${agent.real?.organizationId}`}
              agentId={agent.id}
              organizationId={agent.real?.organizationId}
              register={register}
            />
            {agent.real && <AgentScratchpad agentId={agent.id} agentName={agent.name} />}
            {agent.real && (
              <AgentMemory key={`memory:${agent.id}`} agentId={agent.id} agentName={agent.name} register={register} />
            )}
            <section ref={avatarSection} aria-label="Avatar" className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Avatar</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Customize how {agent.name} appears in chats and the sidebar.
                </p>
              </div>
              <AgentAvatarPreview
                name={agent.name}
                value={avatar}
                onChange={next => {
                  setAvatar(next);
                  setSaved(false);
                  setError('');
                }}
                disabled={busy}
                collapsible={false}
              />
            </section>
            {agent.real && (
              <section aria-label="Organization" className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Organization</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Agents, computers and group chats in different organizations are kept apart.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-sidebar/30 p-4">
                  <MoveToOrganization
                    kind="agent"
                    id={agent.id}
                    name={agent.name}
                    organizationId={agent.real.organizationId}
                    onMoved={organizationId => onModelSaved({ ...agent.real!, organizationId })}
                  />
                </div>
              </section>
            )}
            <section aria-label="Danger zone" className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Delete agent</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Permanently removes this agent, its chats and its permissions. You will be asked to type its name.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 border-red-500/50 text-red-400 hover:bg-red-500/10 sm:min-h-0"
                onClick={() => onNavigate(`${agentPath(agent.id)}/delete`)}
              >
                Delete {agent.name}…
              </Button>
            </section>
          </div>
        </ScrollArea>
        {/* The action bar rises from the bottom edge when there is something to save, and settles away after. */}
        <AnimatePresence initial={false}>
          {(unsaved.length > 0 || loadError || !loaded || error || allError) && (
            <m.div
              key="action-bar"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={surface}
              className="shrink-0 overflow-hidden border-t border-border"
            >
              <div className="mx-auto w-full max-w-5xl px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:px-6 md:py-4">
                {loadError ? (
                  <p role="alert" className="mb-3 text-sm">
                    Could not load permissions.{' '}
                    <button
                      type="button"
                      onClick={() => setAttempt(value => value + 1)}
                      className="inline-flex min-h-11 items-center underline sm:min-h-0"
                    >
                      Retry settings
                    </button>
                  </p>
                ) : (
                  !loaded && (
                    <p role="status" className="mb-3 text-xs text-muted-foreground">
                      Loading settings…
                    </p>
                  )
                )}
                {error && (
                  <p role="alert" className="mb-3 text-sm">
                    {error}
                  </p>
                )}
                {allError && allError !== error && (
                  <p role="alert" className="mb-3 text-sm">
                    {allError}
                  </p>
                )}
                {unsaved.length > 0 && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {unsaved.length > 1 || unsaved[0].label !== 'Channels and avatar' ? (
                      <p role="status" className="mr-auto text-xs text-muted-foreground">
                        Unsaved: {unsaved.map(section => section.label).join(', ')}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-0"
                      disabled={busy || savingAll || !loaded}
                      onClick={discard}
                    >
                      Discard changes
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      className="min-h-11 sm:min-h-0"
                      disabled={busy || savingAll || !loaded}
                    >
                      {busy || savingAll ? 'Saving…' : 'Save changes'}
                    </Button>
                  </div>
                )}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </form>
    </section>
  );
}

/** Opens the Agents panel's context menu from its section list, which is portalled there. */
function openPanelMenu(slot: HTMLElement, clientX: number, clientY: number) {
  slot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX, clientY }));
}
