import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/api/client';
import { Select } from '@/components/ui/select';
import type { ChatAgent, RealAgent } from '@/use-chat';
import type { RegisterSection } from '@/lib/settings-sections';

/** Window lengths that divide the hour, so windows line up with the clock (backend TIME_NOTE_CHOICES). */
const CHOICES = [0, 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60] as const;
const label = (minutes: number) =>
  minutes === 0 ? 'Off' : minutes === 60 ? 'Every hour' : `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;

/**
 * Agents → agent → Time notes (docs/agent-time.md#time-notes): while it works, the agent is told the current time
 * once per clock-aligned window, before its next model call, never interrupting. Same section composition as
 * Heartbeat; saved with the page's Save changes.
 */
export function AgentTimeNoteSettings({
  agent,
  onSaved,
  register,
}: {
  agent: ChatAgent & { real: RealAgent };
  onSaved: (agent: RealAgent) => void;
  register: RegisterSection;
}) {
  const id = useId();
  const saved = agent.real.timeNoteMinutes;
  const [draft, setDraft] = useState(String(saved));
  const [status, setStatus] = useState('');
  const dirty = draft !== String(saved);
  const latest = useRef({ save: async () => {}, discard: () => {} });
  latest.current = {
    save: async () => {
      const { data, error } = await api.PATCH('/api/agents/{id}', {
        params: { path: { id: agent.id } },
        body: { timeNoteMinutes: Number(draft) as (typeof CHOICES)[number] },
      });
      if (!data || error) throw new Error(error?.message ?? 'Could not save the time notes.');
      onSaved(data);
      setDraft(String(data.timeNoteMinutes));
      setStatus('Saved. It applies from the agent’s next step, even mid-work.');
    },
    discard: () => {
      setDraft(String(saved));
      setStatus('');
    },
  };
  useEffect(() => {
    register('time-notes', {
      label: 'Time notes',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('time-notes');
  }, [dirty, register]);

  return (
    <section aria-label="Time notes" className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Time notes</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          While {agent.name} works, it is told the current time once in each window (on the clock: every 15 minutes
          means :00, :15, :30, :45), just before it thinks again. It never interrupts, keeps a sense of how long it has
          been working, and shows in Activity.
        </p>
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-sidebar/30 ao-card p-4">
        <label htmlFor={`${id}-minutes`} className="block text-sm font-medium">
          Tell the time
        </label>
        <div className="max-w-56">
          <Select
            id={`${id}-minutes`}
            value={draft}
            onValueChange={value => {
              setDraft(value);
              setStatus('');
            }}
            options={CHOICES.map(minutes => ({ value: String(minutes), label: label(minutes) }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">Default every 15 minutes · 1 minute to an hour, or off</p>
        {status && (
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
