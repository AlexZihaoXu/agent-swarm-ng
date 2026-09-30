import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { PickerDialog, PickerGroup, PickerItem } from '@/components/picker-dialog';

export type DmPerson = { id: string; name: string };
const SNOWFLAKE = /^\d{15,21}$/;

/**
 * "Allowed DMs": the people (besides you and your agents) who may DM this agent's bot, as a whitelist; anyone else's
 * DMs are dropped unread. Chosen people in a short list (× to remove); "Add people" searches people the bot has seen
 * in its servers, or takes a Discord user ID. Changes join the page's Save changes.
 */
export function DiscordDmList({
  agentId,
  people,
  onChange,
}: {
  agentId: string;
  people: DmPerson[];
  onChange: (people: DmPerson[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const seen = useQuery({
    queryKey: ['agent-discord-people', agentId, search],
    enabled: open,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/agents/{id}/discord/people', {
        params: { path: { id: agentId }, query: search.trim() ? { search: search.trim() } : {} },
        signal,
      });
      if (!data) throw new Error(error?.message ?? 'Could not load people.');
      return data.people;
    },
  });
  const chosen = new Set(people.map(person => person.id));
  const toggle = (person: DmPerson) =>
    onChange(chosen.has(person.id) ? people.filter(item => item.id !== person.id) : [...people, person]);
  const typedId = search.trim();
  return (
    <div role="group" aria-labelledby={`${id}-title`} className="space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p id={`${id}-title`} className="text-xs font-medium">
          Allowed DMs <span className="font-normal text-muted-foreground">· {people.length}</span>
        </p>
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen(true)}>
          Add people
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        You and your agents can always DM this bot. Anyone else only if they are listed here; their other DMs are
        dropped unread.
      </p>
      {people.length ? (
        <ul
          aria-label="People allowed to DM"
          className="max-h-56 overflow-y-auto overscroll-contain rounded-md border border-border bg-background p-1"
        >
          {people.map(person => (
            <li
              key={person.id}
              className="flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50 sm:min-h-9"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{person.name}</span>
              <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">{person.id}</span>
              <button
                type="button"
                aria-label={`Remove ${person.name}`}
                title="Remove"
                onClick={() => toggle(person)}
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:size-8"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Nobody else yet.
        </p>
      )}
      <PickerDialog
        open={open}
        onOpenChange={setOpen}
        title="Allow DMs from"
        placeholder="Search people, or paste a Discord user ID…"
        empty={seen.isPending ? 'Loading people…' : 'Nobody by that name. Paste their Discord user ID instead.'}
        status={`${people.length} allowed · save the page to apply`}
        search={{ value: search, onChange: setSearch }}
      >
        {SNOWFLAKE.test(typedId) && (
          <PickerGroup heading="By user ID">
            <PickerItem
              value={`id:${typedId}`}
              checked={chosen.has(typedId)}
              onSelect={() => toggle(people.find(person => person.id === typedId) ?? { id: typedId, name: typedId })}
            >
              <span className="min-w-0 truncate font-mono">{typedId}</span>
            </PickerItem>
          </PickerGroup>
        )}
        <PickerGroup heading="Seen in its servers">
          {(seen.data ?? []).map(person => (
            <PickerItem
              key={person.id}
              value={person.id}
              checked={chosen.has(person.id)}
              onSelect={() => toggle({ id: person.id, name: person.name })}
            >
              <span className="min-w-0 truncate">
                {person.name}
                {person.bot && <span className="text-xs text-muted-foreground"> · bot</span>}
              </span>
            </PickerItem>
          ))}
        </PickerGroup>
      </PickerDialog>
    </div>
  );
}
