import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Switch } from '@/components/ui/switch';
import { NumberField } from '@/components/computer-resource-fields';
import type { ChatAgent, RealAgent } from '@/use-chat';
import type { RegisterSection } from '@/lib/settings-sections';

type Beat = { enabled: boolean; minutes: string; from: string; to: string; checklist: string };
const defaults = { enabled: false, minutes: 30, from: '', to: '', checklist: '', timeZone: '' };
const beatOf = (agent: RealAgent) => agent.heartbeat ?? defaults;
const draftOf = (agent: RealAgent): Beat => {
  const { enabled, minutes, from, to, checklist } = beatOf(agent);
  return { enabled, minutes: String(minutes), from, to, checklist };
};
const fieldClass =
  'h-11 w-full rounded-lg border border-border bg-sidebar px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:h-10';

/**
 * Agents → agent → Heartbeat: a periodic wake-up. The agent reads freely in a branch; its first change makes it a real
 * turn, otherwise the heartbeat is dropped (it shows in Activity) and only a note the agent chose to leave is kept.
 */
export function AgentHeartbeatSettings({
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
  const [draft, setDraft] = useState(() => draftOf(saved));
  const [status, setStatus] = useState('');
  const original = draftOf(saved);
  const dirty = (Object.keys(draft) as (keyof Beat)[]).some(key =>
    key === 'checklist' ? draft.checklist.trim() !== original.checklist.trim() : draft[key] !== original[key],
  );
  const minutes = Number(draft.minutes);
  const problem =
    !Number.isInteger(minutes) || minutes < 5 || minutes > 1440
      ? 'Every must be a whole number of minutes from 5 to 1440.'
      : Boolean(draft.from) !== Boolean(draft.to)
        ? 'Set both active hours, or neither for all day.'
        : '';
  const change = (next: Partial<Beat>) => {
    setDraft(current => ({ ...current, ...next }));
    setStatus('');
  };
  const latest = useRef({ save: async () => {}, discard: () => {} });
  latest.current = {
    save: async () => {
      if (problem) throw new Error(problem);
      const { data, error } = await api.PATCH('/api/agents/{id}', {
        params: { path: { id: agent.id } },
        body: { heartbeat: { ...draft, minutes, checklist: draft.checklist.trim() } },
      });
      if (!data || error) throw new Error(error?.message ?? 'Could not save the heartbeat.');
      onSaved(data);
      setDraft(draftOf(data));
      setStatus(data.heartbeat.enabled ? 'Saved. The first heartbeat comes one interval from now.' : 'Saved.');
    },
    discard: () => {
      setDraft(draftOf(saved));
      setStatus('');
    },
  };
  useEffect(() => {
    register('heartbeat', {
      label: 'Heartbeat',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('heartbeat');
  }, [dirty, register]);

  return (
    <section aria-label="Heartbeat" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Heartbeat</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {agent.name} wakes up on its own to check on things. Looking around is free; if nothing needs doing, the
          heartbeat is dropped and only shows in Activity. Its first action (a message, a timer, typing on a computer)
          makes it a normal turn. Use Save changes at the bottom.
        </p>
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-sidebar/30 p-4">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={`${id}-on`} className="cursor-pointer text-sm font-medium">
            Wake up periodically
          </label>
          <Switch id={`${id}-on`} checked={draft.enabled} onCheckedChange={enabled => change({ enabled })} />
        </div>
        <fieldset disabled={!draft.enabled} className="min-w-0 space-y-4 disabled:opacity-60">
          <legend className="sr-only">Heartbeat schedule</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              label="Every (minutes)"
              unit=""
              value={draft.minutes}
              min={5}
              max={1440}
              hint="5–1440 · counted from its last turn · default 30"
              disabled={!draft.enabled}
              onChange={value => change({ minutes: value })}
            />
            {(['from', 'to'] as const).map(key => (
              <div key={key} className="space-y-2">
                <label htmlFor={`${id}-${key}`} className="block text-sm font-medium">
                  {key === 'from' ? 'Active from' : 'Until'}
                </label>
                <input
                  id={`${id}-${key}`}
                  type="time"
                  value={draft[key]}
                  onChange={event => change({ [key]: event.target.value })}
                  className={fieldClass}
                />
                <p className="text-xs text-muted-foreground">
                  {key === 'from'
                    ? 'Empty for all day'
                    : `Server time${beatOf(saved).timeZone ? ` (${beatOf(saved).timeZone})` : ''}`}
                </p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-checklist`} className="block text-sm font-medium">
              What to check
            </label>
            <textarea
              id={`${id}-checklist`}
              value={draft.checklist}
              maxLength={4000}
              rows={4}
              onChange={event => change({ checklist: event.target.value })}
              placeholder="For example: Check the nightly build on Desk. Tell me if a pull request needs review."
              className="w-full resize-y rounded-lg border border-border bg-sidebar px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </fieldset>
        {problem && (
          <p role="alert" className="text-xs text-red-400">
            {problem}
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
