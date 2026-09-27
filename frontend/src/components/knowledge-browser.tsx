import { useEffect, useRef, useState } from 'react';
import type { operations } from '@/api/schema';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { knowledgePath } from '@/lib/dashboard-location';
import { cn } from '@/lib/utils';

type Topic = operations['listKnowledge']['responses'][200]['content']['application/json']['entries'][number] & { snippet?: string };
type Entry = operations['readKnowledgeEntry']['responses'][200]['content']['application/json'];

// Kibo Item Group (title/description rows) and Breadcrumb with Border, adapted
// to read-only, URL-addressable knowledge instead of demo people/navigation.
export function KnowledgeBrowser({ id, onNavigate }: { id?: string; onNavigate: (path: string) => void }) {
  const [search, setSearch] = useState('');
  const [entry, setEntry] = useState<Entry | null>(null), [entryError, setEntryError] = useState(''), [entryAttempt, setEntryAttempt] = useState(0);
  const [entryLoading, setEntryLoading] = useState(false), [moreLoading, setMoreLoading] = useState(false), [moreError, setMoreError] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false), [listError, setListError] = useState(''), [listAttempt, setListAttempt] = useState(0);
  const selected = entry?.id === id ? entry : null;
  const parentId = id && !selected ? null : selected?.hasChildren ? selected.id : selected?.parentId ?? null;
  const listKey = `${id ?? ''}|${parentId ?? ''}|${search}`;
  const currentListKey = useRef(listKey), currentId = useRef(id);
  currentListKey.current = listKey; currentId.current = id;

  useEffect(() => {
    if (!id) { setEntry(null); setEntryError(''); setEntryLoading(false); return; }
    const controller = new AbortController();
    setEntry(null); setEntryError(''); setMoreError(''); setEntryLoading(true);
    void api.GET('/api/knowledge/entry', { params: { query: { id, length: 4000 } }, signal: controller.signal })
      .then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (!data || error) setEntryError('Could not load knowledge entry.');
        else setEntry(data);
      }).catch(() => { if (!controller.signal.aborted) setEntryError('Could not load knowledge entry.'); })
      .finally(() => { if (!controller.signal.aborted) setEntryLoading(false); });
    return () => controller.abort();
  }, [id, entryAttempt]);

  useEffect(() => {
    if (id && !selected) { setTopics([]); return; }
    const controller = new AbortController();
    setListLoading(true); setListError(''); setNextOffset(null); setTopics([]);
    const timer = setTimeout(() => {
      const query = search.trim();
      const request = query
        ? api.GET('/api/knowledge/search', { params: { query: { query, limit: 20 } }, signal: controller.signal })
        : api.GET('/api/knowledge', { params: { query: { ...(parentId ? { parentId } : {}), limit: 20 } }, signal: controller.signal });
      void request.then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (!data || error) { setListError('Could not load knowledge topics.'); return; }
        setTopics('matches' in data ? data.matches : data.entries);
        setNextOffset(data.nextOffset);
      }).catch(() => { if (!controller.signal.aborted) setListError('Could not load knowledge topics.'); })
        .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    }, search.trim() ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [id, selected?.id, selected?.hasChildren, selected?.parentId, search, listAttempt]);

  async function loadMoreTopics() {
    if (nextOffset === null || listLoading) return;
    const key = listKey, offset = nextOffset, query = search.trim();
    setListLoading(true); setListError('');
    try {
      const response = query
        ? await api.GET('/api/knowledge/search', { params: { query: { query, offset, limit: 20 } } })
        : await api.GET('/api/knowledge', { params: { query: { ...(parentId ? { parentId } : {}), offset, limit: 20 } } });
      if (currentListKey.current !== key) return;
      if (!response.data || response.error) throw new Error();
      setTopics(current => [...current, ...('matches' in response.data! ? response.data.matches : response.data.entries)]);
      setNextOffset(response.data.nextOffset);
    } catch { if (currentListKey.current === key) setListError('Could not load knowledge topics.'); }
    finally { if (currentListKey.current === key) setListLoading(false); }
  }

  async function loadMoreEntry() {
    if (!selected || selected.nextOffset === null || moreLoading) return;
    const target = selected.id, offset = selected.nextOffset;
    setMoreLoading(true); setMoreError('');
    try {
      const { data, error } = await api.GET('/api/knowledge/entry', { params: { query: { id: target, offset, length: 4000 } } });
      if (currentId.current !== target) return;
      if (!data || error || data.id !== target || data.offset !== offset) throw new Error();
      setEntry(current => current?.id === target ? { ...current, text: current.text + data.text, nextOffset: data.nextOffset } : current);
    } catch { if (currentId.current === target) setMoreError('Could not load more knowledge.'); }
    finally { if (currentId.current === target) setMoreLoading(false); }
  }

  const open = (topicId: string) => { setSearch(''); onNavigate(knowledgePath(topicId)); };
  return <section aria-label="Swarm Knowledge" className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col md:px-6">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-0">
      <div className="min-w-0"><h2 className="text-lg font-semibold">Swarm Knowledge</h2><p className="text-xs text-muted-foreground">Read-only operator-curated reference</p></div>
      <Button type="button" size="sm" variant="outline" className="min-h-11 shrink-0 sm:min-h-0" onClick={() => onNavigate('/settings')}>Back to settings</Button>
    </header>
    <div className="flex min-h-0 flex-1">
      <aside aria-label="Knowledge topics" className={cn('phone-list-enter min-h-0 w-full shrink-0 flex-col border-border md:flex md:w-72 md:border-r', id ? 'hidden' : 'flex')}>
        <div className="space-y-3 border-b border-border px-4 py-4">
          <label htmlFor="knowledge-search" className="sr-only">Search knowledge</label>
          <input id="knowledge-search" type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search knowledge" className="h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:text-sm" />
          <button type="button" onClick={() => { setSearch(''); onNavigate(knowledgePath()); }} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">All topics</button>
        </div>
        <ScrollArea label="Knowledge topics list" className="min-h-0 flex-1" viewportClassName="[&>div]:!block">
          <div className="pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-4">
            {listError && <div className="p-4 text-sm"><p role="alert">{listError}</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setListAttempt(value => value + 1)}>Retry knowledge topics</Button></div>}
            {listLoading && !topics.length && <p role="status" className="p-4 text-xs text-muted-foreground">Loading topics…</p>}
            {!listLoading && !listError && !topics.length && <p className="p-4 text-xs text-muted-foreground">{search.trim() ? 'No matching topics.' : 'No subtopics here. Use the path to browse another level.'}</p>}
            <ul className="divide-y divide-border">
              {topics.map(topic => <li key={topic.id}><button type="button" aria-label={`Open knowledge topic ${topic.title}`} aria-current={id === topic.id ? 'page' : undefined} onClick={() => open(topic.id)} className={cn('flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', id === topic.id && 'bg-muted')}>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{topic.title}</span><span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{topic.snippet ?? topic.summary}</span></span><span aria-hidden="true" className="text-muted-foreground">›</span>
              </button></li>)}
            </ul>
            {nextOffset !== null && <Button type="button" size="sm" variant="outline" className="m-4" disabled={listLoading} onClick={() => void loadMoreTopics()}>{listLoading ? 'Loading topics…' : 'Load more topics'}</Button>}
          </div>
        </ScrollArea>
      </aside>
      <article aria-label="Knowledge entry" className={cn('phone-detail-enter min-h-0 min-w-0 flex-1 flex-col md:flex', id ? 'flex' : 'hidden')}>
        <ScrollArea label="Knowledge entry content" className="min-h-0 flex-1" viewportClassName="[&>div]:!block">
          <div className="space-y-5 px-4 py-5 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pb-8">
            {id && <button type="button" onClick={() => { setSearch(''); onNavigate(knowledgePath()); }} className="min-h-11 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden">‹ Back to knowledge topics</button>}
            {!id && <p className="text-sm text-muted-foreground">Choose a topic to review its content and source.</p>}
            {entryLoading && <p role="status" className="text-sm text-muted-foreground">Loading knowledge entry…</p>}
            {entryError && <div><p role="alert" className="text-sm">{entryError}</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setEntryAttempt(value => value + 1)}>Retry knowledge entry</Button></div>}
            {selected && <>
              <nav aria-label="Knowledge path" className="w-fit max-w-full rounded-lg border border-border px-3 py-2"><ol className="flex flex-wrap items-center gap-2 text-xs">
                <li><button type="button" onClick={() => onNavigate(knowledgePath())} className="text-muted-foreground hover:text-foreground">Knowledge</button></li>
                {selected.breadcrumbs.map((part, index) => <li key={part.id} className="flex items-center gap-2"><span aria-hidden="true" className="text-muted-foreground">›</span>{index === selected.breadcrumbs.length - 1 ? <span aria-current="page">{part.title}</span> : <button type="button" onClick={() => open(part.id)} className="text-muted-foreground hover:text-foreground">{part.title}</button>}</li>)}
              </ol></nav>
              <div><h3 className="text-xl font-semibold">{selected.title}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.summary}</p><p className="mt-2 text-xs text-muted-foreground">Source: {selected.source}</p></div>
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{selected.text}</div>
              {moreError && <p role="alert" className="text-sm">{moreError}</p>}
              {selected.nextOffset !== null && <Button type="button" variant="outline" size="sm" disabled={moreLoading} onClick={() => void loadMoreEntry()}>{moreLoading ? 'Loading knowledge…' : 'Load more knowledge'}</Button>}
            </>}
          </div>
        </ScrollArea>
      </article>
    </div>
  </section>;
}
