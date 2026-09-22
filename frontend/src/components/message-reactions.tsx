import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type ReactionMap = Record<string, paths['/api/chats/{channelId}/reactions']['get']['responses'][200]['content']['application/json']['messages'][number]['reactions']>;
type Emoji = paths['/api/chats/{channelId}/messages/{messageId}/reaction']['put']['requestBody']['content']['application/json']['emoji'];
const choices: { value: Emoji; label: string }[] = [{ value: '👍', label: 'Thumbs up' }, { value: '❤️', label: 'Heart' }, { value: '😂', label: 'Laugh' }, { value: '🎉', label: 'Celebrate' }, { value: '👀', label: 'Eyes' }, { value: '✅', label: 'Check' }, { value: '🤔', label: 'Thinking' }, { value: '🔥', label: 'Fire' }];
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
// Existing Kibo Button and Simple Select compositions; no extra picker dependency or demo counts.
export function MessageReactions({ channelId, messageId, reactions = [] }: { channelId: string; messageId: string; reactions?: ReactionMap[string] }) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const change = async (emoji: Emoji) => {
    if (pending) return;
    setPending(true); setError('');
    try {
      const { data, error } = await api.PUT('/api/chats/{channelId}/messages/{messageId}/reaction', { params: { path: { channelId, messageId } }, body: { emoji, active: !reactions.find(item => item.emoji === emoji)?.mine } });
      if (!data || error) throw new Error(error?.message ?? 'Could not update the reaction.');
      client.setQueriesData<ReactionMap>({ queryKey: ['reactions', channelId] }, previous => previous ? { ...previous, [messageId]: data.reactions } : previous);
      void client.invalidateQueries({ queryKey: ['reactions', channelId] });
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update the reaction.'); }
    finally { setPending(false); }
  };
  return <>
    {reactions.length > 0 && <div aria-label="Message reactions" className="mt-1 flex flex-wrap gap-1">{reactions.map(reaction => <Button key={reaction.emoji} type="button" size="sm" variant="outline" aria-pressed={reaction.mine} aria-label={`${choices.find(item => item.value === reaction.emoji)?.label ?? reaction.emoji}: ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}`} disabled={pending} onClick={() => void change(reaction.emoji as Emoji)} className={cn('h-6 gap-1 rounded-md px-1.5 text-xs', reaction.mine && 'border-primary/50 bg-primary/10')}><span aria-hidden="true">{reaction.emoji}</span><span>{reaction.count}</span></Button>)}</div>}
    <div className="absolute -top-2 right-1 z-10 w-12 rounded-md bg-background opacity-100 shadow-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
      <label htmlFor={`reaction-${messageId}`} className="sr-only">React to message</label>
      <Select id={`reaction-${messageId}`} value="" placeholder="☺" disabled={pending} onValueChange={value => void change(value as Emoji)} options={choices.map(choice => ({ ...choice, icon: <span>{choice.value}</span> }))} triggerClassName="!h-6 !gap-0 !rounded-md !px-1.5 !text-xs" />
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
  </>;
}
