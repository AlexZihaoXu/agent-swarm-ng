import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatComposer } from '@/components/chat-composer';
import { GroupEditor } from '@/components/group-editor';
import { DeleteGroupForm } from '@/components/delete-group-form';
import { GroupMessages } from '@/components/group-messages';
import { MobileConversationBreadcrumb } from '@/components/mobile-conversation-breadcrumb';
import { AgentTypingStatus } from '@/components/agent-typing-status';
import { mergeGroupMessages, useGroupMessages, type GroupMessage, type GroupPage } from '@/use-groups';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/random-uuid';
import { replyExcerpt } from '@/lib/reply-preview';

class GroupNotFoundError extends Error {}

export function GroupConversation({ groupId, mobile, onBack, draft, onDraft, typingIn }: { groupId: string; mobile: boolean; onBack: () => void; draft: string; onDraft: (text: string) => void; typingIn: (channelId: string, destination: string) => boolean }) {
  const client = useQueryClient();
  const group = useQuery({ queryKey: ['group', groupId], queryFn: async ({ signal }) => {
    const { data, error, response } = await api.GET('/api/groups/{id}', { params: { path: { id: groupId } }, signal });
    if (response.status === 404) throw new GroupNotFoundError('Group not found.');
    if (!data || error) throw new Error(error?.message ?? 'Could not load the group.');
    return data;
  } });
  useEffect(() => {
    if (group.error instanceof GroupNotFoundError) window.dispatchEvent(new CustomEvent('swarm-group-deleted', { detail: groupId }));
  }, [group.error, groupId]);
  const history = useGroupMessages(groupId);
  const messages = history.data?.messages ?? [];
  const [sending, setSending] = useState(false), [loadingOlder, setLoadingOlder] = useState(false), [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previous = useRef({ first: '', last: '', height: 0 });
  const nearBottom = useRef(true);
  const draftRef = useRef(draft); draftRef.current = draft;
  const submission = useRef<{ id: string; text: string; replyToId?: string } | null>(null);
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
    const replyToId = replyTo?.id;
    if (submission.current?.text !== text || submission.current.replyToId !== replyToId) submission.current = { id: randomUuid(), text, replyToId };
    try {
      const { data, error } = await api.POST('/api/groups/{id}/messages', { params: { path: { id: groupId } }, body: { message: text, clientMessageId: submission.current!.id, replyToMessageId: replyToId } });
      if (!data || error) throw new Error(error?.message ?? 'Could not confirm delivery. Reload history before retrying.');
      client.setQueryData<GroupPage>(['group-messages', groupId], old => ({ messages: mergeGroupMessages(old?.messages ?? [], [data.message]), nextCursor: old?.nextCursor ?? null }));
      void client.invalidateQueries({ queryKey: ['groups'] });
      if (draftRef.current.trim() === text) onDraft('');
      setReplyTo(current => current?.id === replyToId ? null : current);
      submission.current = null; nearBottom.current = true;
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not send the message.'); }
    finally { setSending(false); }
  };
  const name = group.data?.name ?? 'group';
  return <section aria-label={`Group conversation: ${name}`} className={cn('phone-detail-enter min-h-0 min-w-0 flex-1 flex-col md:flex', mobile ? 'flex' : 'hidden')}>
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-4 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] md:gap-3 md:pt-1.5">
      <div className="min-w-0 flex-1 md:hidden"><MobileConversationBreadcrumb parent="Chats" current={name} onBack={onBack} /><p className="truncate px-2 text-[11px] text-muted-foreground">You{group.data?.members.map(member => `, ${member.name}`).join('')}</p></div>
      <span aria-hidden="true" className="hidden text-xl text-muted-foreground md:inline">#</span>
      <div className="hidden min-w-0 flex-1 md:block"><h2 className="truncate text-sm font-semibold">{name}</h2><p className="truncate text-[11px] text-muted-foreground">You{group.data?.members.map(member => `, ${member.name}`).join('')}</p></div>
      {group.data && <><GroupEditor group={group.data} onDelete={() => setDeleting(true)}><Button size="sm" variant="outline" aria-label="Edit group chat" className="size-11 shrink-0 p-0 md:h-9 md:w-auto md:px-3"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-4 md:hidden"><path d="m15 5 4 4M5 15 16 4a2.8 2.8 0 0 1 4 4L9 19l-5 1z" /></svg><span className="hidden md:inline">Edit group</span></Button></GroupEditor><DeleteGroupForm group={group.data} open={deleting} onOpenChange={setDeleting} /></>}
    </header>
    <ScrollArea viewportRef={viewport} label="Group chat history" className="min-h-0 flex-1" viewportClassName="[&>div]:!block [&>div]:w-full" onScroll={() => { const element = viewport.current; if (element) nearBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop < 80; }}>
      {(history.isPending || history.isError || group.isError || history.data?.nextCursor != null) && <div className="p-3 text-center"><Button variant="outline" size="sm" disabled={history.isFetching || loadingOlder} onClick={() => {
        if (group.isError) { void group.refetch(); return; }
        if (history.isError) { void history.refetch(); return; }
        setLoadingOlder(true); setError(''); void history.older().catch(() => setError('Could not load earlier messages.')).finally(() => setLoadingOlder(false));
      }}>{history.isFetching || loadingOlder ? 'Loading messages…' : history.isError || group.isError ? 'Retry loading chat' : 'Load earlier messages'}</Button></div>}
      <GroupMessages messages={messages} members={group.data?.members ?? []} onReply={message => { setReplyTo(message); requestAnimationFrame(() => inputRef.current?.focus()); }} />
      {history.isSuccess && !messages.length && <p className="p-6 text-center text-sm text-muted-foreground">Start a conversation with this group.</p>}
    </ScrollArea>
    <div className="shrink-0 pl-[calc(1.5rem+env(safe-area-inset-left))] pr-[calc(1.5rem+env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-5 sm:pb-3">
      {error && <p role="alert" className="mb-2 text-xs text-red-400">{error}</p>}
      <div className="mb-1 flex min-h-5 flex-wrap items-center gap-x-3 px-2">{group.data?.members.filter(member => typingIn(member.channelId, `group:${groupId}`)).map(member => <AgentTypingStatus key={member.id} name={member.name} typing />)}</div>
      <ChatComposer name={name} draft={draft} onChange={onDraft} onSend={() => void send()} disabled={sending || !group.data || !history.data} inputRef={inputRef} reply={replyTo ? { author: replyTo.role === 'user' ? 'You' : replyTo.authorName, text: replyExcerpt(replyTo.text) } : undefined} onCancelReply={() => { setReplyTo(null); inputRef.current?.focus(); }} />
    </div>
  </section>;
}
