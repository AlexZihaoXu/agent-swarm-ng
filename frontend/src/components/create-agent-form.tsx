import { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AgentAvatarPreview } from '@/components/agent-avatar-preview';
import { randomizeAvatar } from '@/lib/agent-avatar';
import type { RealAgent } from '@/use-chat';

const fieldClass = 'h-10 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
type Endpoint = { id: string; name: string; baseUrl: string };
const codexConnection = 'provider:openai-codex';

export function CreateAgentForm({ onCreated }: { onCreated: (agent: RealAgent) => void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(() => randomizeAvatar());
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [endpointId, setEndpointId] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [codexModels, setCodexModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [levels, setLevels] = useState<RealAgent['thinkingLevel'][]>([]);
  const [thinking, setThinking] = useState<RealAgent['thinkingLevel']>('off');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const creation = useRef<AbortController | null>(null);
  useEffect(() => () => creation.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.GET('/api/model-endpoints', { signal: controller.signal }),
      api.GET('/api/providers/openai-codex', { signal: controller.signal }),
    ]).then(([{ data }, { data: codex }]) => {
      if (controller.signal.aborted) return;
      setCodexModels(codex?.connected ? codex.models : []);
      setEndpoints([...(codex?.connected ? [{ id: codexConnection, name: 'OpenAI Codex (ChatGPT)', baseUrl: '' }] : []), ...(data ?? [])]);
      setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) { setError('Could not load endpoints.'); setLoading(false); } });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setModels([]); setModel(''); setLevels([]); setError('');
    const endpoint = endpoints.find(item => item.id === endpointId);
    if (!endpoint) return;
    if (endpoint.id === codexConnection) { setModels(codexModels); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void api.POST('/api/model-endpoints/test', { body: { endpointId, baseUrl: endpoint.baseUrl }, signal: controller.signal }).then(({ data, error }) => {
      if (controller.signal.aborted) return;
      if (error || !data) setError(error?.message ?? 'Could not list models.');
      else setModels(data.models);
    }).catch(() => { if (!controller.signal.aborted) setError('Could not list models.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpointId, endpoints, codexModels]);

  useEffect(() => {
    setLevels([]); setThinking('off');
    if (!model) return;
    const controller = new AbortController();
    void api.GET('/api/agents/model-capabilities', { params: { query: { model, endpointId } }, signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      if (!data) { setError('Could not check model capabilities.'); return; }
      setLevels(data.thinkingLevels);
      setThinking(data.thinkingLevels.includes('off') ? 'off' : data.thinkingLevels.includes('medium') ? 'medium' : data.thinkingLevels[0]);
    }).catch(() => { if (!controller.signal.aborted) setError('Could not check model capabilities.'); });
    return () => controller.abort();
  }, [model, endpointId]);

  async function create() {
    setCreating(true); setError('');
    const controller = new AbortController();
    creation.current = controller;
    try {
      const { data, error } = await api.POST('/api/agents', { body: { name: name.trim(), endpointId, model, thinkingLevel: thinking, avatar }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (error || !data) setError(error?.message ?? 'Could not create agent.');
      else onCreated(data);
    } catch { if (!controller.signal.aborted) setError('Could not reach the backend.'); }
    finally { if (!controller.signal.aborted) setCreating(false); }
  }

  return (
    <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <Dialog.Title className="text-lg font-semibold">Create new agent</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">A Pi agent with saved platform-chat history. No computer, file, or command access.</Dialog.Description>
      <fieldset disabled={creating} className="mt-5 min-w-0 space-y-4">
        <div className="space-y-2"><label htmlFor={`${id}-name`} className="block text-sm font-medium">Agent name</label><input id={`${id}-name`} required maxLength={80} value={name} onChange={event => setName(event.target.value)} className={fieldClass} autoComplete="off" placeholder="Name your agent" /></div>
        <AgentAvatarPreview name={name} value={avatar} onChange={setAvatar} disabled={creating} />
        <div className="space-y-2"><label htmlFor={`${id}-endpoint`} className="block text-sm font-medium">Endpoint</label>
          <Select id={`${id}-endpoint`} required disabled={creating || endpoints.length === 0} value={endpointId} onValueChange={setEndpointId} placeholder="Select a model connection" options={endpoints.map(endpoint => ({ value: endpoint.id, label: endpoint.name }))} />
          {!loading && endpoints.length === 0 && <p className="text-xs text-muted-foreground">Connect ChatGPT or save an API endpoint in Settings first.</p>}
        </div>
        <div className="space-y-2"><label htmlFor={`${id}-model`} className="block text-sm font-medium">Model</label>
          <Select id={`${id}-model`} required disabled={creating || loading || models.length === 0} value={model} onValueChange={setModel} placeholder={loading && endpointId ? 'Loading models…' : 'Select a model'} options={models.map(value => ({ value, label: value }))} />
        </div>
        <div className="space-y-2"><label htmlFor={`${id}-thinking`} className="block text-sm font-medium">Thinking level</label>
          <Select id={`${id}-thinking`} value={thinking} disabled={creating || levels.length <= 1} onValueChange={value => { if (levels.includes(value as RealAgent['thinkingLevel'])) setThinking(value as RealAgent['thinkingLevel']); }} options={(levels.length ? levels : ['off']).map(level => ({ value: level, label: level === 'off' ? (levels.length <= 1 ? 'Not configurable' : 'Off') : level[0].toUpperCase() + level.slice(1) }))} />
          <p className="text-xs leading-relaxed text-muted-foreground">{levels.length <= 1 ? 'Configurable thinking is unsupported or not verified for this model.' : 'Pi model capabilities; reasoning support depends on the selected provider.'}</p>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
      <p className="mt-4 text-xs text-muted-foreground">Agent and chat history are saved locally. Drafts and internal activity clear on refresh. Only channel-tool messages are shown.</p>
      <div className="mt-6 flex justify-end gap-2">
        <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
        <Button type="submit" size="sm" disabled={creating || !name.trim() || !model || !levels.includes(thinking)}>{creating ? 'Creating…' : 'Create agent'}</Button>
      </div>
    </form>
  );
}
