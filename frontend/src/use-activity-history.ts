import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { mergeActivity, reconcileActivityPage, type ActivityEntry } from '@/lib/activity-history';

export function useActivityHistory() {
  const [activity, setActivity] = useState<Record<string, ActivityEntry[]>>({});
  const current = useRef(activity); current.current = activity;
  const [contextUsage, setContextUsage] = useState<Record<string, ActivityEntry>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState<Record<string, number | null>>({});
  const cursors = useRef(cursor); cursors.current = cursor;
  const [entryLoading, setEntryLoading] = useState<Record<string, boolean>>({});
  const [entryFailed, setEntryFailed] = useState<Record<string, boolean>>({});
  const loaded = useRef(new Set<string>());
  const failedRequest = useRef(new Map<string, { older: boolean; refresh: boolean }>());
  const observed = useRef(new Set<string>());
  const removed = useRef(new Set<string>());
  const requests = useRef(new Map<string, AbortController>());
  const fragments = useRef(new Map<string, { agentId: string; controller: AbortController }>());
  const updateContext = useCallback((agentId: string, entries: ActivityEntry[]) => {
    const incoming = entries.filter(entry => entry.kind === 'status' && entry.label === 'Context usage');
    if (!incoming.length) return;
    setContextUsage(value => ({ ...value, [agentId]: mergeActivity(value[agentId] ? [value[agentId]] : [], incoming).at(-1)! }));
  }, []);
  const recordActivity = useCallback((agentId: string, entry: ActivityEntry, append = false) => {
    if (removed.current.has(agentId)) return;
    setActivity(value => ({ ...value, [agentId]: mergeActivity(value[agentId] ?? [], [entry], append) }));
    updateContext(agentId, [entry]);
  }, [updateContext]);
  const loadActivity = useCallback(async (agentId: string, older = false, refresh = false) => {
    if (removed.current.has(agentId)) return;
    observed.current.add(agentId);
    if (refresh) { requests.current.get(agentId)?.abort(); requests.current.delete(agentId); }
    if (requests.current.has(agentId) || (!older && !refresh && loaded.current.has(agentId)) || (older && !cursors.current[agentId])) return;
    const controller = new AbortController(); requests.current.set(agentId, controller);
    const before = current.current[agentId] ?? [];
    setLoading(value => ({ ...value, [agentId]: true })); setFailed(value => ({ ...value, [agentId]: false }));
    try {
      const { data, error } = await api.GET('/api/agents/{id}/activity', { params: { path: { id: agentId }, query: { before: older ? cursors.current[agentId]! : undefined } }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (error || !data) throw new Error('Activity unavailable');
      setActivity(value => ({ ...value, [agentId]: reconcileActivityPage(value[agentId] ?? [], data.entries, refresh ? before : undefined) }));
      updateContext(agentId, [...data.entries, ...(data.contextUsage ? [data.contextUsage] : [])]);
      setCursor(value => ({ ...value, [agentId]: data.nextCursor }));
      loaded.current.add(agentId); failedRequest.current.delete(agentId);
    } catch { if (!controller.signal.aborted) { failedRequest.current.set(agentId, { older, refresh }); setFailed(value => ({ ...value, [agentId]: true })); } }
    finally { if (requests.current.get(agentId) === controller) { requests.current.delete(agentId); setLoading(value => ({ ...value, [agentId]: false })); } }
  }, [updateContext]);
  const expandActivity = useCallback(async (agentId: string, entry: ActivityEntry) => {
    if (entry.nextOffset == null || fragments.current.has(entry.id) || removed.current.has(agentId)) return;
    const controller = new AbortController(); fragments.current.set(entry.id, { agentId, controller });
    setEntryLoading(value => ({ ...value, [entry.id]: true })); setEntryFailed(value => ({ ...value, [entry.id]: false }));
    try {
      let result = await api.GET('/api/agents/{id}/activity/entry', { params: { path: { id: agentId }, query: { entryId: entry.id, offset: entry.nextOffset, revision: entry.revision } }, signal: controller.signal });
      if (result.response.status === 409) result = await api.GET('/api/agents/{id}/activity/entry', { params: { path: { id: agentId }, query: { entryId: entry.id } }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.error || !result.data) throw new Error('Activity unavailable');
      recordActivity(agentId, result.data);
    } catch { if (!controller.signal.aborted) setEntryFailed(value => ({ ...value, [entry.id]: true })); }
    finally { if (fragments.current.get(entry.id)?.controller === controller) { fragments.current.delete(entry.id); setEntryLoading(value => ({ ...value, [entry.id]: false })); } }
  }, [recordActivity]);
  const retryActivity = useCallback((agentId: string) => {
    const request = failedRequest.current.get(agentId);
    return loadActivity(agentId, request?.older, request?.refresh);
  }, [loadActivity]);
  const refreshActivity = useCallback(() => { for (const id of observed.current) void loadActivity(id, false, true); }, [loadActivity]);
  const removeActivity = useCallback((agentId: string) => {
    removed.current.add(agentId); observed.current.delete(agentId); loaded.current.delete(agentId);
    requests.current.get(agentId)?.abort(); requests.current.delete(agentId);
    for (const [id, fragment] of fragments.current) if (fragment.agentId === agentId) { fragment.controller.abort(); fragments.current.delete(id); }
    setActivity(value => { const next = { ...value }; delete next[agentId]; return next; });
    setContextUsage(value => { const next = { ...value }; delete next[agentId]; return next; });
  }, []);
  useEffect(() => {
    const abort = () => {
      for (const controller of requests.current.values()) controller.abort();
      for (const { controller } of fragments.current.values()) controller.abort();
      requests.current.clear(); fragments.current.clear();
      // A bfcache-restored page reuses this hook. Ownership was cleared above,
      // so aborted requests' finally clauses cannot clear their loading flags.
      setLoading({}); setEntryLoading({});
    };
    window.addEventListener('pagehide', abort);
    return () => { window.removeEventListener('pagehide', abort); abort(); };
  }, []);
  return { activity, recordActivity, removeActivity, refreshActivity, loadActivity, expandActivity, retryActivity,
    activityHistory: { loading, failed, cursor, contextUsage, entryLoading, entryFailed } };
}
