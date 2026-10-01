import type { PlatformStore } from '../platform-store';
import type { ComputerUseService } from './service';
import type { SwarmSettingsStore } from '../swarm-settings';

/**
 * Agent recordings (start_recording): the computer records itself (the guest's recording.py, through the
 * controller); the platform keeps the lease. A recording lasts the lease from its start or last renewal; halfway the
 * agent is reminded to renew_recording, and an unrenewed one stops and saves by itself. A row per recording lets a
 * restart stop and save it and tell the agent on its next turn.
 */
export type RecordingSource = 'desktop' | { terminal: string };
export type RecordingMode = 'session' | 'events';
export type EventRule = { before?: number; after?: number };
export const DESKTOP_EVENTS = [
  'mouse.move_to',
  'mouse.left_click',
  'mouse.right_click',
  'mouse.down',
  'mouse.up',
  'mouse.scroll',
  'keyboard.down',
  'keyboard.up',
  'keyboard.type',
] as const;
export const TERMINAL_EVENTS = ['terminal.type', 'terminal.press'] as const;
export const MAX_SOURCES = 3;

export class RecordingError extends Error {}
type Controller = (
  computerId: string,
  op: 'start' | 'mark' | 'update' | 'stop' | 'list' | 'terminals',
  input: object,
) => Promise<Record<string, any>>;
type Recording = {
  id: string;
  agentId: string;
  agentName: string;
  computerId: string;
  computerName: string;
  source: RecordingSource;
  label: string;
  folder: string;
  mode: RecordingMode;
  startedAt: number;
  renewedAt: number;
  reminded: boolean;
  human: boolean;
  notes: { at: number; text: string }[];
};
export type StopResult = {
  folder: string;
  files: { name: string; size: number; seconds?: number; events?: number }[];
  sheet?: { mimeType: 'image/jpeg'; data: string; width: number; height: number } | null;
  error?: string;
};

const stamp = (at: number) => new Date(at).toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
const safe = (text: string) =>
  text
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'agent';
const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

export class AgentRecordings {
  private active = new Map<string, Recording>();
  private timer?: ReturnType<typeof setInterval>;
  private starting?: Promise<void>;
  constructor(
    private database: PlatformStore,
    private computers: ComputerUseService,
    private controller: () => Controller | undefined,
    private settings: SwarmSettingsStore,
    /** Wakes an agent with a platform computer event (a reminder, an automatic stop, a notice for the holder). */
    private wake: (agentId: string, text: string, human: boolean) => void,
    private now = () => Date.now(),
  ) {}

  /** A restart: recordings left running are stopped and saved, and their agents told on their next turn. */
  ready() {
    return (this.starting ??= (async () => {
      const rows = await this.database.client.agentRecording.findMany({ take: 100 });
      for (const row of rows) {
        let text: string;
        try {
          const result = await this.call(row.computerId, 'stop', { id: row.id, reason: 'platform restarted' });
          text = `The platform restarted, so your recording (${row.label}) was stopped and saved in ${result.folder ?? row.folder}.`;
        } catch {
          text = `The platform restarted while you were recording (${row.label}); it could not be saved (the computer was off or unreachable).`;
        }
        await this.database.client.computerNotice.create({ data: { agentId: row.agentId, text } }).catch(() => {});
        await this.database.client.agentRecording.delete({ where: { id: row.id } }).catch(() => {});
      }
      this.timer ??= setInterval(() => void this.tick().catch(() => {}), 5000);
      this.timer.unref?.();
    })().catch(error => {
      this.starting = undefined;
      throw error;
    }));
  }

  private call(computerId: string, op: Parameters<Controller>[1], input: object) {
    const controller = this.controller();
    if (!controller) throw new RecordingError('Computers are not available.');
    return controller(computerId, op, input);
  }

