import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { AgentDmTranscript } from '@/components/agent-dm-transcript';
type Peer = { id: string; name: string };
// Kibo breadcrumb-standard-4 and checkbox-standard-8, with application navigation and native checkboxes.
export function AgentChannelSettings({ agentId, screen: screenType, peerId, onNavigate, selected, known, onChange, disabled }: {
  agentId: string; screen: 'channels' | 'swarm' | 'dm'; peerId?: string; onNavigate: (next: 'channels' | 'swarm' | Peer) => void;
  selected: string[]; known: Peer[]; onChange: (ids: string[]) => void; disabled: boolean;
}) {
  const [query, setQuery] = useState(''), [peers, setPeers] = useState<Peer[]>(known);
  // The saved Channels and Swarm App URLs now lead to the same inline controls.
  const screen: 'swarm' | Peer = screenType === 'dm' ? known.find(peer => peer.id === peerId) ?? peers.find(peer => peer.id === peerId) ?? { id: peerId ?? '', name: 'Agent' } : 'swarm';
  const [cursor, setCursor] = useState<number | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  function navigate(next: typeof screen) { onNavigate(next); }
  async function load(after?: number) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const { data, error } = await api.GET('/api/agents', { params: { query: { search: query, after, limit: 50 } }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!data || error) throw new Error('Could not load agents.');
      setPeers(current => [...new Map([...(after ? current : query ? [] : known), ...data.agents].filter(peer => peer.id !== agentId).map(peer => [peer.id, peer])).values()]);
      setCursor(data.nextCursor);
    } catch { if (!controller.signal.aborted) setError('Could not load agents.'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 200);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [query, agentId, known]);
  const page = typeof screen === 'string' ? screen : screen.id;
  return <div className="space-y-4 overflow-hidden">
    {typeof screen === 'object' && <nav aria-label="Agent settings breadcrumb" className="w-fit max-w-full rounded-lg border border-border px-3 py-0 sm:py-2">
      <ol className="flex min-h-11 min-w-0 items-center gap-2 text-sm sm:min-h-0">
        <li className="text-muted-foreground">Channels</li>
        <li aria-hidden="true" className="text-muted-foreground">›</li>
        <li><button type="button" className="flex min-h-11 items-center whitespace-nowrap text-muted-foreground hover:text-foreground sm:min-h-0" onClick={() => navigate('swarm')}>Swarm App</button></li>
        <li aria-hidden="true" className="text-muted-foreground">›</li>
        <li className="min-w-0 truncate" aria-current="page" title={screen.name}>{screen.name}</li>
      </ol>
    </nav>}
    <div key={page}>
      {screen === 'swarm' ? <div className="space-y-4">
        <div><h4 className="text-sm font-semibold">Swarm App</h4><p className="mt-1 text-xs text-muted-foreground">Agent-to-agent direct messages</p></div>
        <div><h5 className="text-sm font-semibold">Allowed DMs</h5><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose which agents can chat with this agent. Enabling a connection allows both agents to send and reply. Sends automatically wake recipients and may use their model connection. Changes apply when saved.</p></div>
        <label className="block space-y-1.5 text-xs font-medium">Find agents<input type="search" value={query} maxLength={80} onChange={event => setQuery(event.target.value)} className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9" /></label>
        <p className="text-xs text-muted-foreground">{selected.length} of 100 allowed</p>
        <fieldset disabled={disabled} className="space-y-3"><legend className="sr-only">Allowed agent connections</legend>
          {peers.filter(peer => peer.id !== agentId).map(peer => <div key={peer.id} className="flex min-h-11 items-center gap-2 sm:min-h-0">
            <input id={`dm-${peer.id}`} type="checkbox" checked={selected.includes(peer.id)} disabled={disabled || selected.length >= 100 && !selected.includes(peer.id)} onChange={event => onChange(event.target.checked ? [...selected, peer.id] : selected.filter(id => id !== peer.id))} className="size-4 shrink-0 rounded border-border accent-foreground focus-visible:ring-2 focus-visible:ring-ring" />
            <label htmlFor={`dm-${peer.id}`} className="min-w-0 flex-1 break-words text-sm">{peer.name}</label>
            <button type="button" aria-label={`View DM with ${peer.name}`} onClick={() => navigate(peer)} className="flex min-h-11 shrink-0 items-center rounded-sm px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-0">View DM</button>
          </div>)}
        </fieldset>
        {!peers.length && !busy && !error && <p className="text-sm text-muted-foreground">No other agents found.</p>}
        {busy && <p role="status" className="text-xs text-muted-foreground">Loading agents…</p>}
        {error && <p role="alert" className="text-sm">{error}</p>}
        {(cursor !== null || error) && <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={busy} onClick={() => void load(error ? undefined : cursor ?? undefined)}>{error ? 'Retry agents' : 'Load more agents'}</Button>}
        <p className="text-xs leading-relaxed text-muted-foreground">Off by default. Disabling a connection from either agent blocks future sends in both directions, not already accepted messages. Each automated chain is limited to eight DMs. Conversations remain inspectable after revocation.</p>
      </div> : <AgentDmTranscript key={screen.id} agentId={agentId} peerId={screen.id} />}
    </div>
  </div>;
}
