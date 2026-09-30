import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { paths } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DiscordChannelList } from '@/components/discord-channel-list';
import type { RegisterSection } from '@/lib/settings-sections';
import { cn } from '@/lib/utils';

type Config = paths['/api/agents/{id}/discord']['get']['responses'][200]['content']['application/json'];
type Admission = Config['admission'];
const icon = (path: string) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-4 text-muted-foreground"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={path} />
  </svg>
);
const admissionOptions: { value: Admission; label: string; icon: React.ReactNode }[] = [
  // @: only when someone names it.
  {
    value: 'mention',
    label: 'Only when mentioned',
    icon: icon('M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1'),
  },
  // Sparkle: a quick model check decides.
  {
    value: 'check',
    label: 'When it seems relevant (model check)',
    icon: icon(
      'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    ),
  },
  // Speech bubbles: everything said there.
  {
    value: 'all',
    label: 'Every message',
    icon: icon(
      'M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm16 4h0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-2',
    ),
  },
];
/** A channel's "As set above": it follows the bot's choice. */
const inheritIcon = icon('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11');
const statusText: Record<Config['status']['state'], string> = {
  off: 'Not connected',
  connecting: 'Connecting…',
  online: 'Online',
  error: 'Not connected',
};
const inputClass =
  'h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9';
type Draft = {
  token: string;
  remove: boolean;
  admission: Admission;
  strangerDms: boolean;
  catchUp: boolean;
  channels: Record<string, { allowed: boolean; admission: Admission | null }>;
};
const draftOf = (config: Config): Draft => ({
  token: '',
  remove: false,
  admission: config.admission,
  strangerDms: config.strangerDms,
  catchUp: config.catchUp,
  channels: Object.fromEntries(
    config.channels.map(channel => [channel.id, { allowed: channel.allowed, admission: channel.admission }]),
  ),
});

/**
 * Agents → agent → Channels → Discord: the agent's own Discord bot (token in, status out, never shown back), the
 * invite link, and the owner's policies: which channels it may use, when undirected server messages wake it, DMs
 * from other people, catching up after an outage. Saved with the page's Save changes.
 */
export function AgentDiscordSettings({
  agentId,
  agentName,
  register,
}: {
  agentId: string;
  agentName: string;
  register: RegisterSection;
}) {
  const id = useId();
  const client = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const query = useQuery({
    queryKey: ['agent-discord', agentId],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET('/api/agents/{id}/discord', { params: { path: { id: agentId } }, signal });
      if (!data) throw new Error(error?.message ?? 'Could not load the Discord settings.');
      return data;
    },
    // While it connects, watch the status settle.
    refetchInterval: current => (current.state.data?.status.state === 'connecting' ? 2000 : false),
  });
  const saved = query.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  // A refetch keeps only what was changed here; everything else follows the server.
  const previous = useRef<Config | undefined>(undefined);
  useEffect(() => {
    if (!saved) return;
    const before = previous.current;
    previous.current = saved;
    setDraft(current => (current && before ? rebase(current, before, saved) : draftOf(saved)));
  }, [saved]);
  const [error, setError] = useState('');
  const dirty = Boolean(saved && draft && dirtyOf(draft, saved));
  const latest = useRef({ save: async () => {}, discard: () => {} });
  latest.current = {
    discard: () => {
      if (saved) setDraft(draftOf(saved));
      setError('');
    },
    save: async () => {
      if (!saved || !draft) return;
      setError('');
      const path = { params: { path: { id: agentId } } };
      if (draft.remove || draft.token.trim()) {
        const { error } = draft.remove
          ? await api.DELETE('/api/agents/{id}/discord/token', path)
          : await api.PUT('/api/agents/{id}/discord/token', { ...path, body: { token: draft.token.trim() } });
        if (error) {
          setError(error.message);
          throw new Error(error.message);
        }
        // Done: a later failure must not send (and restart the bot with) the token again.
        setDraft(current => (current ? { ...current, token: '', remove: false } : current));
      }
      const channels = Object.entries(draft.channels)
        .filter(([channelId, value]) => {
          const before = saved.channels.find(channel => channel.id === channelId);
          return before && (before.allowed !== value.allowed || before.admission !== value.admission);
        })
        .map(([channelId, value]) => ({ id: channelId, allowed: value.allowed, admission: value.admission }));
      const policy = {
        ...(draft.admission !== saved.admission ? { admission: draft.admission } : {}),
        ...(draft.strangerDms !== saved.strangerDms ? { strangerDms: draft.strangerDms } : {}),
        ...(draft.catchUp !== saved.catchUp ? { catchUp: draft.catchUp } : {}),
        ...(channels.length ? { channels } : {}),
      };
      if (Object.keys(policy).length) {
        const { error } = await api.PATCH('/api/agents/{id}/discord', { ...path, body: policy });
        if (error) {
          setError(error.message);
          throw new Error(error.message);
        }
      }
      setDraft(null);
      await client.invalidateQueries({ queryKey: ['agent-discord', agentId] });
    },
  };
  useEffect(() => {
    register('discord', {
      label: 'Discord',
      dirty,
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => register('discord');
  }, [dirty, register]);

  const change = (next: Partial<Draft>) => setDraft(current => (current ? { ...current, ...next } : current));
  const dms = saved?.channels.filter(channel => channel.kind === 'dm') ?? [];
  const state = saved?.status.state ?? 'off';

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">Discord</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The agent’s own Discord bot. It reads and talks like a member in the channels you allow; only your Discord
          accounts (Settings → Discord) carry your authority there.
        </p>
      </div>
      {query.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading Discord…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm">
          {query.error.message}{' '}
          <button type="button" className="cursor-pointer underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {saved && draft && (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                state === 'online'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : state === 'error'
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-foreground/10 text-muted-foreground',
              )}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {statusText[state]}
              {saved.bot ? ` as ${saved.bot.name}` : ''}
            </span>
            {saved.inviteUrl && (
              <a
                href={saved.inviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                Add the bot to a server ↗
              </a>
            )}
          </div>
          {saved.status.message && (
            <p role="alert" className="text-xs leading-relaxed text-red-400">
              {saved.status.message}
            </p>
          )}
          {/* Kibo input-types-2: password with a visibility toggle. The saved token is never shown. */}
          <div className="space-y-1.5">
            <label htmlFor={`${id}-token`} className="text-xs font-medium">
              Bot token
            </label>
            {/* On a phone, Disconnect moves under the field so the placeholder stays readable. */}
            <div className="flex min-w-0 flex-wrap gap-2">
              <div className="relative min-w-60 flex-1">
                <input
                  id={`${id}-token`}
                  type={showToken ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.token}
                  disabled={draft.remove}
                  placeholder={saved.configured ? 'Saved and hidden · paste to replace' : 'Paste the bot token'}
                  onChange={event => change({ token: event.target.value })}
                  className={cn(inputClass, 'pr-11', draft.token && 'font-mono')}
                />
                <button
                  type="button"
                  aria-label={showToken ? 'Hide token' : 'Show token'}
                  onClick={() => setShowToken(value => !value)}
                  className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    className="size-4"
                  >
                    {showToken ? (
                      <path
                        d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.2 4.2M6.2 6.2A13 13 0 0 0 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4.2-1"
                        strokeLinecap="round"
                      />
                    ) : (
                      <path
                        d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>
                </button>
              </div>
              {saved.configured && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 shrink-0 sm:min-h-0"
                  aria-pressed={draft.remove}
                  onClick={() => change({ remove: !draft.remove, token: '' })}
                >
                  {draft.remove ? 'Keep the bot' : 'Disconnect'}
                </Button>
              )}
            </div>
            {draft.remove && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                The bot disconnects and its token is deleted when you save.
              </p>
            )}
          </div>
          <DiscordSetupGuide open={!saved.configured} agentName={agentName} />
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          {/* Kibo switch-cards-3: a settings list with switches. */}
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
            {(
              [
                [
                  'strangerDms',
                  'DMs from other people',
                  'People other than you and your agents may DM this bot. Turning it off also closes its DMs with them.',
                ],
                [
                  'catchUp',
                  'Catch up after an outage',
                  'Messages addressed to it while it was offline arrive once, marked.',
                ],
              ] as const
            ).map(([key, title, description]) => (
              <div key={key} className="flex items-center justify-between gap-4 p-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label htmlFor={`${id}-${key}`} className="text-sm font-medium">
                    {title}
                  </label>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch id={`${id}-${key}`} checked={draft[key]} onCheckedChange={value => change({ [key]: value })} />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-admission`} className="text-xs font-medium">
              In server channels, wake it
            </label>
            <Select
              id={`${id}-admission`}
              value={draft.admission}
              onValueChange={value => change({ admission: value as Admission })}
              options={admissionOptions}
              triggerClassName="!h-11 sm:!h-9"
            />
            <p className="text-xs text-muted-foreground">
              Your messages, DMs, mentions and replies to it always wake it. Everything else stays readable as unread.
            </p>
          </div>
          <DiscordChannelList
            channels={saved.channels}
            choices={draft.channels}
            admissionOptions={admissionOptions}
            inheritIcon={inheritIcon}
            onChange={channels => change({ channels })}
            empty={saved.configured ? 'Add the bot to a server to choose channels here.' : 'Connect a bot first.'}
          />
          {dms.length > 0 && (
            <p className="text-xs text-muted-foreground">DMs: {dms.map(channel => channel.name).join(', ')}.</p>
          )}
        </>
      )}
    </div>
  );
}

/** The draft's own changes (against what it was based on), on top of the newer server state. */
function rebase(draft: Draft, before: Config, saved: Config): Draft {
  const [was, fresh] = [draftOf(before), draftOf(saved)];
  const pick = <K extends 'admission' | 'strangerDms' | 'catchUp'>(key: K) =>
    draft[key] !== was[key] ? draft[key] : fresh[key];
  const touched = Object.entries(draft.channels).filter(([channelId, value]) => {
    const old = was.channels[channelId];
    return old && (old.allowed !== value.allowed || old.admission !== value.admission);
  });
  return {
    ...draft,
    admission: pick('admission'),
    strangerDms: pick('strangerDms'),
    catchUp: pick('catchUp'),
    channels: { ...fresh.channels, ...Object.fromEntries(touched) },
  };
}

function dirtyOf(draft: Draft, saved: Config) {
  if (draft.remove || draft.token.trim()) return true;
  if (draft.admission !== saved.admission || draft.strangerDms !== saved.strangerDms || draft.catchUp !== saved.catchUp)
    return true;
  return saved.channels.some(channel => {
    const value = draft.channels[channel.id];
    return value && (value.allowed !== channel.allowed || value.admission !== channel.admission);
  });
}

/**
 * How to make a Discord bot for this agent, step by step (Discord Developer Portal labels as of 2026-09), and exactly
 * what the platform needs: the bot token, the Message Content intent, the invite, and your own user ID.
 */
function DiscordSetupGuide({ open, agentName }: { open: boolean; agentName: string }) {
  const link = 'text-primary underline-offset-2 hover:underline';
  return (
    <details open={open} className="group rounded-lg border border-border bg-background p-3 text-xs leading-relaxed">
      <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        How to create a Discord bot for {agentName}
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>
          Open the{' '}
          <a
            className={link}
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noopener noreferrer"
          >
            Discord Developer Portal ↗
          </a>{' '}
          and choose <b className="text-foreground">New Application</b> (or Create App). Name it after {agentName}; the
          name and icon become the bot’s name and picture on Discord.
        </li>
        <li>
          Go to <b className="text-foreground">Bot</b>. Under{' '}
          <b className="text-foreground">Privileged Gateway Intents</b>, turn on{' '}
          <b className="text-foreground">Message Content Intent</b> and save (Presence and Server Members are not
          needed). Without it, the agent cannot read what people write.
        </li>
        <li>
          Still on <b className="text-foreground">Bot</b>, choose <b className="text-foreground">Reset Token</b> and
          copy the token (Discord shows it only once). Paste it in <b className="text-foreground">Bot token</b> above
          and <b className="text-foreground">Save changes</b>. It is stored on this server only and never shown again
          here.
        </li>
        <li>
          Optional, recommended: keep the bot private. First set{' '}
          <b className="text-foreground">Installation → Install Link</b> to <b className="text-foreground">None</b>{' '}
          (this page makes its own invite link), then turn off <b className="text-foreground">Bot → Public Bot</b>.
          Otherwise Discord refuses with “Private application cannot have a default authorization link”.
        </li>
        <li>
          When the status says <b className="text-foreground">Online</b>, use{' '}
          <b className="text-foreground">Add the bot to a server</b> and pick your server (you need the Manage Server
          permission there). It asks only for what a member needs: read and send messages, threads, files, reactions,
          polls and pins.
        </li>
        <li>
          Use Add channels below to pick where {agentName} may talk. Then add your own Discord user ID in{' '}
          <b className="text-foreground">Settings → Discord</b> so it knows your messages are yours.
        </li>
      </ol>
      <p className="mt-3 text-muted-foreground">
        Each agent needs its own application and token. The platform needs only three things: the bot token (here),
        Message Content Intent turned on, and your Discord user ID (Settings). Nothing else is shared with Discord.
      </p>
    </details>
  );
}
