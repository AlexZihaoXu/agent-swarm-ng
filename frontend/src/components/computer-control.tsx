import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { defaultAvatar } from '@/lib/agent-avatar';
import type { ChatAgent } from '@/use-chat';
import type { ChatMessage } from '@/chat-types';
import { AgentAvatar } from './chat-identity';
import { Button } from './ui/button';
import { ComputerReaders } from './computer-readers';
import { ConfirmDialog } from './confirm-dialog';

export type ComputerAgentState = {
  agents: ChatAgent[];
  busy: Record<string, boolean>;
  typing: Record<string, boolean>;
  peerBusy: Record<string, boolean>;
  connected: boolean;
  /** Conversation access for the floating chat with the agent on a computer. */
  chat?: {
    conversations: Record<string, ChatMessage[]>;
    drafts: Record<string, string>;
    historyReady: Record<string, boolean>;
    historyLoading: Record<string, boolean>;
    historyFailed: Record<string, boolean>;
    /** Where older history continues on the server (null when all is loaded). */
    historyCursor: Record<string, unknown>;
    setDraft: (channelId: string, text: string) => void;
    send: (agent: ChatAgent, text: string, fileIds?: string[]) => string | undefined;
    stop: (channelId: string) => void;
    /** Loads the latest page, or with `older` the page before what is held. */
    loadHistory: (agent: ChatAgent, older?: boolean) => void;
    /** Open the agent's full conversation in Chat. */
    openConversation: (agent: ChatAgent) => void;
  };
};

