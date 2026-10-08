import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { NumberField } from '@/components/computer-resource-fields';
import { ChevronDownIcon, ChevronUpIcon, GripIcon, PlusIcon, XIcon } from '@/components/ui/icons';
import { codexConnection, useModelSelection, type ModelEndpoint } from '@/use-model-selection';
import type { RealAgent } from '@/use-chat';
import { cn } from '@/lib/utils';

export type ModelChoice = RealAgent['models'][number];
export type ChoiceRow = ModelChoice & { key: string };
type Thinking = RealAgent['thinkingLevel'];

/** Bounds the backend enforces too (docs/agent-models.md). */
export const MAX_MODELS = 5;
const COME_BACK_MINUTES = [1, 2, 5, 10, 15, 30, 60];
export const NEW_CHOICE: ModelChoice = {
  endpointId: '',
  model: '',
  thinkingLevel: 'off',
  attempts: 3,
  tooBig: 'skip',
  comeBack: 5,
};
/** An agent's ranked models (one, with the default options, when a record predates fallback models). */
export const modelsOf = (agent: Pick<RealAgent, 'endpointId' | 'model' | 'thinkingLevel'> & Partial<RealAgent>) =>
  agent.models?.length
    ? agent.models
    : [{ ...NEW_CHOICE, endpointId: agent.endpointId, model: agent.model, thinkingLevel: agent.thinkingLevel }];
export const rowsOf = (models: ModelChoice[]): ChoiceRow[] =>
  models.map(model => ({ ...model, key: crypto.randomUUID() }));
export const choicesOf = (rows: ChoiceRow[]): ModelChoice[] => rows.map(({ key: _key, ...choice }) => choice);

const thinkingLabel = (level: Thinking) => (level === 'off' ? 'Off' : level[0]!.toUpperCase() + level.slice(1));

