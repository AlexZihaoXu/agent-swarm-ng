import { useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { dialogMotion, dialogOverlay } from '@/lib/styles';

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
}: {
  channels: Channel[];
  choices: Record<string, ChannelChoice>;
  admissionOptions: { value: Admission; label: string }[];
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
                            options={[{ value: 'default', label: 'As set above' }, ...admissionOptions]}
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
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlay} />
          <Dialog.Content
            className={`fixed left-1/2 top-[max(1rem,12dvh)] z-50 flex max-h-[min(80dvh,36rem)] w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl ${dialogMotion}`}
          >
            <Dialog.Title className="sr-only">Add channels</Dialog.Title>
            <Dialog.Description className="sr-only">
              Search the servers and channels this bot can see. Choosing one adds or removes it; save the page to apply.
            </Dialog.Description>
            <Command
              label="Servers and channels"
              filter={(_, search, keywords) =>
                keywords?.join(' ').toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
              }
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center gap-2 border-b border-border px-3">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-4 shrink-0 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <Command.Input
                  autoFocus
                  placeholder="Search servers and channels…"
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close"
                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    ×
                  </button>
                </Dialog.Close>
              </div>
              <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No server or channel by that name.
                </Command.Empty>
                {servers.map(server => {
                  const whole = server.channels.filter(channel => channel.kind !== 'thread');
                  const all = whole.every(channel => choice(channel).allowed);
                  return (
                    <Command.Group
                      key={server.id}
                      heading={server.name}
                      className="border-b border-border py-1 last:border-b-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
                    >
                      <Item
                        value={`server:${server.id}`}
                        keywords={[server.name, 'all channels', 'server']}
                        checked={all}
                        onSelect={() => set(whole.map(channel => [channel, { allowed: !all }]))}
                      >
                        All channels in {server.name}
                      </Item>
                      {server.channels.map(channel => (
                        <Item
                          key={channel.id}
                          value={channel.id}
                          keywords={[channel.name, server.name]}
                          checked={choice(channel).allowed}
                          onSelect={() => set([[channel, { allowed: !choice(channel).allowed }]])}
                        >
                          {label(channel)}
                          {channel.kind === 'forum' && <span className="text-xs text-muted-foreground"> · forum</span>}
                        </Item>
                      ))}
                    </Command.Group>
                  );
                })}
              </Command.List>
            </Command>
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">{count} chosen · save the page to apply</p>
              <Dialog.Close asChild>
                <Button type="button" size="sm" className="min-h-10">
                  Done
                </Button>
              </Dialog.Close>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** One choice in the dialog: selecting it toggles, a check shows it is chosen. */
function Item({
  value,
  keywords,
  checked,
  onSelect,
  children,
}: {
  value: string;
  keywords: string[];
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      aria-checked={checked}
      className="relative flex min-h-11 cursor-pointer items-center rounded-md py-2 pl-3 pr-9 text-sm outline-none select-none transition-colors duration-100 hover:bg-muted data-[selected=true]:bg-muted motion-reduce:transition-none sm:min-h-9"
    >
      <span className="min-w-0 truncate">{children}</span>
      {checked && (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="absolute right-3 size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="m5 12 4 4L19 6" />
        </svg>
      )}
    </Command.Item>
  );
}
