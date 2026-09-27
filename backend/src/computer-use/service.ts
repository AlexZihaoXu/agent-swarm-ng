import type { PlatformStore } from '../platform-store';

export type ScreenFrame = { mimeType: 'image/jpeg' | 'image/png'; data: Uint8Array; width: number; height: number; bounds: number[] };
export type ActionReceipt = { started: boolean; completed: number; error: string | null };
export interface ComputerRuntime {
  capture(id: string, request: unknown, signal?: AbortSignal): Promise<ScreenFrame>;
  validate?(id: string, request: unknown, signal?: AbortSignal): Promise<unknown>;
  execute(id: string, request: unknown, signal?: AbortSignal): Promise<ActionReceipt>;
  /** Resolves only once no earlier admitted input can execute, including delayed requests. */
  cancel(id: string): Promise<void>;
}
export class ComputerUseError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503 = 400) { super(message); }
}
const knowledge = ' Read Swarm Knowledge swarm/computers/use.';
type Allowance = { token: string; until: number; remaining: number };
type Active = { abort: AbortController; finished: Promise<ActionReceipt> };

/** One backend owns admission; SQL uniqueness also protects against duplicate claims. */
export class ComputerUseService {
  private queue: Promise<unknown> = Promise.resolve();
  private starting?: Promise<void>;
  private allowances = new Map<string, Allowance>();
  private active = new Map<string, Active>();
  private uncertain = new Set<string>();
  constructor(readonly database: PlatformStore, private runtime: ComputerRuntime | null, private now = () => performance.now()) {}
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  ready() {
    if (!this.starting) this.starting = this.exclusive(async () => {
      await this.database.initialize();
      const claims = await this.database.client.computerClaim.findMany({ include: { computer: { select: { name: true } } } });
      for (const claim of claims) {
        // If cancellation cannot be proved, keep the claim and fail closed until retry.
        await this.driver().cancel(claim.computerId);
        await this.clearClaim(claim.computerId, `Swarm restarted; your computer ${claim.computer.name} (${claim.computerId}) was released. Assignments remain. Use use_computer and take a fresh screenshot before acting again.`);
      }
    }).catch(error => { this.starting = undefined; throw error; });
    return this.starting;
  }
  private driver() {
    if (!this.runtime) throw new ComputerUseError('Computer controller unavailable.', 503);
    return this.runtime;
  }
  async list(agentId: string) {
    await this.ready();
    if (!await this.database.hasAgent(agentId)) throw new ComputerUseError('Agent not found.', 404);
    const rows = await this.database.client.computerAssignment.findMany({ where: { agentId }, include: { computer: { include: { claim: { include: { agent: { select: { id: true, name: true } } } } } } }, orderBy: { computerId: 'asc' }, take: 100 });
    return rows.map(({ computer }) => ({ id: computer.id, name: computer.name, state: computer.state, holder: computer.claim?.agent ?? null, current: computer.claim?.agentId === agentId }));
  }
  async holders() {
    await this.ready();
    return this.database.client.computerClaim.findMany({ select: { computerId: true, token: true, agent: { select: { id: true, name: true } } }, take: 100 });
  }
  async assign(agentId: string, computerIds: string[]) {
    await this.ready();
    if (computerIds.length > 100 || new Set(computerIds).size !== computerIds.length) throw new ComputerUseError('Choose at most 100 distinct computers.');
    await this.exclusive(async () => {
      if (!await this.database.hasAgent(agentId)) throw new ComputerUseError('Agent not found.', 404);
      if (await this.database.client.computer.count({ where: { id: { in: computerIds }, state: { not: 'deleting' } } }) !== computerIds.length) throw new ComputerUseError('Computer not found.', 404);
      const claim = await this.database.client.computerClaim.findUnique({ where: { agentId } });
      if (claim && !computerIds.includes(claim.computerId)) await this.release(claim.computerId, 'Your computer assignment was removed and its control was released.');
      await this.database.client.$transaction(async tx => {
        await tx.computerAssignment.deleteMany({ where: { agentId } });
        if (computerIds.length) await tx.computerAssignment.createMany({ data: computerIds.map(computerId => ({ agentId, computerId })) });
      });
    });
  }
  async use(agentId: string, target: string | null) {
    await this.ready();
    return this.exclusive(async () => {
      if (!await this.database.hasAgent(agentId)) throw new ComputerUseError('Agent not found.', 404);
      const current = await this.database.client.computerClaim.findUnique({ where: { agentId } });
      if (target === null) { if (current) await this.release(current.computerId); return { computerId: null }; }
      this.driver();
      const rows = await this.database.client.computerAssignment.findMany({ where: { agentId }, include: { computer: true }, take: 100 });
      const exact = rows.find(row => row.computerId === target);
      const matching = exact ? [exact] : rows.filter(row => row.computer.name.toLocaleLowerCase() === target.toLocaleLowerCase());
      if (matching.length !== 1) throw new ComputerUseError('Choose one assigned computer by ID or exact name; use list_computers.' + knowledge, 403);
      const computer = matching[0].computer;
      if (computer.state !== 'running' || computer.desiredState !== 'running') throw new ComputerUseError('Computer is not running.', 409);
      const occupied = await this.database.client.computerClaim.findUnique({ where: { computerId: computer.id }, include: { agent: { select: { name: true } } } });
      if (occupied && occupied.agentId !== agentId) throw new ComputerUseError(`Computer is held by ${occupied.agent.name} (${occupied.agentId}). Ask them to release through an allowed chat, or ask the human to Force release.${knowledge}`, 409);
      if (occupied) return { computerId: computer.id, name: computer.name };
      // Check destination before releasing the old computer: a failed switch must not lose it.
      if (current) await this.release(current.computerId);
      await this.database.client.computerClaim.create({ data: { computerId: computer.id, agentId } });
      this.allowances.delete(agentId);
      return { computerId: computer.id, name: computer.name };
    });
  }
  private async claim(agentId: string) {
    const claim = await this.database.client.computerClaim.findUnique({ where: { agentId }, include: { computer: true } });
    if (!claim || !await this.database.client.computerAssignment.findUnique({ where: { agentId_computerId: { agentId, computerId: claim.computerId } } })) throw new ComputerUseError('First call use_computer for an assigned computer.' + knowledge, 403);
    if (this.uncertain.has(claim.computerId)) throw new ComputerUseError('Previous input settlement is uncertain. Ask the human to Force release before further input.', 409);
    if (claim.computer.state !== 'running' || claim.computer.desiredState !== 'running') throw new ComputerUseError('Computer is not running.', 409);
    return claim;
  }
  async capture(agentId: string, request: unknown, signal?: AbortSignal, retain?: (frame: ScreenFrame) => Promise<void>) {
    await this.ready();
    // Serialize capture with release/admission, but human desktop input remains concurrent by policy.
    return this.exclusive(async () => {
      signal?.throwIfAborted(); const claim = await this.claim(agentId);
      if (this.active.has(claim.computerId)) throw new ComputerUseError('Wait for the active combo before taking another screenshot.', 409);
      const frame = await this.driver().capture(claim.computerId, request, signal);
      signal?.throwIfAborted(); await retain?.(frame); signal?.throwIfAborted();
      this.allowances.set(agentId, { token: claim.token, until: this.now() + 30_000, remaining: 2 });
      return frame;
    });
  }
  private allowance(agentId: string, token: string) {
    const allowance = this.allowances.get(agentId);
    if (!allowance || allowance.token !== token || this.now() >= allowance.until || allowance.remaining <= 0) throw new ComputerUseError('Take another look with glance or look_at: at most two combos within 30 real seconds of a successful screenshot.' + knowledge);
    return allowance;
  }
  async run(agentId: string, request: unknown, signal?: AbortSignal): Promise<ActionReceipt> {
    await this.ready();
    const admitted = await this.exclusive(async () => {
      signal?.throwIfAborted(); const claim = await this.claim(agentId);
      if (this.active.has(claim.computerId)) throw new ComputerUseError('A combo is already executing; wait for its result.', 409);
      this.allowance(agentId, claim.token);
      const driver = this.driver();
      const prepared = driver.validate ? await driver.validate(claim.computerId, request, signal) : request;
      signal?.throwIfAborted(); const allowance = this.allowance(agentId, claim.token); allowance.remaining--;
      const abort = new AbortController();
      const stop = () => abort.abort(); signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) abort.abort();
      const finished = Promise.resolve().then(() => driver.execute(claim.computerId, prepared, abort.signal)).then(receipt => {
        if (!receipt.started && this.allowances.get(agentId) === allowance) allowance.remaining++;
        return receipt;
      }).catch(error => { this.uncertain.add(claim.computerId); this.allowances.delete(agentId); throw error; })
        .finally(() => { signal?.removeEventListener('abort', stop); this.active.delete(claim.computerId); });
      // Mark admission before yielding so release always sees and joins this execution.
      this.active.set(claim.computerId, { abort, finished });
      return { finished };
    });
    return admitted.finished;
  }
  private async clearClaim(computerId: string, notice?: string) {
    await this.database.client.$transaction(async tx => {
      const claim = await tx.computerClaim.findUnique({ where: { computerId } });
      if (!claim) return;
      if (notice) await tx.computerNotice.create({ data: { agentId: claim.agentId, text: notice } });
      await tx.computerClaim.delete({ where: { computerId } });
      this.allowances.delete(claim.agentId);
    });
  }
  private async release(computerId: string, notice?: string) {
    const active = this.active.get(computerId); active?.abort.abort();
    // Controller's cancellation generation fences delayed input even after a backend crash.
    await this.driver().cancel(computerId);
    await active?.finished.catch(() => {});
    await this.clearClaim(computerId, notice);
    this.uncertain.delete(computerId);
  }
  async forceRelease(computerId: string) {
    await this.ready();
    await this.exclusive(() => this.release(computerId, 'The human force released your computer. Use use_computer and take a new screenshot before acting again.'));
  }
  async releaseAgent(agentId: string) {
    await this.ready();
    await this.exclusive(async () => { const claim = await this.database.client.computerClaim.findUnique({ where: { agentId } }); if (claim) await this.release(claim.computerId); });
  }
  async notices(agentId: string) {
    await this.ready(); return this.database.client.computerNotice.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' }, take: 100 });
  }
  async acknowledgeNotices(agentId: string, ids: string[]) {
    await this.database.client.computerNotice.deleteMany({ where: { agentId, id: { in: ids } } });
  }
}
