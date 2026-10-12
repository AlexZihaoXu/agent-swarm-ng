import { useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { dialogMotion, dialogOverlay } from '@/lib/styles';
import { cn } from '@/lib/utils';
import { useOrganizations } from '@/lib/organizations';
import type { RealAgent } from '@/use-chat';

/** What an agent file may carry (backend agent-export.ts), with what each switch means; all on but the secret. */
const PARTS = [
  ['context', 'Live context', 'Its current conversation context, so it picks up where it left off.'],
  ['memories', 'Memories', 'What it remembers long term, with every version and where each came from.'],
  ['scratchpad', 'Scratchpad', 'Its scratch files.'],
  ['chat', 'Private chat', 'Its messages with you, their reactions and files.'],
  ['dms', 'Agent DMs', 'Its conversations with other agents (kept where those agents exist).'],
  ['discord', 'Discord', 'Its Discord channels, DM list and the messages its bot saw.'],
  ['activity', 'Activity log', 'Its runs: thinking, tool calls and results. Can be large.'],
] as const;
type Part = (typeof PARTS)[number][0] | 'discordToken';

const dialogClass = cn(
  'fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background ao-card p-6 shadow-xl outline-none',
  dialogMotion,
);

/**
 * Export agent (docs/agent-export.md): one file with everything inside the agent; the switches leave parts out.
 * Its settings, instructions, avatar, models, todos and timers always go in; the Discord bot token only when asked.
 */
export function ExportAgentDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const [parts, setParts] = useState<Record<Part, boolean>>(() => ({
    ...(Object.fromEntries(PARTS.map(([part]) => [part, true])) as Record<Part, boolean>),
    discordToken: false,
  }));
  const chosen = (Object.keys(parts) as Part[]).filter(part => parts[part]);
  const href = `/api/agents/${encodeURIComponent(agent.id)}/export?parts=${chosen.join(',')}`;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogClass}>
          <Dialog.Title className="text-lg font-semibold">Export {agent.name}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
            One file with everything inside this agent. Its settings, instructions, avatar, models, todos and timers
            always go in. Import it on any Agent Swarm, here or elsewhere.
          </Dialog.Description>
          <div className="-mx-1 mt-5 min-h-0 overflow-y-auto px-1">
            {/* Kibo switch-cards-3: a settings list with switches. */}
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
              {PARTS.map(([part, title, description]) => (
                <div key={part} className="flex items-center justify-between gap-4 p-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <label htmlFor={`${id}-${part}`} className="text-sm font-medium">
                      {title}
                    </label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                  <Switch
                    id={`${id}-${part}`}
                    checked={parts[part]}
                    onCheckedChange={value => setParts(current => ({ ...current, [part]: value }))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <label htmlFor={`${id}-discordToken`} className="text-sm font-medium">
                  Discord bot token
                </label>
                <p id={`${id}-secret`} className="text-xs text-muted-foreground">
                  A secret: whoever has the file can run its bot. Off, it is pasted again after importing.
                </p>
              </div>
              <Switch
                id={`${id}-discordToken`}
                describedBy={`${id}-secret`}
                checked={parts.discordToken}
                onCheckedChange={value => setParts(current => ({ ...current, discordToken: value }))}
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0">
                Cancel
              </Button>
            </Dialog.Close>
            <Button asChild size="sm" className="min-h-11 sm:min-h-0">
              {/* A plain download: the browser streams the file to disk, however large. */}
              <a href={href} download onClick={() => onOpenChange(false)}>
                Export
              </a>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Import agent: a `.swarm-agent` file becomes a new agent in the current organization, paused until its settings are
 * reviewed (what does not work here shows in red).
 */
export function ImportAgentDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (agent: RealAgent, skipped: { dms: number; links: number }) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { organizations, current } = useOrganizations();
  const organization = (current && current !== 'all' ? current : organizations[0]?.id) ?? 'personal';
  const organizationName = organizations.find(item => item.id === organization)?.name;
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/agents/import?organizationId=${encodeURIComponent(organization)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const body = (await response.json().catch(() => ({}))) as {
        agent?: RealAgent;
        message?: string;
        skipped?: { dms: number; links: number };
      };
      if (!response.ok || !body.agent) throw new Error(body.message ?? 'Could not import this file.');
      onImported(body.agent, body.skipped ?? { dms: 0, links: 0 });
      setFile(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not import this file.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (busy) return;
        onOpenChange(next);
        if (!next) {
          setFile(null);
          setError('');
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogClass}>
          <Dialog.Title className="text-lg font-semibold">Import agent</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A new agent from an exported <span className="font-mono text-foreground/80">.swarm-agent</span> file
            {organizationName ? ` in ${organizationName}` : ''}, with everything the file carries. It starts paused:
            settings that do not work here (a provider that does not exist, a computer that is not here) show in red
            until you change them, then you resume it.
          </Dialog.Description>
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept=".swarm-agent,application/gzip"
            className="sr-only"
            onChange={event => {
              setFile(event.target.files?.[0] ?? null);
              setError('');
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              const dropped = event.dataTransfer.files[0];
              if (dropped) setFile(dropped);
            }}
            className="mt-5 flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border px-4 py-6 text-center text-sm outline-none transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {file ? (
              <>
                <span className="font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(1)} MB · choose another
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">Choose an agent file</span>
                <span className="text-xs text-muted-foreground">or drop it here</span>
              </>
            )}
          </button>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={busy}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-0"
              disabled={!file || busy}
              onClick={() => void upload()}
            >
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
