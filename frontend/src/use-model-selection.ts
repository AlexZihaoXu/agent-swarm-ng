import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { RealAgent } from '@/use-chat';

type Thinking = RealAgent['thinkingLevel'];
export type ModelEndpoint = { id: string; name: string; baseUrl: string };
export const codexConnection = 'provider:openai-codex';

/**
 * Endpoint -> model -> thinking level choices, shared by agent creation and editing.
 * With `initial`, the agent's current choice is preserved on the first load instead of being cleared.
 */
export function useModelSelection(initial?: { endpointId: string; model: string; thinkingLevel: Thinking }) {
  const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([]);
  const [endpointId, setEndpointId] = useState(initial?.endpointId ?? '');
  const [models, setModels] = useState<string[]>([]);
  const [codexModels, setCodexModels] = useState<string[]>([]);
  const [model, setModel] = useState(initial?.model ?? '');
  const [levels, setLevels] = useState<Thinking[]>([]);
  const [thinking, setThinking] = useState<Thinking>(initial?.thinkingLevel ?? 'off');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [pristine, setPristine] = useState(Boolean(initial)); // true until the user changes endpoint or model

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.GET('/api/model-endpoints', { signal: controller.signal }),
      api.GET('/api/providers/openai-codex', { signal: controller.signal }),
    ]).then(([{ data, error: endpointError }, { data: codex }]) => {
      if (controller.signal.aborted) return;
      if (endpointError && !data) { setLoadFailed(true); setError('Could not load endpoints.'); }
      setCodexModels(codex?.connected ? codex.models : []);
      setEndpoints([...(codex?.connected ? [{ id: codexConnection, name: 'OpenAI Codex (ChatGPT)', baseUrl: '' }] : []), ...(data ?? [])]);
      setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) { setLoadFailed(true); setError('Could not load endpoints.'); setLoading(false); } });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setModels([]); if (!pristine) setModel(''); setError('');
    const endpoint = endpoints.find(item => item.id === endpointId);
    if (!endpoint) return;
    if (endpoint.id === codexConnection) { setModels(codexModels); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void api.POST('/api/model-endpoints/test', { body: { endpointId, baseUrl: endpoint.baseUrl }, signal: controller.signal }).then(({ data, error: testError }) => {
      if (controller.signal.aborted) return;
      if (testError || !data) setError(testError?.message ?? 'Could not list models.');
      else setModels(data.models);
    }).catch(() => { if (!controller.signal.aborted) setError('Could not list models.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpointId, endpoints, codexModels]);

  useEffect(() => {
    setLevels([]); if (!pristine) setThinking('off');
    if (!model) return;
    const controller = new AbortController();
    void api.GET('/api/agents/model-capabilities', { params: { query: { model, endpointId } }, signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      if (!data) { setError('Could not check model capabilities.'); return; }
      setLevels(data.thinkingLevels);
      setThinking(current => pristine && data.thinkingLevels.includes(current) ? current
        : data.thinkingLevels.includes('off') ? 'off' : data.thinkingLevels.includes('medium') ? 'medium' : data.thinkingLevels[0]);
    }).catch(() => { if (!controller.signal.aborted) setError('Could not check model capabilities.'); });
    return () => controller.abort();
  }, [model, endpointId]);

  return {
    endpoints, endpointId, models, model, levels, thinking, loading, error, loadFailed,
    chooseEndpoint: (id: string) => { setPristine(false); setEndpointId(id); },
    chooseModel: (value: string) => { setPristine(false); setModel(value); },
    setThinking,
  };
}
