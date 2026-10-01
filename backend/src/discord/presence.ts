import type { DiscordConnections, BotStatus } from './connections';
import type { DiscordStore } from './store';

/** What an agent chooses: auto (online, idle after a quiet spell), or a forced idle or do-not-disturb. */
export type PresenceMode = 'auto' | 'idle' | 'dnd';
export const PRESENCE_MODES: PresenceMode[] = ['auto', 'idle', 'dnd'];
/** Auto turns idle after this long without the agent changing anything (a w or rw tool call). */
export const IDLE_AFTER_MS = 10 * 60_000;
export const STATUS_TEXT_MAX = 128;

/**
 * Each agent's Discord status. Auto shows online while the agent works and idle after ten minutes without write
 * activity; idle and dnd are forced. Bots may not hide, so there is no invisible. Kept in DiscordBot and sent to
 * Discord when the bot connects, when it changes, and as auto crosses the ten minutes.
 */
export class DiscordPresence {
  private lastWrite = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private store: DiscordStore,
    private connections: DiscordConnections,
    private now = () => Date.now(),
  ) {
    connections.onReady = agentId => void this.apply(agentId).catch(() => {});
  }
  begin(everyMs = 30_000) {
    this.timer ??= setInterval(() => void this.tick().catch(() => {}), everyMs);
    this.timer.unref?.();
  }
  close() {
    if (this.timer) clearInterval(this.timer);
  }
  /** The agent changed something (a w or rw tool call): auto shows online again at once. */
  wrote(agentId: string) {
    const quiet = this.quiet(agentId);
    this.lastWrite.set(agentId, this.now());
    if (quiet && this.connections.status(agentId).state !== 'off') void this.apply(agentId).catch(() => {});
  }
  private quiet(agentId: string) {
    const last = this.lastWrite.get(agentId);
    return last === undefined || this.now() - last >= IDLE_AFTER_MS;
  }
  shown(agentId: string, mode: string): BotStatus {
    return mode === 'idle' ? 'idle' : mode === 'dnd' ? 'dnd' : this.quiet(agentId) ? 'idle' : 'online';
  }
  async apply(agentId: string) {
    const bot = await this.store.bot(agentId);
    await this.connections.setPresence(agentId, this.shown(agentId, bot.presenceMode), bot.statusText);
    return {
      mode: bot.presenceMode as PresenceMode,
      shown: this.shown(agentId, bot.presenceMode),
      text: bot.statusText,
    };
  }
  async set(agentId: string, change: { mode?: PresenceMode; text?: string | null }) {
    const text = change.text === undefined ? undefined : (change.text ?? '').replace(/\s+/g, ' ').trim();
    if (text !== undefined && text.length > STATUS_TEXT_MAX)
      throw new Error(`The status text is at most ${STATUS_TEXT_MAX} characters.`);
    if (change.mode !== undefined && !PRESENCE_MODES.includes(change.mode))
      throw new Error('status is auto, idle or dnd (bots cannot be invisible).');
    await this.store.setPresence(agentId, {
      ...(change.mode !== undefined ? { presenceMode: change.mode } : {}),
      ...(text !== undefined ? { statusText: text } : {}),
    });
    return this.apply(agentId);
  }
  /** Auto crosses into idle by itself. */
  async tick() {
    for (const agentId of this.connected()) await this.apply(agentId).catch(() => {});
  }
  private connected() {
    return this.connections.agents().filter(agentId => this.connections.status(agentId).state === 'online');
  }
}
