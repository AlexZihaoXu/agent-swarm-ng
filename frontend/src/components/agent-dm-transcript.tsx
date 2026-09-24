import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { ConversationMessages } from '@/components/conversation-messages';
import type { AvatarAppearance } from '@/lib/agent-avatar';
import { MessageMarkdown } from '@/components/message-markdown';
import { MessageReply } from '@/components/message-reply';
type Message = paths['/api/agents/{id}/dms/{peerId}']['get']['responses'][200]['content']['application/json']['messages'][number];
type BubbleView = { agentName: string; peerName: string; agentAvatar: AvatarAppearance; peerAvatar: AvatarAppearance; viewport: RefObject<HTMLDivElement | null> };
export function AgentDmTranscript({ agentId, peerId, bubbleView }: { agentId: string; peerId: string; bubbleView?: BubbleView }) {
  const [messages, setMessages] = useState<Message[]>([]), [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const loaded = useRef(false);
  const position = useRef<{ height: number; older: boolean; bottom: boolean } | null>(null);
  async function load(before?: number, keepOlder = false) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const { data, error } = await api.GET('/api/agents/{id}/dms/{peerId}', { params: { path: { id: agentId, peerId }, query: { before } }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!data || error) throw new Error(error?.message ?? 'Could not load this conversation.');
      const viewport = bubbleView?.viewport.current;
      if (viewport) position.current = { height: viewport.scrollHeight, older: before !== undefined, bottom: !loaded.current || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80 };
      setMessages(current => before || keepOlder ? [...new Map([...current, ...data.messages].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence) : data.messages);
      if (!keepOlder || !loaded.current) setCursor(data.nextCursor);
      loaded.current = true;
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load this conversation.'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  useEffect(() => {
    void load(); const refresh = (event: Event) => {
      const conversation = (event as CustomEvent<string>).detail;
      if (!conversation || conversation === `dm:${[agentId, peerId].sort().join(':')}`) void load(undefined, Boolean(conversation));
    };
    window.addEventListener('swarm-dm-updated', refresh);
    return () => { request.current?.abort(); window.removeEventListener('swarm-dm-updated', refresh); };
  }, [agentId, peerId]);
  useLayoutEffect(() => {
    const viewport = bubbleView?.viewport.current, previous = position.current;
    if (!viewport || !previous) return;
    if (previous.older) viewport.scrollTop += viewport.scrollHeight - previous.height;
    else if (previous.bottom) viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' });
    position.current = null;
  }, [messages]);
  if (bubbleView) return <section aria-label={`Agent conversation with ${bubbleView.peerName}`}>
    {(cursor !== null || error) && <div className="px-5 pt-3 text-center"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load(error ? undefined : cursor ?? undefined)}>{error ? 'Retry agent conversation' : 'Load earlier messages'}</Button></div>}
    {error && <p role="alert" className="px-5 py-2 text-sm">{error}</p>}
    {!messages.length && <p role="status" className="px-5 py-8 text-center text-sm text-muted-foreground">{busy ? 'Loading conversation…' : 'No messages between these agents yet.'}</p>}
    {messages.length > 0 && <ConversationMessages agentName={bubbleView.agentName} counterpartName={bubbleView.peerName} time={new Date(messages[0].timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} senderStyles={{ agent: bubbleView.agentAvatar, user: bubbleView.peerAvatar }} messages={messages.map(message => ({ id: message.id, sequence: message.sequence, timestamp: message.timestamp, author: message.senderId === agentId ? 'agent' : 'user', text: message.text, replyTo: message.replyTo ? { id: message.replyTo.id, role: message.replyTo.senderId === agentId ? 'assistant' : 'user', text: message.replyTo.text } : null }))} />}
  </section>;
  return <section aria-label="Agent DM transcript" className="space-y-4">
    <p className="text-xs leading-relaxed text-muted-foreground">Messages exchanged by these agents. “Completed” means the input was processed, not that its answer was verified. No interrupted work is replayed after a backend restart.</p>
    <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}>Refresh conversation</Button>{cursor !== null && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load(cursor)}>Earlier messages</Button>}</div>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {!messages.length && <p className="py-6 text-center text-sm text-muted-foreground">{busy ? 'Loading conversation…' : 'No direct messages yet.'}</p>}
    {messages.map(message => <article key={message.id} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs"><strong className="break-words text-sm">{message.senderName}</strong><time className="text-muted-foreground" dateTime={new Date(message.timestamp).toISOString()}>{new Date(message.timestamp).toLocaleString()}</time><span className="text-muted-foreground">{message.status}</span></header>
      {message.replyTo && <MessageReply author={message.replyTo.senderName} text={message.replyTo.text} />}
      <MessageMarkdown text={message.text} />
    </article>)}
  </section>;
}
