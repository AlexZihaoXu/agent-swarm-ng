import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { loadEmojiCatalog, searchEmoji, type EmojiChoice } from '@/lib/emoji-catalog';

// Searchable Kibo combobox composition, with a bounded emoji grid instead of a long list.
export function EmojiSearch({ onSelect, compact = false }: { onSelect: (emoji: string) => void; compact?: boolean }) {
  const [catalog, setCatalog] = useState<EmojiChoice[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(84);
  useEffect(() => {
    let cancelled = false;
    void loadEmojiCatalog().then(items => { if (!cancelled) setCatalog(items); }, () => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  const matches = useMemo(() => searchEmoji(catalog ?? [], query), [catalog, query]);
  const height = catalog && matches.length ? Math.min(224, Math.max(44, Math.ceil(Math.min(matches.length, limit) / (compact ? 4 : 7)) * 36 + 8)) : 48;
  return <div className={compact ? 'w-full p-1' : 'w-72 max-w-[calc(100vw-24px)] p-2'}>
    <input autoFocus type="search" aria-label="Search emojis" placeholder="Search emojis…" value={query} onChange={event => { setQuery(event.target.value); setLimit(84); }} onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }} className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" />
    <ScrollArea label="Emoji results" style={{ height }} viewportClassName="pr-3"><div role="group" aria-label="Emoji choices">
      {error ? <p role="alert" className="px-2 py-3 text-xs text-red-400">Could not load emoji choices.</p> : !catalog ? <p role="status" className="px-2 py-3 text-xs text-muted-foreground">Loading emojis…</p> : matches.length === 0 ? <p role="status" className="px-2 py-3 text-xs text-muted-foreground">No emojis found.</p> : <>
        <div className={`grid gap-1 ${compact ? 'grid-cols-4' : 'grid-cols-7'}`}>{matches.slice(0, limit).map(item => <button key={item.value} type="button" aria-label={item.label} title={item.label} onClick={() => onSelect(item.value)} className="flex size-8 cursor-pointer items-center justify-center rounded-md text-xl outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring">{item.value}</button>)}</div>
        {matches.length > limit && <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={() => setLimit(value => value + 84)}>Show more emojis</Button>}
      </>}
    </div></ScrollArea>
  </div>;
}
