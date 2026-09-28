import { useId, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useModelSelection } from '@/use-model-selection';
import type { ChatAgent, RealAgent } from '@/use-chat';

const fieldClass = 'h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:h-10';

/** Name and model connection of an existing agent. Identity, history and private context are kept; the next turn uses the new choice. */
export function AgentModelSettings({ agent, onSaved }: { agent: ChatAgent & { real: RealAgent }; onSaved: (agent: RealAgent) => void }) {
  const id = useId();
  const saved = agent.real;
  const choice = useModelSelection({ endpointId: saved.endpointId, model: saved.model, thinkingLevel: saved.thinkingLevel });
  const [name, setName] = useState(saved.name);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const endpointMissing = !choice.loading && !choice.loadFailed && !choice.endpoints.some(endpoint => endpoint.id === choice.endpointId);
  const models = choice.model && !choice.models.includes(choice.model) ? [choice.model, ...choice.models] : choice.models;
  const dirty = name.trim() !== saved.name || choice.endpointId !== saved.endpointId || choice.model !== saved.model || choice.thinking !== saved.thinkingLevel;
  const ready = name.trim() && choice.endpointId && choice.model && (choice.levels.length === 0 || choice.levels.includes(choice.thinking));
  async function save() {
    if (busy || !dirty || !ready) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const { data, error: failure } = await api.PATCH('/api/agents/{id}', { params: { path: { id: agent.id } }, body: {
        ...(name.trim() !== saved.name ? { name: name.trim() } : {}),
        ...(choice.endpointId !== saved.endpointId ? { endpointId: choice.endpointId } : {}),
        ...(choice.model !== saved.model ? { model: choice.model } : {}),
        ...(choice.thinking !== saved.thinkingLevel ? { thinkingLevel: choice.thinking } : {}),
      } });
      if (!data || failure) throw new Error(failure?.message ?? 'Could not save the agent.');
      onSaved(data); setName(data.name); setStatus('Saved. The next turn uses these settings.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save the agent.'); }
    finally { setBusy(false); }
  }
  const discard = () => {
    setName(saved.name); setError(''); setStatus('');
    choice.chooseEndpoint(saved.endpointId); choice.chooseModel(saved.model); choice.setThinking(saved.thinkingLevel);
  };
  return <section aria-label="Model" className="space-y-4">
    <div><h3 className="text-lg font-semibold">Model</h3><p className="mt-1 text-sm text-muted-foreground">Rename this agent or move it to another model. Its history and memory stay. Changes wait until it is not responding.</p></div>
    <div className="space-y-4 rounded-lg border border-border bg-sidebar/30 p-4">
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <div className="space-y-2"><label htmlFor={`${id}-name`} className="block text-sm font-medium">Name</label><input id={`${id}-name`} maxLength={80} value={name} onChange={event => { setName(event.target.value); setStatus(''); }} className={fieldClass} autoComplete="off" /></div>
        <div className="space-y-2"><label htmlFor={`${id}-endpoint`} className="block text-sm font-medium">Endpoint</label>
          <Select id={`${id}-endpoint`} value={choice.endpointId} onValueChange={value => { choice.chooseEndpoint(value); setStatus(''); }} placeholder="Select a model connection" options={choice.endpoints.map(endpoint => ({ value: endpoint.id, label: endpoint.name }))} />
          {endpointMissing && <p className="text-xs text-red-400">This agent&apos;s endpoint no longer exists. Choose another to make it respond again.</p>}</div>
        <div className="space-y-2"><label htmlFor={`${id}-model`} className="block text-sm font-medium">Model</label>
          <Select id={`${id}-model`} value={choice.model} onValueChange={value => { choice.chooseModel(value); setStatus(''); }} disabled={!choice.endpointId || (choice.loading && models.length === 0)} placeholder={choice.loading ? 'Loading models…' : 'Select a model'} options={models.map(value => ({ value, label: value }))} /></div>
        <div className="space-y-2"><label htmlFor={`${id}-thinking`} className="block text-sm font-medium">Thinking level</label>
          <Select id={`${id}-thinking`} value={choice.thinking} disabled={choice.levels.length <= 1} onValueChange={value => { if (choice.levels.includes(value as RealAgent['thinkingLevel'])) { choice.setThinking(value as RealAgent['thinkingLevel']); setStatus(''); } }} options={(choice.levels.length ? choice.levels : [choice.thinking]).map(level => ({ value: level, label: level === 'off' ? (choice.levels.length <= 1 ? 'Not configurable' : 'Off') : level[0].toUpperCase() + level.slice(1) }))} /></div>
      </fieldset>
      {choice.error && <p role="alert" className="text-sm">{choice.error}</p>}
      {error && <p role="alert" className="text-sm">{error}</p>}
      {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
      {dirty && <div className="flex flex-wrap justify-end gap-2 motion-safe:animate-[fade-in_160ms_ease-out]">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={discard}>Discard model changes</Button>
        <Button type="button" size="sm" disabled={busy || !ready} onClick={() => void save()}>{busy ? 'Saving model…' : 'Save model settings'}</Button>
      </div>}
    </div>
  </section>;
}