export function ComputerControl({
  computerId,
  agentState,
  onOpenChat,
}: {
  computerId: string;
  agentState?: ComputerAgentState;
  /** Opens a floating chat with the agent holding the computer (only for agents in the loaded roster). */
  onOpenChat?: (agent: ChatAgent, from: DOMRect) => void;
}) {
  const [holder, setHolder] = useState<{ id: string; name: string } | null>(null);
  const [readers, setReaders] = useState<{ id: string; name: string }[]>([]);
  const [recording, setRecording] = useState<{ agent: { id: string; name: string }; sources: string[] }[]>([]);
  const [stoppingRecording, setStoppingRecording] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [known, setKnown] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setKnown(false);
    const load = async () => {
      try {
        const result = await api.GET('/api/computers/control', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!result.data) throw new Error('Control status unavailable.');
        setHolder(result.data.holders.find(item => item.computerId === computerId)?.agent ?? null);
        setReaders((result.data.readers ?? []).filter(item => item.computerId === computerId).map(item => item.agent));
        setRecording((result.data.recordings ?? []).filter(item => item.computerId === computerId));
        setError('');
        setKnown(true);
      } catch {
        if (!controller.signal.aborted) {
          setError('Control status unavailable.');
          setKnown(false);
        }
      }
    };
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 3000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [computerId, attempt]);
  const listed = agentState?.agents.find(agent => agent.id === holder?.id);
  // A computer can be held by an agent outside the currently loaded roster page.
  const profile = useQuery({
    queryKey: ['computer-holder-profile', holder?.id, holder?.name],
    enabled: Boolean(holder && !listed),
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      let after: number | undefined;
      for (let page = 0; page < 20; page++) {
        const { data, error } = await api.GET('/api/agents', {
          params: { query: { search: holder!.name, after, limit: 100 } },
          signal,
        });
        if (!data || error) throw new Error('Agent profile unavailable.');
        const match = data.agents.find(agent => agent.id === holder!.id);
        if (match) return match;
        if (data.nextCursor === null) return null;
        if (data.nextCursor <= (after ?? 0)) throw new Error('Invalid agent page.');
        after = data.nextCursor;
      }
      throw new Error('Agent profile lookup limit reached.');
    },
  });
  const agent = listed ?? profile.data;
  const live = known && Boolean(agentState?.connected);
  const working =
    live && Boolean(holder && (agentState?.peerBusy[holder.id] || (agent && agentState?.busy[agent.channelId])));
  const typing = live && Boolean(agent && agentState?.typing[agent.channelId]);
  const status = !live
    ? 'Status unavailable'
    : typing
      ? 'Typing'
      : working
        ? 'Working'
        : agent
          ? 'Ready'
          : 'Status unavailable';
  async function release() {
    if (busy || !holder) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.POST('/api/computers/{id}/release', { params: { path: { id: computerId } }, body: {} });
      if (!result.data?.released) throw new Error(result.error?.message ?? 'Could not release control.');
      setHolder(null);
      setKnown(true);
      setAttempt(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not release control.');
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs">
      {holder ? (
        <div
          role="status"
          aria-label={`${holder.name} is on this computer. ${status}.`}
          className="flex min-w-0 max-w-full items-center gap-2"
          data-testid="computer-agent-presence"
        >
          {(() => {
            const presence = (
              <>
                <AgentAvatar
                  initials={holder.name.slice(0, 2).toUpperCase()}
                  avatar={agent?.avatar ?? defaultAvatar(holder.id)}
                  ready={live && Boolean(agent)}
                  working={working}
                  typing={typing}
                />
                <span className="min-w-0 text-left">
                  <span className="flex min-w-0 items-baseline gap-1">
                    <span className="max-w-36 truncate font-medium" title={holder.name}>
                      {holder.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">is on this computer</span>
                  </span>
                  <span className="block text-[10px] text-muted-foreground">{status}</span>
                </span>
              </>
            );
            return onOpenChat && listed ? (
              <button
                type="button"
                aria-label={`Chat with ${holder.name}`}
                title={`Chat with ${holder.name}`}
                onClick={event => onOpenChat(listed, event.currentTarget.getBoundingClientRect())}
                className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {presence}
              </button>
            ) : (
              presence
            );
          })()}
        </div>
      ) : (
        <span role="status" className="text-muted-foreground">
          {known ? 'No agent holds control' : error ? 'Control status unavailable' : 'Checking control…'}
        </span>
      )}
      {recording.length > 0 && (
        <span className="flex items-center gap-1.5">
          <span
            role="status"
            title={recording.map(item => `${item.agent.name}: ${item.sources.join(', ')}`).join('\n')}
            aria-label={`Recording: ${recording.map(item => `${item.agent.name} (${item.sources.join(', ')})`).join(', ')}`}
            className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-medium text-red-300"
          >
            <span aria-hidden="true" className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
            Recording · {recording.map(item => item.agent.name).join(', ')}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={stoppingRecording}
            onClick={async () => {
              setStoppingRecording(true);
              try {
                await api.POST('/api/computers/{id}/recordings/stop', {
                  params: { path: { id: computerId } },
                  body: {},
                });
                setRecording([]);
              } finally {
                setStoppingRecording(false);
              }
            }}
          >
            {stoppingRecording ? 'Saving…' : 'Stop recording'}
          </Button>
        </span>
      )}
      {readers.length > 0 && (
        <>
          {/* Readers sit apart from the holder: they look and read, only the holder acts. */}
          <span aria-hidden="true" className="h-6 w-px bg-border" />
          <ComputerReaders readers={readers} agents={agentState?.agents} />
        </>
      )}
      {holder && (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          {busy ? 'Releasing…' : 'Force release'}
        </Button>
      )}
      {holder && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Force release computer"
          confirmLabel="Force release"
          busyLabel="Releasing…"
          onConfirm={release}
          description={
            <>
              Stops <strong className="text-foreground">{holder.name}</strong>&apos;s active operations on this computer
              and takes control from them now. They are told on their next turn. Assignments stay, and programs in
              terminals keep running.
            </>
          }
        />
      )}
      {error && (
        <span role="alert" className="max-w-full [overflow-wrap:anywhere]">
          {error}{' '}
          <button type="button" className="cursor-pointer underline" onClick={() => setAttempt(value => value + 1)}>
            Retry control status
          </button>
        </span>
      )}
    </div>
  );
}
