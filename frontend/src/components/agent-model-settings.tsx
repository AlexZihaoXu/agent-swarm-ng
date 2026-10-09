import { useEffect, useId, useRef, useState } from 'react';
import { noAutofill } from '@/lib/no-autofill';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { choicesOf, ModelChoiceList, modelsOf, rowsOf, type ChoiceRow } from '@/components/model-choice-list';
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

/**
 * Name and ranked models of an existing agent (fallback models, docs/agent-models.md). Identity, history and private
 * context are kept; the next turn uses the new choice.
 */
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
  const [rows, setRows] = useState<ChoiceRow[]>(() => rowsOf(modelsOf(saved)));
  const modelsChanged = JSON.stringify(choicesOf(rows)) !== JSON.stringify(modelsOf(saved));
  const [name, setName] = useState(saved.name);
  // Renamed elsewhere (the agent's menu): the field follows.
  useEffect(() => setName(saved.name), [saved.name]);
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
  const dirty = name.trim() !== saved.name || modelsChanged || Object.keys(memoryChanges).length > 0;
  const ready = name.trim() && rows.every(row => row.endpointId && row.model);
  const capsInvalid = rows.some(row => row.invalid);
  async function save() {
    if (busy || !dirty) return;
    if (memoryInvalid) {
      throw new Error('Fix the active context settings first.');
    }
    if (capsInvalid) {
      const message = 'Fix the token caps first: whole numbers in range, or empty for the model’s own.';
      setError(message);
      throw new Error(message);
    }
    if (!ready) {
      const message = 'Choose a name, and an endpoint and model for every row.';
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
          ...(modelsChanged ? { models: choicesOf(rows) } : {}),
          ...(Object.keys(memoryChanges).length ? { compaction: memoryChanges } : {}),
        },
      });
      if (!data || failure) throw new Error(failure?.message ?? 'Could not save the agent.');
      onSaved(data);
      setName(data.name);
      setRows(rowsOf(modelsOf(data)));
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
    setRows(rowsOf(modelsOf(saved)));
    setError('');
    setStatus('');
  };
  // "Use #1 again": the next model call starts on #1.
  async function useFirst() {
    setError('');
    const { data, error: failure } = await api.POST('/api/agents/{id}/models/first', {
      params: { path: { id: agent.id } },
    });
    if (!data || failure) setError(failure?.message ?? 'Could not switch back to #1.');
    else onSaved(data);
  }
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
          Rename this agent or change its models. It uses #1, and moves down the list when a model fails; drag to rank
          them. Its history and memory stay. Changes wait until it is not responding. Use Save changes at the bottom.
        </p>
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-sidebar/30 ao-card p-4">
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
            <p className="text-sm font-medium">Models</p>
            {(saved.activeModel ?? 0) > 0 && (
              <div
                role="status"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  On #{(saved.activeModel ?? 0) + 1} since #1 failed.{' '}
                  {modelsOf(saved)[0]!.comeBack > 0
                    ? `It tries #1 again after ${modelsOf(saved)[0]!.comeBack} minutes.`
                    : 'It uses #1 again only when you switch back.'}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => void useFirst()}>
                  Use #1 again
                </Button>
              </div>
            )}
            <ModelChoiceList
              rows={rows}
              onChange={next => {
                setRows(next);
                setStatus('');
              }}
              organizationId={saved.organizationId}
              active={modelsChanged ? -1 : (saved.activeModel ?? 0)}
              disabled={busy}
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
