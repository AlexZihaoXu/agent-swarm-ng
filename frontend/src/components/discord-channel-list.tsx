import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { PickerDialog, PickerGroup, PickerItem } from '@/components/picker-dialog';

type Admission = 'mention' | 'check' | 'all';
type Channel = {
  id: string;
  guildId: string | null;
  guildName: string | null;
  name: string;
  kind: string;
  paused: boolean;
};
export type ChannelChoice = { allowed: boolean; admission: Admission | null };
type Server = { id: string; name: string; channels: Channel[] };

const label = (channel: Channel) => (channel.kind === 'thread' ? `↳ ${channel.name}` : `#${channel.name}`);
/** Servers (Discord's "guilds") and the channels the bot can see in each, by name. */
function serversOf(channels: Channel[]): Server[] {
  const servers = new Map<string, Server>();
  for (const channel of channels) {
    if (channel.kind === 'dm' || !channel.guildId) continue;
    const server = servers.get(channel.guildId) ?? {
      id: channel.guildId,
      name: channel.guildName ?? 'Unnamed server',
      channels: [],
    };
    server.channels.push(channel);
    servers.set(channel.guildId, server);
  }
  return [...servers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "Channels it may use": the chosen channels in a bounded scrolling list (Kibo scroll-area-layout-1), grouped by
 * server, each with when it wakes the agent; "Add channels" opens a search over every server and channel the bot
 * can see (Kibo command-dialog-3). Changes join the page's Save changes.
 */
export function DiscordChannelList({
  channels,
  choices,
  admissionOptions,
  onChange,
  empty,
  inheritIcon,
}: {
  channels: Channel[];
  choices: Record<string, ChannelChoice>;
  admissionOptions: { value: Admission; label: string; icon?: React.ReactNode }[];
  /** Icon for "As set above". */
  inheritIcon?: React.ReactNode;
  onChange: (choices: Record<string, ChannelChoice>) => void;
  /** Shown when the bot sees no server yet. */
  empty: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const servers = serversOf(channels);
  const choice = (channel: Channel) => choices[channel.id] ?? { allowed: false, admission: null };
  const set = (changes: [Channel, Partial<ChannelChoice>][]) =>
    onChange({
      ...choices,
      ...Object.fromEntries(changes.map(([channel, change]) => [channel.id, { ...choice(channel), ...change }])),
    });
  const chosen = servers
    .map(server => ({ ...server, channels: server.channels.filter(channel => choice(channel).allowed) }))
    .filter(server => server.channels.length);
  const count = chosen.reduce((total, server) => total + server.channels.length, 0);

  return (
    <div role="group" aria-labelledby={`${id}-title`} className="space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p id={`${id}-title`} className="text-xs font-medium">
          Channels it may use{' '}
          <span className="font-normal text-muted-foreground">
            · {count} of {servers.reduce((total, server) => total + server.channels.length, 0)}
          </span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!servers.length}
          className="min-h-11 sm:min-h-8"
          onClick={() => setOpen(true)}
        >
          Add channels
        </Button>
      </div>
      {!servers.length ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : !count ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No channels yet. Add the ones it may read and post in; threads follow their channel.
        </p>
      ) : (
        <div
          role="region"
          aria-label="Chosen channels"
          tabIndex={0}
          className="max-h-72 overflow-y-auto overscroll-contain rounded-md border border-border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {chosen.map(server => (
            <section key={server.id} aria-label={server.name} className="border-b border-border last:border-b-0">
              <h5 className="sticky top-0 z-10 bg-background/95 px-3 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground backdrop-blur-sm">
                {server.name}
              </h5>
              <ul className="px-1 pb-1">
                {server.channels.map(channel => {
                  const value = choice(channel);
                  return (
                    <li
                      key={channel.id}
                      className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 hover:bg-muted/50 sm:min-h-9 sm:flex-nowrap"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm" title={label(channel)}>
                        {label(channel)}
                        {channel.kind === 'forum' && <span className="text-xs text-muted-foreground"> · forum</span>}
                        {channel.paused && (
                          <span className="text-xs text-amber-400"> · paused: only bots spoke lately</span>
                        )}
                      </span>
                      {channel.kind !== 'thread' && (
                        <div className="order-last w-full sm:order-none sm:w-48">
                          <Select
                            id={`${id}-admission-${channel.id}`}
                            ariaLabel={`When ${label(channel)} wakes it`}
                            value={value.admission ?? 'default'}
                            onValueChange={next =>
                              set([[channel, { admission: next === 'default' ? null : (next as Admission) }]])
                            }
                            options={[
                              { value: 'default', label: 'As set above', icon: inheritIcon },
                              ...admissionOptions,
                            ]}
                            triggerClassName="!h-11 sm:!h-8 !text-xs"
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${label(channel)}`}
                        title="Remove"
                        onClick={() => set([[channel, { allowed: false }]])}
                        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:size-8"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <PickerDialog
        open={open}
        onOpenChange={setOpen}
        title="Add channels"
        placeholder="Search servers and channels…"
        empty="No server or channel by that name."
        status={`${count} chosen · save the page to apply`}
      >
        {servers.map(server => {
          const whole = server.channels.filter(channel => channel.kind !== 'thread');
          const all = whole.every(channel => choice(channel).allowed);
          return (
            <PickerGroup key={server.id} heading={server.name}>
              <PickerItem
                value={`server:${server.id}`}
                keywords={[server.name, 'all channels', 'server']}
                checked={all}
                onSelect={() => set(whole.map(channel => [channel, { allowed: !all }]))}
              >
                <span className="min-w-0 truncate">All channels in {server.name}</span>
              </PickerItem>
              {server.channels.map(channel => (
                <PickerItem
                  key={channel.id}
                  value={channel.id}
                  keywords={[channel.name, server.name]}
                  checked={choice(channel).allowed}
                  onSelect={() => set([[channel, { allowed: !choice(channel).allowed }]])}
                >
                  <span className="min-w-0 truncate">
                    {label(channel)}
                    {channel.kind === 'forum' && <span className="text-xs text-muted-foreground"> · forum</span>}
                  </span>
                </PickerItem>
              ))}
            </PickerGroup>
          );
        })}
      </PickerDialog>
    </div>
  );
}
