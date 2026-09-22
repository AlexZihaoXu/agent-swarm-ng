import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { AgentDmTranscript } from '@/components/agent-dm-transcript';
type Peer = { id: string; name: string };
// Kibo breadcrumb-standard-4 and checkbox-standard-8, with application navigation and native checkboxes.
export function AgentChannelSettings({ agentId, selected, known, onChange, disabled }: {
  agentId: string; selected: string[]; known: Peer[]; onChange: (ids: string[]) => void; disabled: boolean;
}) {
  const [screen, setScreen] = useState<'channels' | 'swarm' | Peer>('channels');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [query, setQuery] = useState(''), [peers, setPeers] = useState<Peer[]>(known);
  const [cursor, setCursor] = useState<number | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  function navigate(next: typeof screen, back = false) { setDirection(back ? 'back' : 'forward'); setScreen(next); }
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
    <nav aria-label="Agent settings breadcrumb" className="w-fit max-w-full rounded-lg border border-border px-3 py-2">
      <ol className="flex min-w-0 items-center gap-2 text-sm">
        <li>{screen === 'channels' ? <span aria-current="page">Channels</span> : <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => navigate('channels', true)}>Channels</button>}</li>
        {screen !== 'channels' && <><li aria-hidden="true" className="text-muted-foreground">›</li><li>{screen === 'swarm' ? <span aria-current="page">Swarm App</span> : <button type="button" className="whitespace-nowrap text-muted-foreground hover:text-foreground" onClick={() => navigate('swarm', true)}>Swarm App</button>}</li></>}
        {typeof screen === 'object' && <><li aria-hidden="true" className="text-muted-foreground">›</li><li className="min-w-0 truncate" aria-current="page" title={screen.name}>{screen.name}</li></>}
      </ol>
    </nav>
    <div key={page} className={`motion-reduce:animate-none ${direction === 'forward' ? 'animate-[settings-forward_240ms_ease-out]' : 'animate-[settings-back_240ms_ease-out]'}`}>
      {screen === 'channels' ? <button type="button" onClick={() => navigate('swarm')} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span><span className="block text-sm font-medium">Swarm App</span><span className="mt-1 block text-xs text-muted-foreground">Agent-to-agent direct messages</span></span><span aria-hidden="true">›</span>
      </button> : screen === 'swarm' ? <div className="space-y-4">
        <div><h3 className="text-sm font-semibold">Allowed DMs</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose which agents can chat with this agent. Enabling a connection allows both agents to send and reply. Sends automatically wake recipients and may use their model connection. Changes apply when saved.</p></div>
        <label className="block space-y-1.5 text-xs font-medium">Find agents<input type="search" value={query} maxLength={80} onChange={event => setQuery(event.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
        <p className="text-xs text-muted-foreground">{selected.length} of 100 allowed</p>
        <fieldset disabled={disabled} className="space-y-3"><legend className="sr-only">Allowed agent connections</legend>
          {peers.filter(peer => peer.id !== agentId).map(peer => <div key={peer.id} className="flex items-center gap-2">
            <input id={`dm-${peer.id}`} type="checkbox" checked={selected.includes(peer.id)} disabled={disabled || selected.length >= 100 && !selected.includes(peer.id)} onChange={event => onChange(event.target.checked ? [...selected, peer.id] : selected.filter(id => id !== peer.id))} className="size-4 shrink-0 rounded border-border accent-foreground focus-visible:ring-2 focus-visible:ring-ring" />
            <label htmlFor={`dm-${peer.id}`} className="min-w-0 flex-1 break-words text-sm">{peer.name}</label>
            <button type="button" aria-label={`View DM with ${peer.name}`} onClick={() => navigate(peer)} className="shrink-0 rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View DM</button>
          </div>)}
        </fieldset>
        {!peers.length && !busy && !error && <p className="text-sm text-muted-foreground">No other agents found.</p>}
        {busy && <p role="status" className="text-xs text-muted-foreground">Loading agents…</p>}
        {error && <p role="alert" className="text-sm">{error}</p>}
        {(cursor !== null || error) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load(error ? undefined : cursor ?? undefined)}>{error ? 'Retry agents' : 'Load more agents'}</Button>}
        <p className="text-xs leading-relaxed text-muted-foreground">Off by default. Disabling a connection from either agent blocks future sends in both directions, not already accepted messages. Each automated chain is limited to eight DMs. Conversations remain inspectable after revocation.</p>
      </div> : <AgentDmTranscript key={screen.id} agentId={agentId} peerId={screen.id} />}
    </div>
  </div>;
}
