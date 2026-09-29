import type { PlatformStore } from '../platform-store';
import type { ComputerUseService } from './service';

type Seen = { name: string; alive: boolean; exitCode: number | null };
type Snapshot = { agentId: string; sessions: Map<string, Seen> };

/**
 * Tells the agent holding a computer when one of its terminals exits or disappears, so it can decide whether to
 * read its output, clean it up, or carry on. Only computers with a current claim are watched, and only changes
 * seen while that same agent holds the computer are reported (a new holder starts from what is there).
 */
export class TerminalWatcher {
  private seen = new Map<string, Snapshot>();
  private handle?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    private database: PlatformStore,
    private computers: ComputerUseService,
    private deliver: (agentId: string, text: string) => Promise<unknown>,
    private intervalMs = 5000,
  ) {}
  start() {
    this.handle ??= setInterval(() => void this.tick(), this.intervalMs);
  }
  close() {
    clearInterval(this.handle);
    this.handle = undefined;
  }
  /** One look at every held computer (the interval calls this; tests call it directly). */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.database.initialize();
      const claims = await this.database.client.computerClaim.findMany({ include: { computer: true } });
      const held = new Set(claims.map(claim => claim.computerId));
      for (const computerId of this.seen.keys()) if (!held.has(computerId)) this.seen.delete(computerId);
      for (const claim of claims) {
        if (claim.computer.state !== 'running') continue;
        const receipt = await this.computers
          .operatorTerminal(claim.computerId, { operation: 'list' })
          .catch(() => null);
        const listed = receipt?.result?.sessions as ({ id: string } & Seen)[] | undefined;
        if (!listed) continue; // unreachable or busy: look again next time
        const now = new Map(listed.map(session => [session.id, session]));
        const before = this.seen.get(claim.computerId);
        this.seen.set(claim.computerId, { agentId: claim.agentId, sessions: now });
        if (!before || before.agentId !== claim.agentId) continue;
        const events: string[] = [];
        const at = new Date().toISOString();
        const where = `on computer "${claim.computer.name}"`;
        for (const [id, previous] of before.sessions) {
          const current = now.get(id);
          if (!current) {
            if (!this.computers.deletedByAgent(claim.computerId, id))
              events.push(
                `Terminal "${previous.name}" (${id}) ${where} was closed by someone else (the human or another agent) by ${at}. Its screen and history are gone; restart the work in a new terminal if it is still needed.`,
              );
          } else if (previous.alive && !current.alive)
            events.push(
              `Terminal "${current.name}" (${id}) ${where} exited${current.exitCode === null ? '' : ` with code ${current.exitCode}`} by ${at}. Its last output is kept: terminal_view it to see what happened, then terminal_delete it when neither you nor the human needs it (leave it if the output may still matter).`,
            );
        }
        if (events.length)
          await this.deliver(claim.agentId, `Computer event:\n${events.join('\n')}`).catch(() => undefined);
      }
    } finally {
      this.busy = false;
    }
  }
}