/** The owner's model connections, for the collapsed rows' names (the open row loads its own lists). */
function useEndpointNames(organizationId: string) {
  const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const query = { organizationId };
    void Promise.all([
      api.GET('/api/model-endpoints', { params: { query }, signal: controller.signal }),
      api.GET('/api/providers/openai-codex', { params: { query }, signal: controller.signal }),
    ])
      .then(([{ data }, { data: codex }]) => {
        if (controller.signal.aborted) return;
        setEndpoints([
          ...(codex?.connected ? [{ id: codexConnection, name: 'OpenAI Codex (ChatGPT)', baseUrl: '' }] : []),
          ...(data ?? []),
        ]);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [organizationId]);
  return (id: string) =>
    endpoints.find(endpoint => endpoint.id === id)?.name ?? (id === codexConnection ? 'ChatGPT' : 'Removed endpoint');
}

/**
 * Fallback models: the agent's ranked models, #1 first, as collapsed rows (the owner's chosen layout). One row opens
 * at a time to edit its model and options, and to move or remove it. Rank by dragging the grip, or with ↑/↓ on it.
 */
export function ModelChoiceList({
  rows,
  onChange,
  organizationId,
  active,
  disabled,
}: {
  rows: ChoiceRow[];
  onChange: (rows: ChoiceRow[]) => void;
  organizationId: string;
  /** The model the agent is on now (0 is #1), shown on its row when it is not #1. */
  active: number;
  disabled: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const endpointName = useEndpointNames(organizationId);
  const list = useRef<HTMLOListElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const latest = useRef({ rows, onChange });
  latest.current = { rows, onChange };

  const move = (from: number, to: number) => {
    const current = latest.current.rows;
    if (to < 0 || to >= current.length || from === to) return;
    const next = current.slice();
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    latest.current.onChange(next);
    latest.current.rows = next;
  };
  const update = (key: string, patch: Partial<ModelChoice>) =>
    onChange(rows.map(row => (row.key === key ? { ...row, ...patch } : row)));

  // Dragging a grip: the row trades places with a neighbour once the pointer passes that neighbour's middle.
  const startDrag = (event: PointerEvent<HTMLButtonElement>, key: string) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    setDragging(key);
    const onMove = (moved: globalThis.PointerEvent) => {
      if (moved.pointerId !== pointerId || !list.current) return;
      const items = [...list.current.querySelectorAll<HTMLElement>(':scope > li')];
      const index = latest.current.rows.findIndex(row => row.key === key);
      const above = items[index - 1]?.getBoundingClientRect();
      const below = items[index + 1]?.getBoundingClientRect();
      if (above && moved.clientY < above.top + above.height / 2) move(index, index - 1);
      else if (below && moved.clientY > below.top + below.height / 2) move(index, index + 1);
    };
    const onEnd = (ended: globalThis.PointerEvent) => {
      if (ended.pointerId !== pointerId) return;
      setDragging(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };
  const gripKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    move(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
  };

  return (
    <div className="space-y-2">
      <ol ref={list} className="space-y-2" aria-label="Models in order of use">
        {rows.map((row, index) => {
          const expanded = open === row.key;
          const summary = row.model
            ? `${endpointName(row.endpointId)} · ${row.model} · ${thinkingLabel(row.thinkingLevel)}`
            : 'Choose a model';
          return (
            <m.li
              key={row.key}
              layout="position"
              transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              className={cn(
                'rounded-lg border border-border bg-background/60',
                dragging === row.key && 'relative z-10 ao-raised',
              )}
            >
              <div className="flex min-h-12 items-center gap-1 py-1 pr-2 pl-1">
                <button
                  type="button"
                  aria-label={`Move #${index + 1} (drag, or use the arrow keys)`}
                  title="Drag to rank"
                  disabled={disabled || rows.length < 2}
                  onPointerDown={event => startDrag(event, row.key)}
                  onKeyDown={event => gripKeys(event, index)}
                  className="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <GripIcon />
                </button>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`${row.key}-editor`}
                  onClick={() => setOpen(expanded ? null : row.key)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="shrink-0 text-sm font-semibold tabular-nums">#{index + 1}</span>
                  <span className={cn('min-w-0 truncate text-sm', !row.model && 'text-muted-foreground')}>
                    {summary}
                  </span>
                  {active === index && active > 0 && (
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      In use
                    </span>
                  )}
                  <ChevronDownIcon
                    className={cn(
                      'ml-auto text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                      expanded && 'rotate-180',
                    )}
                  />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {expanded && (
                  <m.div
                    key="editor"
                    id={`${row.key}-editor`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <ChoiceEditor
                      row={row}
                      first={index === 0}
                      last={index === rows.length - 1}
                      organizationId={organizationId}
                      disabled={disabled}
                      onChange={patch => update(row.key, patch)}
                    />
                    <div className="flex flex-wrap gap-2 border-t border-border px-3 py-3 sm:px-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={disabled || index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ChevronUpIcon />
                        Move up
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={disabled || index === rows.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ChevronDownIcon />
                        Move down
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-auto gap-1.5"
                        aria-label={`Remove #${index + 1}`}
                        disabled={disabled || rows.length < 2}
                        onClick={() => {
                          setOpen(null);
                          onChange(rows.filter(item => item.key !== row.key));
                        }}
                      >
                        <XIcon />
                        Remove
                      </Button>
                    </div>
                  </m.div>
                )}
              </AnimatePresence>
            </m.li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        disabled={disabled || rows.length >= MAX_MODELS}
        onClick={() => {
          const row = { ...NEW_CHOICE, key: crypto.randomUUID() };
          onChange([...rows, row]);
          setOpen(row.key);
        }}
      >
        <PlusIcon />
        {rows.length >= MAX_MODELS ? `Up to ${MAX_MODELS} models` : 'Add model'}
      </Button>
    </div>
  );
}

/** One open row: its model (endpoint → model → thinking, loaded for this row only) and its fallback options. */
function ChoiceEditor({
  row,
  first,
  last,
  organizationId,
  disabled,
  onChange,
}: {
  row: ChoiceRow;
  first: boolean;
  last: boolean;
  organizationId: string;
  disabled: boolean;
  onChange: (patch: Partial<ModelChoice>) => void;
}) {
  const id = useId();
  const choice = useModelSelection(
    row.model ? { endpointId: row.endpointId, model: row.model, thinkingLevel: row.thinkingLevel } : undefined,
    organizationId,
  );
  const [attempts, setAttempts] = useState(String(row.attempts));
  // The pickers report up as they settle (a new endpoint clears its model; a model picks its thinking level).
  useEffect(() => {
    if (choice.endpointId !== row.endpointId || choice.model !== row.model || choice.thinking !== row.thinkingLevel)
      onChange({ endpointId: choice.endpointId, model: choice.model, thinkingLevel: choice.thinking });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice.endpointId, choice.model, choice.thinking]);
  const models =
    choice.model && !choice.models.includes(choice.model) ? [choice.model, ...choice.models] : choice.models;
  const comeBackOptions = [...new Set([...COME_BACK_MINUTES, ...(row.comeBack > 0 ? [row.comeBack] : [])])]
    .sort((a, b) => a - b)
    .map(minutes => ({ value: String(minutes), label: `After ${minutes} minute${minutes === 1 ? '' : 's'}` }));
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4 border-t border-border p-3 sm:p-4">
      <legend className="sr-only">Model and options</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="min-w-0 space-y-2">
          <label htmlFor={`${id}-endpoint`} className="block text-sm font-medium">
            Endpoint
          </label>
          <Select
            id={`${id}-endpoint`}
            value={choice.endpointId}
            onValueChange={choice.chooseEndpoint}
            placeholder="Select a connection"
            options={choice.endpoints.map(endpoint => ({ value: endpoint.id, label: endpoint.name }))}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <label htmlFor={`${id}-model`} className="block text-sm font-medium">
            Model
          </label>
          <Select
            id={`${id}-model`}
            value={choice.model}
            onValueChange={choice.chooseModel}
            disabled={!choice.endpointId || (choice.loading && models.length === 0)}
            placeholder={choice.loading ? 'Loading models…' : 'Select a model'}
            options={models.map(value => ({ value, label: value }))}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <label htmlFor={`${id}-thinking`} className="block text-sm font-medium">
            Thinking level
          </label>
          <Select
            id={`${id}-thinking`}
            value={choice.thinking}
            disabled={choice.levels.length <= 1}
            onValueChange={value => {
              if (choice.levels.includes(value as Thinking)) choice.setThinking(value as Thinking);
            }}
            options={(choice.levels.length ? choice.levels : [choice.thinking]).map(level => ({
              value: level,
              label: level === 'off' && choice.levels.length <= 1 ? 'Not configurable' : thinkingLabel(level),
            }))}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          label="Tries before moving on"
          unit=""
          value={attempts}
          min={1}
          max={5}
          hint="1–5 · a rejected login moves on at once"
          disabled={disabled}
          onChange={value => {
            setAttempts(value);
            const parsed = Number(value);
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) onChange({ attempts: parsed });
          }}
        />
        {!first && (
          <div className="min-w-0 space-y-2">
            <label htmlFor={`${id}-too-big`} className="block text-sm font-medium">
              If the chat is too big for it
            </label>
            <Select
              id={`${id}-too-big`}
              value={row.tooBig}
              onValueChange={value => onChange({ tooBig: value === 'compact' ? 'compact' : 'skip' })}
              options={[
                { value: 'skip', label: 'Skip it' },
                { value: 'compact', label: 'Compact to fit, then use it' },
              ]}
            />
          </div>
        )}
        {!last && (
          <div className="min-w-0 space-y-2">
            <label htmlFor={`${id}-come-back`} className="block text-sm font-medium">
              Come back to it after it fails
            </label>
            <Select
              id={`${id}-come-back`}
              value={String(row.comeBack)}
              onValueChange={value => onChange({ comeBack: Number(value) })}
              options={[...comeBackOptions, { value: '0', label: 'Only when I switch back' }]}
            />
          </div>
        )}
      </div>
      {choice.error && (
        <p role="alert" className="text-sm">
          {choice.error}
        </p>
      )}
    </fieldset>
  );
}
