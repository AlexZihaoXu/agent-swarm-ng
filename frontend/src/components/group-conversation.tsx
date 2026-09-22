import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatComposer } from '@/components/chat-composer';
import { GroupEditor } from '@/components/group-editor';
import { GroupMessages } from '@/components/group-messages';
import { AgentTypingStatus } from '@/components/agent-typing-status';
import { mergeGroupMessages, useGroupMessages, type GroupPage } from '@/use-groups';
import { cn } from '@/lib/utils';

export function GroupConversation({ groupId, mobile, onBack, draft, onDraft, typingIn }: { groupId: string; mobile: boolean; onBack: () => void; draft: string; onDraft: (text: string) => void; typingIn: (channelId: string, destination: string) => boolean }) {
  const client = useQueryClient();
  const group = useQuery({ queryKey: ['group', groupId], queryFn: async ({ signal }) => {
    const { data, error } = await api.GET('/api/groups/{id}', { params: { path: { id: groupId } }, signal });
    if (!data || error) throw new Error(error?.message ?? 'Could not load the group.');
    return data;
  } });
  const history = useGroupMessages(groupId);
  const messages = history.data?.messages ?? [];
  const [sending, setSending] = useState(false), [loadingOlder, setLoadingOlder] = useState(false), [error, setError] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const previous = useRef({ first: '', last: '', height: 0 });
  const nearBottom = useRef(true);
  const draftRef = useRef(draft); draftRef.current = draft;
  const submission = useRef<{ id: string; text: string } | null>(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const first = messages[0]?.id ?? '', last = messages.at(-1)?.id ?? '';
    const before = previous.current;
    if (before.first && before.first !== first && before.last === last) element.scrollTop += element.scrollHeight - before.height;
    else if (!before.last || nearBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    previous.current = { first, last, height: element.scrollHeight };
  }, [messages.length, mobile]);
  const send = async () => {
    const text = draft.trim();
    if (sending || !text) return;
    setSending(true); setError('');
    if (submission.current?.text !== text) submission.current = { id: crypto.randomUUID(), text };
    try {
      const { data, error } = await api.POST('/api/groups/{id}/messages', { params: { path: { id: groupId } }, body: { message: text, clientMessageId: submission.current!.id } });
      if (!data || error) throw new Error(error?.message ?? 'Could not confirm delivery. Reload history before retrying.');
      client.setQueryData<GroupPage>(['group-messages', groupId], old => ({ messages: mergeGroupMessages(old?.messages ?? [], [data.message]), nextCursor: old?.nextCursor ?? null }));
      void client.invalidateQueries({ queryKey: ['groups'] });
      if (draftRef.current.trim() === text) onDraft('');
      submission.current = null; nearBottom.current = true;
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not send the message.'); }
    finally { setSending(false); }
  };
  const name = group.data?.name ?? 'group';
  return <section aria-label={`Group conversation: ${name}`} className={cn('min-h-0 min-w-0 flex-1 flex-col sm:flex', mobile ? 'flex' : 'hidden')}>
    <header className="flex min-h-11 shrink-0 items-center gap-3 border-b border-border px-4 py-1.5">
      <Button variant="outline" size="sm" className="px-2 sm:hidden" aria-label="Back to chats" onClick={onBack}>←</Button>
      <span aria-hidden="true" className="text-xl text-muted-foreground">#</span>
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{name}</h2><p className="truncate text-[11px] text-muted-foreground">You{group.data?.members.map(member => `, ${member.name}`).join('')}</p></div>
      {group.data && <GroupEditor group={group.data}><Button size="sm" variant="outline" aria-label="Edit group chat">Edit group</Button></GroupEditor>}
    </header>
    <ScrollArea viewportRef={viewport} label="Group chat history" className="min-h-0 flex-1" onScroll={() => { const element = viewport.current; if (element) nearBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop < 80; }}>
      {(history.isPending || history.isError || group.isError || history.data?.nextCursor != null) && <div className="p-3 text-center"><Button variant="outline" size="sm" disabled={history.isFetching || loadingOlder} onClick={() => {
        if (group.isError) { void group.refetch(); return; }
        if (history.isError) { void history.refetch(); return; }
        setLoadingOlder(true); setError(''); void history.older().catch(() => setError('Could not load earlier messages.')).finally(() => setLoadingOlder(false));
      }}>{history.isFetching || loadingOlder ? 'Loading messages…' : history.isError || group.isError ? 'Retry loading chat' : 'Load earlier messages'}</Button></div>}
      <GroupMessages messages={messages} members={group.data?.members ?? []} />
      {history.isSuccess && !messages.length && <p className="p-6 text-center text-sm text-muted-foreground">Start a conversation with this group.</p>}
    </ScrollArea>
    <div className="shrink-0 px-4 pb-3 pt-2 sm:px-5">
      {error && <p role="alert" className="mb-2 text-xs text-red-400">{error}</p>}
      <div className="mb-1 flex min-h-5 flex-wrap items-center gap-x-3 px-2">{group.data?.members.filter(member => typingIn(member.channelId, `group:${groupId}`)).map(member => <AgentTypingStatus key={member.id} name={member.name} typing />)}</div>
      <ChatComposer name={name} draft={draft} onChange={onDraft} onSend={() => void send()} disabled={sending || !group.data || !history.data} />
    </div>
  </section>;
}
