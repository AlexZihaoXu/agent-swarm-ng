import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { classify, type AgentTool, type ToolAccess } from './tool-access';
import type { PlatformStore } from './platform-store';

/**
 * Heartbeat: an agent's periodic wake-up, run as a branch of its saved session. Reading (r tools) is free; the first
 * change (a w or rw tool, or a real message arriving) promotes the branch to the agent's real turn, saving it. A
 * branch that changes nothing is dropped: its context is never saved (the activity log keeps it), except a short note
 * the agent may choose to leave for itself, which is appended to its saved context.
 */
export const HEARTBEAT_NOTE_MAX = 300;

export type HeartbeatBranch = {
  /** Set once the branch became a real turn. */
  promoted?: boolean;
  /** Whether a use_computer call changes a claim held before the heartbeat (giving it up or switching away). */
  claimPromotes: (args: { computer?: string | null; write?: boolean }) => boolean;
  /** Set while the quiet heartbeat's note question is asked (only then may leave_note be used). */
  asking?: boolean;
  /** The note the agent left, if any (set by leave_note). */
  note?: string;
};

export function heartbeatPrompt(checklist: string, now = new Date()) {
  return `Heartbeat ${now.toISOString()}: your periodic check, set up by your owner. This is a private branch: reading (r tools: looking, reading chats, files, computers) is free and leaves nothing in your context. Your first change (a w or rw tool, e.g. sending a message, setting a timer, typing or running a command on a computer) makes it your real turn; help({class:"r"}) lists what is free. If nothing needs doing, end without changing anything.
${checklist.trim() ? `Your owner's checklist:\n${checklist.trim()}` : 'No checklist: look over what you are responsible for (pending work, watches, timers, recent messages).'}`;
}

export const HEARTBEAT_NOTE_QUESTION = `Nothing changed this heartbeat, so it will be dropped from your context. Leave a short note for yourself (it stays in your context, e.g. what you checked and when to look again)? Call leave_note({text}), or end without it.`;

export function heartbeatPromotion(reason: string) {
  return `This heartbeat is now your real turn (${reason}): everything in it stays in your context. Carry on.`;
}

/** The note tool offered only at the end of a quiet heartbeat. Saving a note is not a change. */
export function createNoteTool(branch: HeartbeatBranch): AgentTool {
  return classify({ leave_note: 'r' }, [
    defineTool({
      name: 'leave_note',
      label: 'Leave a heartbeat note',
      description: `Only at the end of a quiet heartbeat: a note (at most ${HEARTBEAT_NOTE_MAX} characters) kept in your context for later turns and heartbeats.`,
      parameters: Type.Object(
        { text: Type.String({ minLength: 1, maxLength: HEARTBEAT_NOTE_MAX }) },
        { additionalProperties: false },
      ),
      async execute(_call, { text }) {
        if (!branch.asking || branch.promoted)
          throw new Error('leave_note is only for the end of a quiet heartbeat, when you are asked.');
        if (!text.trim()) throw new Error('Write a note, or end without one.');
        branch.note = text.trim();
        return { content: [{ type: 'text' as const, text: 'Note kept.' }], details: {}, terminate: true };
      },
    }),
  ])[0];
}

/** Whether a tool call promotes a heartbeat branch: w and rw do (unknown tools too), r never, claim when it changes a held claim. */
export function promotes(access: ToolAccess | undefined, branch: HeartbeatBranch, args: unknown) {
  if (access === 'r') return false;
  if (access === 'claim') return branch.claimPromotes((args ?? {}) as { computer?: string | null; write?: boolean });
  return true;
}

const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** Inside the active hours (server time zone)? Empty hours mean all day; from > to spans midnight. */
export function inHours(from: string, to: string, now = new Date()) {
  if (!from || !to) return true;
  const minute = now.getHours() * 60 + now.getMinutes();
  const start = minutesOf(from),
    end = minutesOf(to);
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * Starts each agent's heartbeat when it is due: its interval after the later of its last heartbeat and its last real
 * turn, inside its active hours, while it is idle and no summary is being written. A busy agent is checked again on
 * the next tick.
 */
export class HeartbeatScheduler {
  private last = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(
    private database: PlatformStore,
    private idle: (agentId: string) => boolean,
    private start: (agentId: string, checklist: string) => Promise<void>,
    private now = () => Date.now(),
  ) {}
  begin(everyMs = 30_000) {
    this.timer ??= setInterval(() => void this.tick().catch(() => {}), everyMs);
    this.timer.unref?.();
  }
  /** The agent did real work (or a heartbeat started): the next heartbeat counts from now. */
  active(agentId: string) {
    this.last.set(agentId, this.now());
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const agents = await this.database.client.agent.findMany({
        where: { heartbeatEnabled: true },
        select: { id: true, heartbeatMinutes: true, heartbeatFrom: true, heartbeatTo: true, heartbeatChecklist: true },
        take: 500,
      });
      const enabled = new Set(agents.map(agent => agent.id));
      for (const id of this.last.keys()) if (!enabled.has(id)) this.last.delete(id);
      const now = this.now();
      for (const agent of agents) {
        // Turned on (or the backend started): the first heartbeat comes one interval from now.
        if (!this.last.has(agent.id)) this.last.set(agent.id, now);
        if (now - this.last.get(agent.id)! < agent.heartbeatMinutes * 60_000) continue;
        if (!inHours(agent.heartbeatFrom, agent.heartbeatTo, new Date(now)) || !this.idle(agent.id)) continue;
        this.last.set(agent.id, now);
        await this.start(agent.id, agent.heartbeatChecklist).catch(() => {});
      }
    } finally {
      this.ticking = false;
    }
  }
  close() {
    if (this.timer) clearInterval(this.timer);
  }
}