  forAgent(agentId: string) {
    return [...this.active.values()].filter(item => item.agentId === agentId);
  }
  all() {
    return [...this.active.values()];
  }
  forComputer(computerId: string) {
    return [...this.active.values()].filter(item => item.computerId === computerId);
  }
  /** For list_timers and the dashboard. */
  list(agentId: string) {
    return this.forAgent(agentId).map(item => this.view(item));
  }
  private async lease() {
    const settings = await this.settings.get();
    const lease = settings.recordingLeaseSeconds;
    return {
      lease,
      reminder: Math.min(settings.recordingReminderSeconds, Math.max(15, lease - 15)),
      max: settings.recordingMaxMinutes * 60,
      settings,
    };
  }
  private view(item: Recording) {
    return {
      id: item.id,
      computer: item.computerName,
      source: item.source === 'desktop' ? 'desktop' : `terminal ${item.label.slice('terminal-'.length)}`,
      mode: item.mode,
      folder: item.folder,
      startedAt: new Date(item.startedAt).toISOString(),
      renewedAt: new Date(item.renewedAt).toISOString(),
    };
  }

  async start(
    agentId: string,
    input: {
      computer?: string;
      sources: RecordingSource[];
      mode: RecordingMode;
      fps?: number;
      events?: Record<string, EventRule>;
      hideTyped?: boolean;
      audio?: boolean;
      human: boolean;
    },
  ) {
    await this.ready();
    const agent = await this.database.findAgent(agentId);
    if (!agent) throw new RecordingError('Agent not found.');
    if (!input.sources.length)
      throw new RecordingError('Choose at least one source: "desktop" or {terminal: <session ID>}.');
    if (this.forAgent(agentId).length + input.sources.length > MAX_SOURCES)
      throw new RecordingError(`At most ${MAX_SOURCES} sources recording at once per agent; stop one first.`);
    const target = await this.computers.readable(agentId, input.computer);
    if (this.forComputer(target.computerId).length + input.sources.length > MAX_SOURCES)
      throw new RecordingError(`At most ${MAX_SOURCES} sources recording at once on ${target.name}.`);
    const { lease, max, settings } = await this.lease();
    const at = this.now();
    // Recordings started together (or while the agent already records this computer) share one folder.
    const folder =
      this.forAgent(agentId).find(item => item.computerId === target.computerId)?.folder ??
      `Videos/agent-recordings/${stamp(at)}_${safe(agent.name)}`;
    const kinds = new Set(input.sources.map(source => (source === 'desktop' ? 'desktop' : 'terminal')));
    for (const type of Object.keys(input.events ?? {}))
      if (
        type !== '*' &&
        type !== 'mark' &&
        !(kinds.has('desktop') && DESKTOP_EVENTS.some(name => name === type)) &&
        !(kinds.has('terminal') && TERMINAL_EVENTS.some(name => name === type))
      )
        throw new RecordingError(
          `${type} is not an event of the ${[...kinds].join(' or ')} recording${kinds.size > 1 ? 's' : ''} you chose; see recording_events.`,
        );
    const started: Recording[] = [];
    const names = new Map<string, string>();
    for (const source of input.sources) {
      if (source !== 'desktop' && !names.size) {
        const listed = ((await this.call(target.computerId, 'terminals', {}).catch(() => ({}) as Record<string, any>))
          .terminals ?? []) as {
          id: string;
          name: string;
        }[];
        for (const session of listed) names.set(session.id, session.name);
      }
      const desktop = source === 'desktop';
      if (!desktop && !names.has(source.terminal))
        throw new RecordingError(
          `No terminal ${source.terminal} on ${target.name}; use terminal_list for its exact session ID.`,
        );
      const label = desktop ? 'desktop' : `terminal-${safe(names.get(source.terminal)!)}`;
      if ([...this.active.values(), ...started].some(item => item.folder === folder && item.label === label))
        throw new RecordingError(`${label} is already recording.`);
      // One list of event rules for every source: each source keeps the ones that are its events (and marks).
      const own = (type: string) =>
        type === '*' || type === 'mark' || (desktop ? DESKTOP_EVENTS : TERMINAL_EVENTS).some(name => name === type);
      const rules =
        input.mode === 'events'
          ? Object.fromEntries(Object.entries(input.events ?? { '*': {} }).filter(([type]) => own(type)))
          : {};
      const id = crypto.randomUUID();
      try {
        await this.call(target.computerId, 'start', {
          id,
          folder,
          source: desktop ? 'desktop' : 'terminal',
          ...(desktop ? {} : { session: source.terminal }),
          label,
          mode: input.mode,
          fps: Math.min(
            input.fps ?? (desktop ? settings.recordingDesktopFps : settings.recordingTerminalFps),
            desktop ? 60 : 30,
          ),
          kbps: settings.recordingDesktopKbps,
          audio: input.audio ?? true,
          rules,
          defaults: [settings.recordingPadBeforeMs / 1000, settings.recordingPadAfterMs / 1000],
          hideTyped: input.hideTyped ?? false,
          maxSeconds: max,
        });
      } catch (error) {
        // Sources already started in this call keep running: the agent is told which.
        if (started.length) break;
        throw new RecordingError(error instanceof Error ? error.message : 'Recording could not start.');
      }
      const recording: Recording = {
        id,
        agentId,
        agentName: agent.name,
        computerId: target.computerId,
        computerName: target.name,
        source,
        label,
        folder,
        mode: input.mode,
        startedAt: at,
        renewedAt: at,
        reminded: false,
        human: input.human,
        notes: [],
      };
      this.active.set(id, recording);
      started.push(recording);
      await this.database.client.agentRecording.create({
        data: { id, agentId, computerId: target.computerId, label, folder },
      });
    }
    // Someone else working on the computer hears that it is being recorded.
    if (target.holder && target.holder !== agentId)
      this.wake(
        target.holder,
        `${agent.name} started recording ${target.name} (${started.map(item => item.label).join(', ')}). Recording only watches; it does not change your work.`,
        false,
      );
    return {
      recordings: started.map(item => this.view(item)),
      folder: `/home/agent/${folder}`,
      lease: `It stops and saves by itself ${minutes(lease)} from now unless you call renew_recording; you are reminded halfway.`,
      ...(started.length < input.sources.length
        ? { warning: 'Not every source could start; the ones listed are recording.' }
        : {}),
    };
  }

