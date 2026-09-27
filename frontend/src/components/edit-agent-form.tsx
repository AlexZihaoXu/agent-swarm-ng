import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentAvatarPreview } from '@/components/agent-avatar-preview';
import { AgentChannelSettings } from '@/components/agent-channel-settings';
import { defaultAvatar, type AvatarAppearance } from '@/lib/agent-avatar';
import type { ChatAgent } from '@/use-chat';
import { agentPath, type DashboardRoute } from '@/lib/dashboard-location';
import { cn } from '@/lib/utils';

// Kibo's spacious section-form layout adapted to a left-aligned, scrollable
// detail pane. Channel permissions and avatar appearance save together.
export function EditAgentForm({ agent, route, mobile, onNavigate, onSave, onBack }: {
  agent: ChatAgent; route: DashboardRoute; mobile: boolean; onNavigate: (path: string) => void;
  onSave: (agent: ChatAgent, avatar: AvatarAppearance, allowedDmAgentIds: string[]) => Promise<void>;
  onBack: () => void;
}) {
  const [avatar, setAvatar] = useState(() => agent.avatar ?? defaultAvatar(agent.id));
  const [savedAvatar, setSavedAvatar] = useState(() => agent.avatar ?? defaultAvatar(agent.id));
  const [allowed, setAllowed] = useState<string[]>([]), [savedAllowed, setSavedAllowed] = useState<string[]>([]);
  const [known, setKnown] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState(false), [attempt, setAttempt] = useState(0);
  const channels = `${agentPath(agent.id)}/edit/settings/channels`;
  const avatarSection = useRef<HTMLElement>(null);
  // Existing Avatar bookmarks remain useful without recreating a section tab.
  useLayoutEffect(() => {
    if (route.editorTab === 'avatar') avatarSection.current?.scrollIntoView({ block: 'start' });
  }, [agent.id, route.editorTab, loaded]);
  useEffect(() => {
    const controller = new AbortController(); setLoadError(false);
    void (async () => {
      try {
        const { data, error } = await api.GET('/api/agents/{id}/settings', { params: { path: { id: agent.id } }, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!data || error) throw new Error('Settings unavailable');
        const ids = data.allowedDmAgents.map(peer => peer.id);
        setKnown(data.allowedDmAgents); setAllowed(ids); setSavedAllowed(ids); setLoaded(true);
      } catch { if (!controller.signal.aborted) setLoadError(true); }
    })();
    return () => controller.abort();
  }, [agent.id, attempt]);
  async function save() {
    if (busy || !loaded) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      await onSave(agent, avatar, allowed);
      setSavedAvatar(avatar); setSavedAllowed([...allowed]); setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save agent settings.'); }
    finally { setBusy(false); }
  }
  const discard = () => { setAvatar(savedAvatar); setAllowed(savedAllowed); setError(''); setSaved(false); };
  return <section aria-label={`Settings for ${agent.name}`} className={cn('phone-detail-enter min-h-0 min-w-0 flex-1 flex-col md:motion-safe:animate-[fade-in_160ms_ease-out] md:flex', mobile ? 'flex' : 'hidden')}>
    <form aria-label="Agent settings" onSubmit={event => { event.preventDefault(); void save(); }} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:px-6 md:py-3">
        <button type="button" onClick={onBack} aria-label="Back to agents" className="flex min-h-11 shrink-0 items-center rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">‹ <span className="ml-1">Agents</span></button>
        <div className="min-w-0"><h2 className="truncate text-lg font-semibold">Agent settings</h2><p className="truncate text-xs text-muted-foreground" title={agent.name}>Appearance and channel permissions for {agent.name}</p></div>
      </header>
      <ScrollArea label="Agent editor" viewportTabIndex={-1} className="min-h-0 flex-1" viewportClassName="[&>div]:!block">
        <div className="w-full max-w-5xl space-y-8 px-4 pb-8 pt-6 md:px-6">
          <section aria-label="Channels" className="space-y-4">
            <div><h3 className="text-lg font-semibold">Channels</h3><p className="mt-1 text-sm text-muted-foreground">Manage this agent's communication permissions.</p></div>
            <div className="rounded-lg border border-border bg-sidebar/30 p-4">
              <AgentChannelSettings agentId={agent.id} screen={route.channelScreen ?? 'channels'} peerId={route.peerId} onNavigate={next => onNavigate(next === 'channels' ? channels : next === 'swarm' ? `${channels}/swarm` : `${channels}/swarm/dm/${encodeURIComponent(next.id)}`)} selected={allowed} known={known} onChange={ids => { setAllowed(ids); setSaved(false); }} disabled={busy || !loaded} />
            </div>
          </section>
          <section ref={avatarSection} aria-label="Avatar" className="space-y-4">
            <div><h3 className="text-lg font-semibold">Avatar</h3><p className="mt-1 text-sm text-muted-foreground">Customize how {agent.name} appears in chats and the sidebar.</p></div>
            <AgentAvatarPreview name={agent.name} value={avatar} onChange={next => { setAvatar(next); setSaved(false); }} disabled={busy} collapsible={false} />
          </section>
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t border-border px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:px-6 md:py-4">
        {loadError ? <p role="alert" className="mb-3 text-sm">Could not load permissions. <button type="button" onClick={() => setAttempt(value => value + 1)} className="inline-flex min-h-11 items-center underline sm:min-h-0">Retry settings</button></p> : !loaded && <p role="status" className="mb-3 text-xs text-muted-foreground">Loading settings…</p>}
        {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
        {saved && <p role="status" className="mb-3 text-sm text-muted-foreground">Saved.</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={busy || !loaded} onClick={discard}>Discard changes</Button><Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={busy || !loaded}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
      </div>
    </form>
  </section>;
}
