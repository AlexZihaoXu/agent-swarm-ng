import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { surface } from '@/lib/motion';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentAvatarPreview } from '@/components/agent-avatar-preview';
import { AgentChannelSettings } from '@/components/agent-channel-settings';
import { AgentComputerSettings } from '@/components/agent-computer-settings';
import { AgentModelSettings } from '@/components/agent-model-settings';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
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
  }, [agent.id, attempt]);
  const dirty =
    avatar.shape !== savedAvatar.shape ||
    avatar.color !== savedAvatar.color ||
    avatar.seed !== savedAvatar.seed ||
    (avatar.eyeStyle ?? 'pill') !== (savedAvatar.eyeStyle ?? 'pill') ||
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
  const order = ['own', 'model', 'computers']; // fixed order, so the summary does not depend on which section mounted first
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
          description={
            saved ? (
              <p role="status">Saved.</p>
            ) : (
              <p className="truncate" title={agent.name}>
                Name, model, channels, computers and appearance for {agent.name}
              </p>
            )
          }
        />
        <ScrollArea
          label="Agent editor"
          viewportTabIndex={-1}
          className="min-h-0 flex-1"
          viewportClassName="[&>div]:!block"
        >
          <SectionNav container={sectionList} />
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
                  onChange={ids => {
                    setAllowed(ids);
                    setSaved(false);
                    setError('');
                  }}
                  disabled={busy || !loaded}
                />
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
            <AgentComputerSettings key={agent.id} agentId={agent.id} register={register} />
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
