import { useEffect, useId, useRef, useState } from 'react';
import { noAutofill } from '@/lib/no-autofill';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useModelSelection } from '@/use-model-selection';
import type { ChatAgent, RealAgent } from '@/use-chat';
import type { RegisterSection } from '@/lib/settings-sections';
import { NumberField } from '@/components/computer-resource-fields';

/** Background compaction bounds (the backend enforces the same). */
const memoryFields = [
  {
    key: 'atPercent',
    label: 'Compact while working at (%)',
    hint: '20–90% of the context · default 65',
    min: 20,
    max: 90,
  },
  {
    key: 'idleMinutes',
    label: 'Compact when idle for (minutes)',
    hint: '0–1440 · 0 = never · default 30',
    min: 0,
    max: 1440,
  },
  { key: 'idlePercent', label: '…if the context is at least (%)', hint: '10–90% full · default 50', min: 10, max: 90 },
] as const;
type MemoryKey = (typeof memoryFields)[number]['key'];
/** The saved policy (defaults when an older backend or record has none). */
const policyOf = (agent: RealAgent) => agent.compaction ?? { atPercent: 65, idleMinutes: 30, idlePercent: 50 };
const memoryOf = (agent: RealAgent) =>
  Object.fromEntries(memoryFields.map(field => [field.key, String(policyOf(agent)[field.key])])) as Record<
    MemoryKey,
    string
  >;

const fieldClass =
  'h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:h-10';