  /** Renews all of the agent's recordings (and may change their event rules). */
  async renew(agentId: string, events?: Record<string, EventRule>) {
    const mine = this.forAgent(agentId);
    if (!mine.length) throw new RecordingError('You are not recording anything.');
    const { lease } = await this.lease();
    const at = this.now();
    for (const item of mine) {
      item.renewedAt = at;
      item.reminded = false;
      item.notes.push({
        at: at / 1000,
        text: `renewed (lease until ${new Date(at + lease * 1000).toISOString().slice(11, 19)} UTC)`,
      });
      if (events && item.mode === 'events') await this.call(item.computerId, 'update', { id: item.id, rules: events });
    }
    return { renewed: mine.map(item => item.label), until: new Date(at + lease * 1000).toISOString() };
  }

  async mark(agentId: string, label?: string) {
    const mine = this.forAgent(agentId);
    if (!mine.length) throw new RecordingError('You are not recording anything.');
    const byComputer = new Map<string, string[]>();
    for (const item of mine) byComputer.set(item.computerId, [...(byComputer.get(item.computerId) ?? []), item.id]);
    for (const [computerId, ids] of byComputer)
      await this.call(computerId, 'mark', { ids, ...(label ? { label } : {}) });
    return { marked: mine.length };
  }

  /** Stops (one, or all of the agent's) and saves; returns what was saved. */
  async stop(agentId: string, id?: string, reason = 'stopped by agent') {
    const mine = this.forAgent(agentId).filter(item => !id || item.id === id);
    if (!mine.length) throw new RecordingError(id ? 'No such recording of yours.' : 'You are not recording anything.');
    const results: (StopResult & { label: string; computer: string })[] = [];
    for (const item of mine) results.push(await this.finish(item, reason));
    return results;
  }

