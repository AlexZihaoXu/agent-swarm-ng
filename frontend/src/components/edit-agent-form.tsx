import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentAvatarPreview } from '@/components/agent-avatar-preview';
import { AgentChannelSettings } from '@/components/agent-channel-settings';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import type { ChatAgent } from '@/use-chat';
import { agentPath, type DashboardRoute } from '@/lib/dashboard-location';

// Kibo tabs-standard-1; tabs and footer stay outside the scrollable editor body.
export function EditAgentForm({ agent, route, onNavigate, onSave, onDone, onBusyChange }: {
  agent: ChatAgent; route: DashboardRoute; onNavigate: (path: string) => void;
  onSave: (agent: ChatAgent, avatar: AvatarAppearance, allowedDmAgentIds: string[]) => Promise<void>;
  onDone: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [avatar, setAvatar] = useState(() => agent.avatar ?? defaultAvatar(agent.id));
  const [allowed, setAllowed] = useState<string[]>([]), [known, setKnown] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState(false), [attempt, setAttempt] = useState(0);
  const tab = route.editorTab ?? 'avatar';
  const base = `${agentPath(agent.id)}/edit`;
  const channels = `${base}/settings/channels`;
  const pendingSection = useRef('');
  const lastSettingsPath = useRef(channels);
  useEffect(() => {
    pendingSection.current = '';
    if (tab === 'settings') lastSettingsPath.current = window.location.pathname;
  }, [tab, route.channelScreen, route.peerId]);
  const changeSection = (value: string) => {
    const target = value === 'avatar' ? `${base}/avatar` : lastSettingsPath.current;
    if (value === tab || window.location.pathname === target || pendingSection.current === target) return;
    pendingSection.current = target;
    onNavigate(target);
  };
  useEffect(() => {
    const controller = new AbortController(); setLoadError(false);
    void (async () => {
      try {
        const { data, error } = await api.GET('/api/agents/{id}/settings', { params: { path: { id: agent.id } }, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!data || error) throw new Error('Settings unavailable');
        setKnown(data.allowedDmAgents); setAllowed(data.allowedDmAgents.map(peer => peer.id)); setLoaded(true);
      } catch { if (!controller.signal.aborted) setLoadError(true); }
    })();
    return () => controller.abort();
  }, [agent.id, attempt]);
  async function save() {
    if (busy || !loaded) return;
    setBusy(true); onBusyChange(true); setError('');
    try { await onSave(agent, avatar, allowed); onDone(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save agent settings.'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }} className="flex max-h-[calc(90dvh-1rem)] min-h-0 flex-col">
    <div className="px-4 pt-4"><Dialog.Title className="text-lg font-semibold">Edit agent</Dialog.Title><Dialog.Description className="mt-2 break-words text-sm text-muted-foreground">Appearance and channel permissions for {agent.name}.</Dialog.Description></div>
    <Tabs.Root value={tab} onValueChange={changeSection} className="mt-4 flex min-h-0 flex-col">
      <Tabs.List aria-label="Agent editor sections" className="mx-4 inline-flex h-[50px] w-fit shrink-0 items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground sm:h-9">
        {['avatar', 'settings'].map(value => <Tabs.Trigger key={value} value={value} className="inline-flex h-full items-center justify-center rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm motion-reduce:transition-none">{value === 'avatar' ? 'Avatar' : 'Settings'}</Tabs.Trigger>)}
      </Tabs.List>
      <ScrollArea label="Agent editor" viewportTabIndex={-1} className="mt-4 h-[min(32rem,calc(90dvh-13rem))] min-h-0" viewportClassName="[&>div]:!block">
        <div className="px-4 pb-1">
          <Tabs.Content value="avatar" forceMount inert={tab !== 'avatar'} className="outline-none data-[state=inactive]:hidden"><AgentAvatarPreview name={agent.name} value={avatar} onChange={setAvatar} disabled={busy} collapsible={false} /></Tabs.Content>
          <Tabs.Content value="settings" forceMount inert={tab !== 'settings'} className="outline-none data-[state=inactive]:hidden"><AgentChannelSettings agentId={agent.id} screen={route.channelScreen ?? 'channels'} peerId={route.peerId} onNavigate={next => onNavigate(next === 'channels' ? channels : next === 'swarm' ? `${channels}/swarm` : `${channels}/swarm/dm/${encodeURIComponent(next.id)}`)} selected={allowed} known={known} onChange={setAllowed} disabled={busy || !loaded} /></Tabs.Content>
        </div>
      </ScrollArea>
    </Tabs.Root>
    <div className="px-4 pb-4 pt-4">
      {loadError ? <p role="alert" className="mb-3 text-sm">Could not load permissions. <button type="button" onClick={() => setAttempt(value => value + 1)} className="inline-flex min-h-11 items-center underline sm:min-h-0">Retry settings</button></p> : !loaded && <p role="status" className="mb-3 text-xs text-muted-foreground">Loading settings…</p>}
      {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
      <div className="flex justify-end gap-2"><Dialog.Close asChild><Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={busy}>Cancel</Button></Dialog.Close><Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={busy || !loaded}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
    </div>
  </form>;
}
