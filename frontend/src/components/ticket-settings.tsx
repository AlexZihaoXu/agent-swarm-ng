import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TicketWorkflow } from '@/components/ticket-workflow';
import { useOrganizations, type Organization } from '@/lib/organizations';
import { settingsInput } from '@/lib/styles';
import type { TicketSettings as Settings } from '@/lib/tickets';
import { cn } from '@/lib/utils';

const OPTIONS: {
  key: keyof Omit<Settings, 'enabled' | 'prefix' | 'archiveAfterDays'>;
  title: string;
  description: string;
}[] = [
  {
    key: 'wakeOnAssign',
    title: 'Assigning an agent wakes it',
    description: 'It gets the ticket as a platform event, like a timer firing, and starts on it.',
  },
  {
    key: 'agentsCreate',
    title: 'Agents can create tickets',
    description: 'With ticket_create granted, an agent can file follow-ups and hand work to another agent here.',
  },
  {
    key: 'agentsPickUp',
    title: 'Agents may pick up unassigned tickets',
    description: 'Off: agents change only tickets assigned to them. On: an agent can take an unassigned one.',
  },
];
const ARCHIVE_DAYS = [0, 7, 14, 30, 60, 90, 180, 365];
const daysLabel = (days: number) => (days ? `After ${days} days` : 'Never');

/**
 * Organization → Tickets (docs/tickets.md): turn the board on for the organization in view (off by default),
 * choose how agents may use it and when closed tickets are archived, and edit its workflow states. Each switch saves
 * at once, like the notification settings (Kibo switch-cards-3).
 */
export function TicketSettings({ card, organization }: { card: string; organization: Organization }) {
  const id = useId();
  const { refresh } = useOrganizations();
  const location = useLocation();
  const section = useRef<HTMLElement>(null);
  const settings = organization.tickets;
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => setPrefix(settings?.prefix ?? ''), [organization.id, settings?.prefix]);
  // The Tickets tab's "Open organization settings" lands here.
  useEffect(() => {
    if (location.hash === '#tickets') section.current?.scrollIntoView({ block: 'start' });
  }, [location.hash, location.key]);
  if (!settings) return null;
  const save = async (tickets: Partial<Settings>, done: string) => {
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await api.PATCH('/api/organizations/{id}', {
        params: { path: { id: organization.id } },
        body: { tickets },
      });
      if (!data) throw new Error(error?.message ?? 'Could not save.');
      await refresh();
      setMessage(done);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section ref={section} id="tickets" aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-4">
      <div>
        <h3 id={`${id}-title`} className="text-lg font-semibold">
          Tickets
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A shared board of work for this organization's people and agents, in its own Tickets tab. Agents see and
          change tickets only with the ticket tools you grant them (Agent settings → Tickets), and only in their own
          organization.
        </p>
      </div>
      <div className={cn(card, 'space-y-4')}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor={`${id}-enabled`} className="cursor-pointer text-sm font-medium">
              Tickets for {organization.name}
            </label>
            <p className="text-xs text-muted-foreground">
              Off by default. Turning it off hides the tab and keeps the tickets.
            </p>
          </div>
          <Switch
            id={`${id}-enabled`}
            checked={settings.enabled}
            disabled={busy}
            onCheckedChange={enabled =>
              void save(
                { enabled },
                enabled ? 'Tickets are on: the Tickets tab shows this organization’s board.' : 'Tickets are off.',
              )
            }
          />
        </div>
        {settings.enabled && (
          <>
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background motion-safe:animate-[view-in_260ms_cubic-bezier(0.22,1,0.36,1)]">
              {OPTIONS.map(option => (
                <div key={option.key} className="flex items-center justify-between gap-4 p-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <label htmlFor={`${id}-${option.key}`} className="cursor-pointer text-sm font-medium">
                      {option.title}
                    </label>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                  <Switch
                    id={`${id}-${option.key}`}
                    checked={settings[option.key]}
                    disabled={busy}
                    onCheckedChange={value => void save({ [option.key]: value }, 'Saved.')}
                  />
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label htmlFor={`${id}-archive`} className="text-sm font-medium">
                    Archive closed tickets
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Tickets in a completed or canceled state for this long leave the board (Show archived finds them).
                  </p>
                </div>
                <div className="w-40">
                  <Select
                    id={`${id}-archive`}
                    value={String(settings.archiveAfterDays)}
                    disabled={busy}
                    options={[...new Set([...ARCHIVE_DAYS, settings.archiveAfterDays])]
                      .sort((a, b) => (a || Infinity) - (b || Infinity))
                      .map(days => ({ value: String(days), label: daysLabel(days) }))}
                    onValueChange={value => void save({ archiveAfterDays: Number(value) }, 'Saved.')}
                  />
                </div>
              </div>
            </div>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={event => {
                event.preventDefault();
                void save({ prefix }, 'Saved: ticket ids use the new prefix.');
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor={`${id}-prefix`} className="block text-sm font-medium">
                  Ticket prefix
                </label>
                <input
                  id={`${id}-prefix`}
                  value={prefix}
                  maxLength={6}
                  disabled={busy}
                  onChange={event => setPrefix(event.target.value.toUpperCase())}
                  className={cn(settingsInput, 'w-32 font-mono uppercase')}
                />
              </div>
              {prefix !== settings.prefix && (
                <Button type="submit" size="sm" disabled={busy} className="min-h-11 sm:min-h-0">
                  Save prefix
                </Button>
              )}
              <p className="w-full text-xs text-muted-foreground">
                Ids look like {settings.prefix}-14. Empty: from the organization's name.
              </p>
            </form>
          </>
        )}
        {message && (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </div>
      {settings.enabled && <TicketWorkflow card={card} organizationId={organization.id} />}
    </section>
  );
}