  /** The human stopped a computer's recordings, or the computer is stopping: save them and tell the agents. */
  async stopComputer(computerId: string, reason: string) {
    for (const item of this.forComputer(computerId)) {
      const result = await this.finish(item, reason);
      this.wake(item.agentId, this.summary(item, result, reason), item.human);
    }
  }

  /** The computer is being deleted: its recordings end unsaved (their folders go with it); the agents are told. */
  dropComputer(computerId: string) {
    for (const item of this.forComputer(computerId)) {
      this.active.delete(item.id);
      void this.database.client.agentRecording.delete({ where: { id: item.id } }).catch(() => {});
      this.wake(
        item.agentId,
        `Your recording ${item.label} ended: ${item.computerName} was deleted, with its files.`,
        item.human,
      );
    }
  }

  private async finish(item: Recording, reason: string) {
    this.active.delete(item.id);
    let result: StopResult;
    try {
      result = (await this.call(item.computerId, 'stop', {
        id: item.id,
        reason,
        notes: item.notes.slice(-50),
      })) as StopResult;
    } catch (error) {
      result = {
        folder: `/home/agent/${item.folder}`,
        files: [],
        error: error instanceof Error ? error.message : 'not saved',
      };
    }
    await this.database.client.agentRecording.delete({ where: { id: item.id } }).catch(() => {});
    return { ...result, label: item.label, computer: item.computerName };
  }

  private summary(item: Recording, result: StopResult, reason: string) {
    const files = result.files.map(file => `${file.name} (${Math.round(file.size / 1024)} KB)`).join(', ');
    return result.error
      ? `Your recording ${item.label} on ${item.computerName} stopped (${reason}) but could not be saved: ${result.error}`
      : `Your recording ${item.label} on ${item.computerName} stopped (${reason}) and was saved in ${result.folder}: ${files || 'nothing was captured'}. Share a file with upload_file from computer:${item.computerName}:<path>.`;
  }

  /** Reminders halfway through the lease; unrenewed or overlong recordings stop and save; lost assignments stop. */
  async tick() {
    const { lease, reminder, max } = await this.lease();
    const at = this.now();
    const remind = new Map<string, Recording[]>();
    for (const item of [...this.active.values()]) {
      const reason = !(await this.computers.assigned(item.agentId, item.computerId))
        ? 'its computer assignment was removed'
        : at - item.startedAt >= max * 1000
          ? `it reached the longest recording, ${minutes(max)}`
          : at - item.renewedAt >= lease * 1000
            ? `it was not renewed within ${minutes(lease)}`
            : null;
      if (reason) {
        const result = await this.finish(item, reason);
        this.wake(item.agentId, this.summary(item, result, reason), item.human);
      } else if (!item.reminded && at - item.renewedAt >= reminder * 1000) {
        item.reminded = true;
        remind.set(item.agentId, [...(remind.get(item.agentId) ?? []), item]);
      }
    }
    for (const [agentId, items] of remind) {
      const stopAt = new Date(items[0].renewedAt + lease * 1000).toISOString().slice(11, 19);
      this.wake(
        agentId,
        `Recording reminder: ${items.map(item => `${item.label} on ${item.computerName}`).join(', ')} ${items.length > 1 ? 'have' : 'has'} run ${minutes(reminder)} since you last renewed. ${items.length > 1 ? 'They stop' : 'It stops'} and ${items.length > 1 ? 'save' : 'saves'} at ${stopAt} UTC unless you call renew_recording (one call renews them all); stop_recording saves now. If you no longer need it, let it end.`,
        items.some(item => item.human),
      );
    }
  }

  /** The agent is being deleted: its recordings stop and save. */
  async releasedBy(agentId: string) {
    for (const item of this.forAgent(agentId)) await this.finish(item, 'agent deleted');
  }

  close() {
    if (this.timer) clearInterval(this.timer);
  }
}
