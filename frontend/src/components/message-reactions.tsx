import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { reactionChoices as choices, recentReactionsKey, parseRecentReactions, rememberReaction, type ReactionEmoji as Emoji } from '@/lib/recent-reactions';

type ReactionMap = Record<string, paths['/api/chats/{channelId}/reactions']['get']['responses'][200]['content']['application/json']['messages'][number]['reactions']>;
function savedRecents() {
  try { return parseRecentReactions(localStorage.getItem(recentReactionsKey)); } catch { return []; }
}
function AddReactionIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="currentColor"><circle cx="11" cy="13" r="9" /><g fill="#232428"><circle cx="7.5" cy="11.5" r="1.2" /><circle cx="14.5" cy="11.5" r="1.2" /><circle cx="19" cy="5" r="5" /></g><path d="M7.5 15.5q3.5 4 7 0" fill="none" stroke="#232428" strokeWidth="1.8" strokeLinecap="round" /><path d="M19 2v6m-3-3h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
export function useMessageReactions(channelId: string | undefined, ids: string[]) {
  return useQuery<ReactionMap>({ queryKey: ['reactions', channelId, ids.join(',')], enabled: Boolean(channelId && ids.length), placeholderData: previous => previous,
    queryFn: async ({ signal }) => {
      const output: ReactionMap = {};
      for (let index = 0; index < ids.length; index += 100) {
        const { data, error } = await api.GET('/api/chats/{channelId}/reactions', { params: { path: { channelId: channelId! }, query: { ids: ids.slice(index, index + 100) } }, signal });
        if (!data || error) throw new Error(error?.message ?? 'Could not load reactions.');
        for (const message of data.messages) output[message.id] = message.reactions;
      }
      return output;
    },
  });
}
export function ReactionLoadError({ failed, retry }: { failed: boolean; retry: () => void }) {
  return failed ? <p role="alert" className="px-3 py-2 text-xs text-muted-foreground">Could not load reactions. <Button type="button" size="sm" variant="outline" onClick={retry}>Retry reactions</Button></p> : null;
}
// Kibo contextual button group + existing picker, styled to the operator's Discord reference.
export function MessageReactions({ channelId, messageId, reactions = [] }: { channelId: string; messageId: string; reactions?: ReactionMap[string] }) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const recent = useQuery<Emoji[]>({ queryKey: ['reaction-recents'], queryFn: savedRecents, initialData: savedRecents, staleTime: Infinity });
  const change = async (emoji: Emoji) => {
    if (pending) return;
    setPending(true); setError('');
    const active = !reactions.find(item => item.emoji === emoji)?.mine;
    try {
      const { data, error } = await api.PUT('/api/chats/{channelId}/messages/{messageId}/reaction', { params: { path: { channelId, messageId } }, body: { emoji, active } });
      if (!data || error) throw new Error(error?.message ?? 'Could not update the reaction.');
      if (active) {
        const next = rememberReaction(client.getQueryData<Emoji[]>(['reaction-recents']) ?? [], emoji);
        client.setQueryData(['reaction-recents'], next);
        try { localStorage.setItem(recentReactionsKey, JSON.stringify(next)); } catch { /* Keep session-local preferences if storage is unavailable. */ }
      }
      client.setQueriesData<ReactionMap>({ queryKey: ['reactions', channelId] }, previous => previous ? { ...previous, [messageId]: data.reactions } : previous);
      void client.invalidateQueries({ queryKey: ['reactions', channelId] });
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update the reaction.'); }
    finally { setPending(false); }
  };
  return <>
    {reactions.length > 0 && <div aria-label="Message reactions" className="mt-1 flex flex-wrap gap-1">{reactions.map(reaction => <Button key={reaction.emoji} type="button" size="sm" variant="outline" aria-pressed={reaction.mine} aria-label={`${choices.find(item => item.value === reaction.emoji)?.label ?? reaction.emoji}: ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}`} disabled={pending} onClick={() => void change(reaction.emoji as Emoji)} className={cn('h-6 gap-1 rounded-md px-1.5 text-xs', reaction.mine && 'border-primary/50 bg-primary/10')}><span aria-hidden="true">{reaction.emoji}</span><span>{reaction.count}</span></Button>)}</div>}
    <div role="group" aria-label="Reaction actions" className="pointer-events-none absolute -top-9 right-1 z-20 flex items-center rounded-lg border border-foreground/10 bg-[#232428] p-1 opacity-0 shadow-md transition-opacity motion-reduce:transition-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [&:has([data-state=open])]:pointer-events-auto [&:has([data-state=open])]:opacity-100">
      {recent.data.map(emoji => {
        const label = choices.find(choice => choice.value === emoji)!.label;
        const mine = reactions.some(reaction => reaction.emoji === emoji && reaction.mine);
        return <button key={emoji} type="button" aria-disabled={pending} aria-label={`React with ${label}`} aria-pressed={mine} title={mine ? `Remove ${label} reaction` : label} onClick={() => void change(emoji)} className="flex size-9 items-center justify-center rounded-md text-2xl leading-none outline-none [&:not([aria-disabled=true]):hover]:bg-white/10 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"><span aria-hidden="true">{emoji}</span></button>;
      })}
      {recent.data.length > 0 && <span aria-hidden="true" className="mx-1 h-6 w-px bg-foreground/10" />}
      <div className="group/picker relative size-9">
        <Select id={`reaction-${messageId}`} value="" ariaLabel="Add Reaction" triggerContent={<AddReactionIcon />} disabled={pending} onValueChange={value => void change(value as Emoji)} options={choices.map(choice => ({ ...choice, icon: <span>{choice.value}</span> }))} triggerClassName="!size-9 !justify-center !rounded-md !border-0 !bg-transparent !p-0 !text-muted-foreground enabled:hover:!bg-white/10 enabled:hover:!text-foreground focus-visible:!bg-white/10" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-full right-0 mb-3 whitespace-nowrap rounded-lg border border-foreground/10 bg-[#232428] px-3 py-2 text-sm font-semibold text-foreground opacity-0 shadow-lg transition-opacity group-hover/picker:opacity-100 group-focus-within/picker:opacity-100">Add Reaction<span className="absolute -bottom-1 right-3 size-2 rotate-45 border-b border-r border-foreground/10 bg-[#232428]" /></span>
      </div>
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
  </>;
}