/** Name and model connection of an existing agent. Identity, history and private context are kept; the next turn uses the new choice. */
export function AgentModelSettings({
  agent,
  onSaved,
  register,
}: {
  agent: ChatAgent & { real: RealAgent };
  onSaved: (agent: RealAgent) => void;
  register: RegisterSection;
}) {
  const id = useId();
  const saved = agent.real;
  const choice = useModelSelection({
    endpointId: saved.endpointId,
    model: saved.model,
    thinkingLevel: saved.thinkingLevel,
  });
  const [name, setName] = useState(saved.name);
  const [memory, setMemory] = useState(() => memoryOf(saved));
  const memoryChanges = Object.fromEntries(
    memoryFields.flatMap(field =>
      Number(memory[field.key]) !== policyOf(saved)[field.key] ? [[field.key, Number(memory[field.key])]] : [],
    ),
  );
  const memoryInvalid = memoryFields.find(field => {
    const value = Number(memory[field.key]);
    return memory[field.key].trim() === '' || !Number.isInteger(value) || value < field.min || value > field.max;
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const endpointMissing =
    !choice.loading && !choice.loadFailed && !choice.endpoints.some(endpoint => endpoint.id === choice.endpointId);
  const models =
    choice.model && !choice.models.includes(choice.model) ? [choice.model, ...choice.models] : choice.models;
  const dirty =
    name.trim() !== saved.name ||
    choice.endpointId !== saved.endpointId ||
    choice.model !== saved.model ||
    choice.thinking !== saved.thinkingLevel ||
    Object.keys(memoryChanges).length > 0;
  const ready =
    name.trim() &&
    choice.endpointId &&
    choice.model &&
    (choice.levels.length === 0 || choice.levels.includes(choice.thinking));
  async function save() {
    if (busy || !dirty) return;
    if (memoryInvalid) {
      throw new Error('Fix the active context settings first.');
    }
    if (!ready) {
      const message = 'Choose a name, endpoint and model first.';
      setError(message);
      throw new Error(message);
    }
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const { data, error: failure } = await api.PATCH('/api/agents/{id}', {
        params: { path: { id: agent.id } },
        body: {
          ...(name.trim() !== saved.name ? { name: name.trim() } : {}),
          ...(choice.endpointId !== saved.endpointId ? { endpointId: choice.endpointId } : {}),
          ...(choice.model !== saved.model ? { model: choice.model } : {}),
          ...(choice.thinking !== saved.thinkingLevel ? { thinkingLevel: choice.thinking } : {}),
          ...(Object.keys(memoryChanges).length ? { compaction: memoryChanges } : {}),
        },
      });
      if (!data || failure) throw new Error(failure?.message ?? 'Could not save the agent.');
      onSaved(data);
      setName(data.name);
      setMemory(memoryOf(data));
      setStatus('Saved. The next turn uses these settings.');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save the agent.');
      throw problem;
    } finally {
      setBusy(false);
    }
  }
  const discard = () => {
    setName(saved.name);
    setMemory(memoryOf(saved));
    setError('');
    setStatus('');
    choice.chooseEndpoint(saved.endpointId);
    choice.chooseModel(saved.model);
    choice.setThinking(saved.thinkingLevel);
  };
  const latest = useRef({ save, discard });
  latest.current = { save, discard };
  useEffect(() => {
    register('model', {
      label: 'Model',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('model');
  }, [dirty, register]);
  return (
    <section aria-label="Model" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Model</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Rename this agent or move it to another model. Its history and memory stay. Changes wait until it is not
          responding. Use Save changes at the bottom.
        </p>
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-sidebar/30 p-4">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="space-y-2">
            <label htmlFor={`${id}-name`} className="block text-sm font-medium">
              Name
            </label>
            <input
              id={`${id}-name`}
              maxLength={80}
              value={name}
              onChange={event => {
                setName(event.target.value);
                setStatus('');
              }}
              className={fieldClass}
              {...noAutofill}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-endpoint`} className="block text-sm font-medium">
              Endpoint
            </label>
            <Select
              id={`${id}-endpoint`}
              value={choice.endpointId}
              onValueChange={value => {
                choice.chooseEndpoint(value);
                setStatus('');
              }}
              placeholder="Select a model connection"
              options={choice.endpoints.map(endpoint => ({ value: endpoint.id, label: endpoint.name }))}
            />
            {endpointMissing && (
              <p className="text-xs text-red-400">
                This agent&apos;s endpoint no longer exists. Choose another to make it respond again.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-model`} className="block text-sm font-medium">
              Model
            </label>
            <Select
              id={`${id}-model`}
              value={choice.model}
              onValueChange={value => {
                choice.chooseModel(value);
                setStatus('');
              }}
              disabled={!choice.endpointId || (choice.loading && models.length === 0)}
              placeholder={choice.loading ? 'Loading models…' : 'Select a model'}
              options={models.map(value => ({ value, label: value }))}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-thinking`} className="block text-sm font-medium">
              Thinking level
            </label>
            <Select
              id={`${id}-thinking`}
              value={choice.thinking}
              disabled={choice.levels.length <= 1}
              onValueChange={value => {
                if (choice.levels.includes(value as RealAgent['thinkingLevel'])) {
                  choice.setThinking(value as RealAgent['thinkingLevel']);
                  setStatus('');
                }
              }}
              options={(choice.levels.length ? choice.levels : [choice.thinking]).map(level => ({
                value: level,
                label:
                  level === 'off'
                    ? choice.levels.length <= 1
                      ? 'Not configurable'
                      : 'Off'
                    : level[0].toUpperCase() + level.slice(1),
              }))}
            />
          </div>
        </fieldset>
        {/* Background compaction: the agent summarizes older context without stopping (see Knowledge). */}
        <fieldset disabled={busy} className="min-w-0 space-y-3 border-t border-border pt-4">
          <legend className="sr-only">Active context</legend>
          <div>
            <p className="text-sm font-medium">Active context</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Older context is summarized in the background so the agent never stops to compact. If its context fills
              before the summary is ready, it sleeps until it is.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {memoryFields.map(field => (
              <NumberField
                key={field.key}
                label={field.label}
                unit=""
                value={memory[field.key]}
                min={field.min}
                max={field.max}
                hint={field.hint}
                disabled={busy}
                onChange={value => {
                  setMemory(current => ({ ...current, [field.key]: value }));
                  setStatus('');
                }}
              />
            ))}
          </div>
          {memoryInvalid && (
            <p role="alert" className="text-xs text-red-400">
              {memoryInvalid.label.replace(/ \(.*\)$/, '')} must be a whole number from {memoryInvalid.min} to{' '}
              {memoryInvalid.max}.
            </p>
          )}
        </fieldset>
        {choice.error && (
          <p role="alert" className="text-sm">
            {choice.error}
            {choice.loadFailed && (
              <>
                {' '}
                <button type="button" onClick={choice.reload} className="cursor-pointer underline">
                  Retry
                </button>
              </>
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
