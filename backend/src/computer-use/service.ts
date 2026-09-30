import type { PlatformStore } from '../platform-store';

export type ScreenFrame = {
  mimeType: 'image/jpeg' | 'image/png';
  data: Uint8Array;
  width: number;
  height: number;
  bounds: number[];
};
export type CoreReceipt = { started: boolean; settled: true; error?: string; result?: Record<string, any> };
export type ActionReceipt = { started: boolean; completed: number; error: string | null };
export interface ComputerRuntime {
  capture(id: string, request: unknown, signal?: AbortSignal): Promise<ScreenFrame>;
  validate?(id: string, request: unknown, signal?: AbortSignal): Promise<unknown>;
  execute(id: string, request: unknown, signal?: AbortSignal): Promise<ActionReceipt>;
  prepareCore?(id: string, request: unknown, signal?: AbortSignal): Promise<unknown>;
  core?(id: string, request: unknown, signal?: AbortSignal): Promise<CoreReceipt>;
  /** Resolves only once no earlier admitted input or core operation can execute, including delayed requests. */
  cancel(id: string): Promise<void>;
}
export class ComputerUseError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message);
  }
}
/** A watch's computer is no longer usable by it: no claim, not this claim, not running, or blocked. */
export class WatchClaimError extends ComputerUseError {}
export class ComputerExecutionError extends ComputerUseError {
  constructor(
    message: string,
    readonly settled: boolean,
  ) {
    super(message, 503);
  }
}
const knowledge = ' Read Swarm Knowledge practices/computer-use.';
/** Operations that only read: they neither consume the screenshot allowance nor make other callers fail. */
const isReadOnly = (request: unknown) => {
  const input = request as { kind?: string; operation?: string } | undefined;
  return (
    input?.kind === 'read' ||
    (input?.kind === 'terminal' && ['list', 'view', 'status', 'screens'].includes(input.operation ?? ''))
  );
};
type Allowance = { token: string; until: number; remaining: number };
/** What one terminal_view permits: five terminal_run_actions calls on that session within 90 real seconds. */
const TERMINAL_ALLOWANCE = { seconds: 90, combos: 5 };
type TerminalAllowance = Allowance & { session: string };
/** The operation running on a computer; a read-only one (list/view/status/screens, file reads) is short. */
type Active = { abort: AbortController; finished: Promise<unknown>; readOnly?: boolean };

/** One backend owns admission; SQL uniqueness also protects against duplicate claims. */
export class ComputerUseService {
  private queue: Promise<unknown> = Promise.resolve();
  private starting?: Promise<void>;
  private allowances = new Map<string, Allowance>();
  private terminalAllowances = new Map<string, TerminalAllowance>();
  /** Told when an agent's terminal combo starts and ends (the dashboard shows who is typing where). */
  onTerminalInput?: (event: { agentId: string; computerId: string; session: string; active: boolean }) => void;
  /** Told when an agent deletes a terminal itself (its watches on it end quietly). */
  onAgentTerminalDelete?: (event: { agentId: string; computerId: string; session: string }) => void;
  /** Terminals an agent deleted itself (computer:session → when), so the watcher does not report them back. */
  private agentDeletes = new Map<string, number>();
  deletedByAgent(computerId: string, session: string) {
    const at = this.agentDeletes.get(`${computerId}:${session}`);
    return at !== undefined && this.now() - at < 5 * 60_000;
  }
  private active = new Map<string, Active>();
  private uncertain = new Set<string>();
  constructor(
    readonly database: PlatformStore,
    private runtime: ComputerRuntime | null,
    private now = () => performance.now(),
  ) {}
  /**
   * Another operation holds the computer: a short read is waited for (so dashboard polling and previews never
   * make an agent's call fail); anything else is refused as before.
   */
  private waitForReads(computerId: string, refusal: string, patient = false) {
    const active = this.active.get(computerId);
    if (!active) return undefined;
    // A watch's look is never urgent: it waits out any operation instead of failing.
    if (active.readOnly || patient)
      return active.finished.then(
        () => undefined,
        () => undefined,
      );
    throw new ComputerUseError(refusal, 409);
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  ready() {
    if (!this.starting)
      this.starting = this.exclusive(async () => {
        await this.database.initialize();
        const claims = await this.database.client.computerClaim.findMany({
          include: { computer: { select: { name: true } } },
        });
        for (const claim of claims) {
          // If cancellation cannot be proved, keep the claim and fail closed until retry.
          await this.driver().cancel(claim.computerId);
          await this.clearClaim(
            claim.computerId,
            `Swarm restarted; your computer ${claim.computer.name} (${claim.computerId}) was released. Assignments remain. Persistent tmux programs may still be running. Use use_computer before more file/shell/terminal work and inspect existing sessions; take a fresh screenshot before GUI input.`,
          );
        }
      }).catch(error => {
        this.starting = undefined;
        throw error;
      });
    return this.starting;
  }
  private driver() {
    if (!this.runtime) throw new ComputerUseError('Computer controller unavailable.', 503);
    return this.runtime;
  }
  async list(agentId: string) {
    await this.ready();
    if (!(await this.database.hasAgent(agentId))) throw new ComputerUseError('Agent not found.', 404);
    const rows = await this.database.client.computerAssignment.findMany({
      where: { agentId },
      include: { computer: { include: { claim: { include: { agent: { select: { id: true, name: true } } } } } } },
      orderBy: { computerId: 'asc' },
      take: 100,
    });
    return rows.map(({ computer }) => ({
      id: computer.id,
      name: computer.name,
      state: computer.state,
      holder: computer.claim?.agent ?? null,
      current: computer.claim?.agentId === agentId,
    }));
  }
  async holders() {
    await this.ready();
    return this.database.client.computerClaim.findMany({
      select: { computerId: true, token: true, agent: { select: { id: true, name: true } } },
      take: 100,
    });
  }
  async assign(agentId: string, computerIds: string[]) {
    await this.ready();
    if (computerIds.length > 100 || new Set(computerIds).size !== computerIds.length)
      throw new ComputerUseError('Choose at most 100 distinct computers.');
    await this.exclusive(async () => {
      if (!(await this.database.hasAgent(agentId))) throw new ComputerUseError('Agent not found.', 404);
      if (
        (await this.database.client.computer.count({
          where: { id: { in: computerIds }, state: { not: 'deleting' } },
        })) !== computerIds.length
      )
        throw new ComputerUseError('Computer not found.', 404);
      const claim = await this.database.client.computerClaim.findUnique({ where: { agentId } });
      if (claim && !computerIds.includes(claim.computerId))
        await this.release(claim.computerId, 'Your computer assignment was removed and its control was released.');
      await this.database.client.$transaction(async tx => {
        await tx.computerAssignment.deleteMany({ where: { agentId } });
        if (computerIds.length)
          await tx.computerAssignment.createMany({ data: computerIds.map(computerId => ({ agentId, computerId })) });
      });
    });
  }
  async use(agentId: string, target: string | null) {
    await this.ready();
    return this.exclusive(async () => {
      if (!(await this.database.hasAgent(agentId))) throw new ComputerUseError('Agent not found.', 404);
      const current = await this.database.client.computerClaim.findUnique({ where: { agentId } });
      if (target === null) {
        if (current) await this.release(current.computerId);
        return { computerId: null };
      }
      this.driver();
      const rows = await this.database.client.computerAssignment.findMany({
        where: { agentId },
        include: { computer: true },
        take: 100,
      });
      const exact = rows.find(row => row.computerId === target);
      const matching = exact
        ? [exact]
        : rows.filter(row => row.computer.name.toLocaleLowerCase() === target.toLocaleLowerCase());
      if (matching.length !== 1)
        throw new ComputerUseError(
          'Choose one assigned computer by ID or exact name; use list_computers.' + knowledge,
          403,
        );
      const computer = matching[0].computer;
      if (computer.state !== 'running' || computer.desiredState !== 'running')
        throw new ComputerUseError('Computer is not running.', 409);
      const occupied = await this.database.client.computerClaim.findUnique({
        where: { computerId: computer.id },
        include: { agent: { select: { name: true } } },
      });
      if (occupied && occupied.agentId !== agentId)
        throw new ComputerUseError(
          `Computer is held by ${occupied.agent.name} (${occupied.agentId}). Ask them to release through an allowed chat, or ask the human to Force release.${knowledge}`,
          409,
        );
      if (occupied) return { computerId: computer.id, name: computer.name };
      // Check destination before releasing the old computer: a failed switch must not lose it.
      if (current) await this.release(current.computerId);
      await this.database.client.computerClaim.create({ data: { computerId: computer.id, agentId } });
      this.allowances.delete(agentId);
      return { computerId: computer.id, name: computer.name };
    });
  }
  private async claim(agentId: string) {
    const claim = await this.database.client.computerClaim.findUnique({
      where: { agentId },
      include: { computer: true },
    });
    if (
      !claim ||
      !(await this.database.client.computerAssignment.findUnique({
        where: { agentId_computerId: { agentId, computerId: claim.computerId } },
      }))
    )
      throw new ComputerUseError('First call use_computer for an assigned computer.' + knowledge, 403);
    if (this.uncertain.has(claim.computerId))
      throw new ComputerUseError(
        'Previous computer operation settlement is uncertain. Ask the human to Force release, or stop the computer if release cannot settle, before further operations.',
        409,
      );
    if (claim.computer.state !== 'running' || claim.computer.desiredState !== 'running')
      throw new ComputerUseError('Computer is not running.', 409);
    return claim;
  }
  async capture(
    agentId: string,
    request: unknown,
    signal?: AbortSignal,
    retain?: (frame: ScreenFrame) => Promise<void>,
  ): Promise<ScreenFrame> {
    await this.ready();
    return this.screenshot(
      () => this.claim(agentId),
      request,
      signal,
      retain,
      claim => this.allowances.set(agentId, { token: claim.token, until: this.now() + 30_000, remaining: 2 }),
    );
  }
  /**
   * A screenshot the agent saves rather than looks at (save_screenshot): the same capture of the computer it holds,
   * but it grants no input allowance (the agent has not seen it) and nothing goes into the image pool.
   */
  async snapshot(agentId: string, request: unknown, signal?: AbortSignal) {
    await this.ready();
    let claim!: Awaited<ReturnType<ComputerUseService['claim']>>;
    const frame = await this.screenshot(
      async () => (claim = await this.claim(agentId)),
      request,
      signal,
      undefined,
      undefined,
    );
    return { frame, computer: { id: claim.computerId, name: claim.computer.name } };
  }
  /**
   * A watch's look at the computer its agent holds: the same capture, but it grants the agent no input allowance
   * (the agent looks for itself after waking) and it waits out a busy computer instead of failing.
   */
  async watchCapture(agentId: string, computerId: string, token: string, request: unknown, signal?: AbortSignal) {
    await this.ready();
    return this.screenshot(
      () => this.watchClaim(agentId, computerId, token),
      request,
      signal,
      undefined,
      undefined,
      true,
    );
  }
  /** A watch's read of a terminal on the computer its agent holds (view/status only). */
  async watchTerminal(
    agentId: string,
    computerId: string,
    token: string,
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (!['view', 'status'].includes(String(request.operation)))
      throw new ComputerUseError('A watch can only view a terminal or read its status.', 403);
    await this.ready();
    return this.performCore(
      () => this.watchClaim(agentId, computerId, token),
      { ...request, kind: 'terminal' },
      signal,
      undefined,
      true,
    );
  }
  /** The computer the agent holds now (a watch is set on it). */
  async held(agentId: string) {
    await this.ready();
    const claim = await this.claim(agentId);
    return { computerId: claim.computerId, name: claim.computer.name, token: claim.token };
  }
  /** The agent's current claim, which must still be on this computer (a watch never follows it elsewhere). */
  async watchClaim(agentId: string, computerId: string, token: string) {
    const claim = await this.claim(agentId).catch(error => {
      throw error instanceof ComputerUseError ? new WatchClaimError(error.message, error.status) : error;
    });
    // The same claim, not just the same computer: a force release and a new claim end the watch.
    if (claim.computerId !== computerId || claim.token !== token)
      throw new WatchClaimError('You no longer hold the computer this watch was set on.', 403);
    return claim;
  }
  private async screenshot<C extends { computerId: string; token: string }>(
    resolve: () => Promise<C>,
    request: unknown,
    signal: AbortSignal | undefined,
    retain: ((frame: ScreenFrame) => Promise<void>) | undefined,
    granted: ((claim: C) => void) | undefined,
    patient = false,
  ): Promise<ScreenFrame> {
    // Admission is short and serialized; the slow screenshot itself runs outside the lock so it can never delay
    // another computer or a human Force release, which aborts and joins it via `active`.
    const admitted = await this.exclusive(async () => {
      signal?.throwIfAborted();
      const claim = await resolve();
      const waiting = this.waitForReads(
        claim.computerId,
        'Wait for the active computer operation before taking another screenshot.',
        patient,
      );
      if (waiting) return { waiting };
      const driver = this.driver();
      const abort = new AbortController();
      const stop = () => abort.abort();
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) abort.abort();
      const finished = (async () => {
        const frame = await driver.capture(claim.computerId, request, abort.signal);
        abort.signal.throwIfAborted();
        await retain?.(frame);
        abort.signal.throwIfAborted();
        granted?.(claim);
        return frame;
      })().finally(() => {
        signal?.removeEventListener('abort', stop);
        this.active.delete(claim.computerId);
      });
      // A screenshot only reads: another caller waits for it rather than failing.
      this.active.set(claim.computerId, { abort, finished, readOnly: true });
      return { finished };
    });
    if ('waiting' in admitted) {
      await admitted.waiting;
      return this.screenshot(resolve, request, signal, retain, granted, patient);
    }
    return admitted.finished;
  }
  private allowance(agentId: string, token: string) {
    const allowance = this.allowances.get(agentId);
    if (!allowance || allowance.token !== token || this.now() >= allowance.until || allowance.remaining <= 0)
      throw new ComputerUseError(
        'Take another look with glance or look_at: at most two combos within 30 real seconds of a successful screenshot.' +
          knowledge,
      );
    return allowance;
  }
  async run(agentId: string, request: unknown, signal?: AbortSignal): Promise<ActionReceipt> {
    await this.ready();
    const admitted = await this.exclusive(async () => {
      signal?.throwIfAborted();
      const claim = await this.claim(agentId);
      const waiting = this.waitForReads(
        claim.computerId,
        'Another computer operation is executing; wait for its result.',
      );
      if (waiting) return { waiting };
      this.allowance(agentId, claim.token);
      const driver = this.driver();
      const abort = new AbortController();
      const stop = () => abort.abort();
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) abort.abort();
      // Validation and execution both happen outside the admission lock but inside the joinable `active` slot.
      const finished = (async () => {
        const prepared = driver.validate ? await driver.validate(claim.computerId, request, abort.signal) : request;
        abort.signal.throwIfAborted();
        const allowance = this.allowance(agentId, claim.token);
        allowance.remaining--;
        try {
          const receipt = await driver.execute(claim.computerId, prepared, abort.signal);
          if (!receipt.started && this.allowances.get(agentId) === allowance) allowance.remaining++;
          return receipt;
        } catch (error) {
          if (!(error instanceof ComputerExecutionError && error.settled)) this.uncertain.add(claim.computerId);
          this.allowances.delete(agentId);
          throw error;
        }
      })().finally(() => {
        signal?.removeEventListener('abort', stop);
        this.active.delete(claim.computerId);
      });
      // Mark admission before yielding so release always sees and joins this execution.
      this.active.set(claim.computerId, { abort, finished });
      return { finished };
    });
    if ('waiting' in admitted) {
      await admitted.waiting;
      return this.run(agentId, request, signal);
    }
    return admitted.finished;
  }
  async core(
    agentId: string,
    request: unknown,
    signal?: AbortSignal,
    retain?: (result: CoreReceipt) => Promise<void>,
  ): Promise<CoreReceipt> {
    await this.ready();
    let computerId = '';
    const receipt = await this.performCore(
      async () => {
        const claim = await this.claim(agentId);
        computerId = claim.computerId;
        return claim;
      },
      request,
      signal,
      retain,
    );
    const input = request as { kind?: string; operation?: string; session?: string };
    if (input.kind === 'terminal' && input.operation === 'delete' && input.session && !receipt.error) {
      this.agentDeletes.set(`${computerId}:${input.session}`, this.now());
      this.onAgentTerminalDelete?.({ agentId, computerId, session: input.session });
    }
    return receipt;
  }
  /** An agent's terminal_view; a successful look allows a few terminal_run_actions combos on that session. */
  async terminalView(agentId: string, request: { session: string }, signal?: AbortSignal): Promise<CoreReceipt> {
    await this.ready();
    let token = '';
    const receipt = await this.performCore(
      async () => {
        const claim = await this.claim(agentId);
        token = claim.token;
        return claim;
      },
      request,
      signal,
    );
    if (!receipt.error)
      this.terminalAllowances.set(agentId, {
        token,
        session: request.session,
        until: this.now() + TERMINAL_ALLOWANCE.seconds * 1000,
        remaining: TERMINAL_ALLOWANCE.combos,
      });
    return receipt;
  }
  /** An agent's terminal combo: spends one use of a recent view of the same session (returned if nothing started). */
  async terminalActions(
    agentId: string,
    request: { session: string } & Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CoreReceipt> {
    await this.ready();
    let spent: TerminalAllowance | undefined;
    let computerId = '';
    const refund = () => {
      if (spent && this.terminalAllowances.get(agentId) === spent) spent.remaining++;
    };
    const receipt = await this.performCore(
      async () => {
        const claim = await this.claim(agentId);
        const allowance = this.terminalAllowances.get(agentId);
        if (
          !allowance ||
          allowance.token !== claim.token ||
          allowance.session !== request.session ||
          this.now() >= allowance.until ||
          allowance.remaining <= 0
        )
          throw new ComputerUseError(
            `View this terminal first: a terminal_view allows ${TERMINAL_ALLOWANCE.combos} terminal_run_actions calls on that session within ${TERMINAL_ALLOWANCE.seconds} real seconds. Read Swarm Knowledge concepts/computers/terminals.`,
          );
        allowance.remaining--;
        spent = allowance;
        computerId = claim.computerId;
        this.onTerminalInput?.({ agentId, computerId, session: request.session, active: true });
        return claim;
      },
      request,
      signal,
    )
      .catch(error => {
        // Rejected before any input (validation, busy computer): an invalid combo spends nothing.
        if (error instanceof ComputerUseError && !(error instanceof ComputerExecutionError)) refund();
        throw error;
      })
      .finally(() => {
        if (computerId) this.onTerminalInput?.({ agentId, computerId, session: request.session, active: false });
      });
    if (!receipt.started) refund();
    return receipt;
  }
  /** Human viewer keyboard is concurrent like desktop input; agent tool fences remain unchanged. */
  async operatorTerminalKeyboard(computerId: string, send: () => void) {
    await this.ready();
    await this.exclusive(async () => {
      const computer = await this.database.client.computer.findUnique({
        where: { id: computerId },
        include: { claim: true },
      });
      if (!computer) throw new ComputerUseError('Computer not found.', 404);
      if (computer.state !== 'running' || computer.desiredState !== 'running')
        throw new ComputerUseError('Computer is not running.', 409);
      if (computer.claim) this.allowances.delete(computer.claim.agentId);
      send();
    });
  }
  /** Trusted human terminal surface: same execution fence, but no agent assignment/claim acquisition. */
  async operatorTerminal(computerId: string, input: Record<string, unknown>): Promise<CoreReceipt> {
    await this.ready();
    return this.performCore(
      async () => {
        const computer = await this.database.client.computer.findUnique({
          where: { id: computerId },
          include: { claim: true },
        });
        if (!computer) throw new ComputerUseError('Computer not found.', 404);
        if (computer.state !== 'running' || computer.desiredState !== 'running')
          throw new ComputerUseError('Computer is not running.', 409);
        return { computerId, agentId: computer.claim?.agentId };
      },
      { ...input, kind: 'terminal' },
    );
  }
  private async performCore(
    resolve: () => Promise<{ computerId: string; agentId?: string }>,
    request: unknown,
    signal?: AbortSignal,
    retain?: (result: CoreReceipt) => Promise<void>,
    patient = false,
  ): Promise<CoreReceipt> {
    const admitted = await this.exclusive(async () => {
      signal?.throwIfAborted();
      const claim = await resolve();
      if (this.uncertain.has(claim.computerId))
        throw new ComputerUseError(
          'Previous computer operation settlement is uncertain; Force release or stop the computer before retrying.',
          409,
        );
      const agentId = claim.agentId;
      const waiting = this.waitForReads(
        claim.computerId,
        'Another computer operation is executing; wait for its result.',
        patient,
      );
      if (waiting) return { waiting };
      const driver = this.driver();
      if (!driver.prepareCore || !driver.core)
        throw new ComputerUseError('Computer core tools are unavailable; update the guest runtime.', 503);
      const abort = new AbortController();
      const stop = () => abort.abort();
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) abort.abort();
      const finished = (async () => {
        let prepared;
        try {
          prepared = await driver.prepareCore!(claim.computerId, request, abort.signal);
        } catch (error) {
          // A failed read changed nothing, so it never blocks the computer as uncertain.
          if (error instanceof ComputerUseError && error.status === 503 && !isReadOnly(request))
            this.uncertain.add(claim.computerId);
          throw error;
        }
        signal?.throwIfAborted();
        if (!isReadOnly(request) && agentId) this.allowances.delete(agentId);
        const receipt = await Promise.resolve()
          .then(() => driver.core!(claim.computerId, prepared, abort.signal))
          .catch(error => {
            if (!(error instanceof ComputerExecutionError && error.settled) && !isReadOnly(request))
              this.uncertain.add(claim.computerId);
            // A watch's read never touches its agent's input allowance.
            if (agentId && !patient) this.allowances.delete(agentId);
            throw error;
          });
        signal?.throwIfAborted();
        await retain?.(receipt);
        signal?.throwIfAborted();
        return receipt;
      })().finally(() => {
        signal?.removeEventListener('abort', stop);
        this.active.delete(claim.computerId);
      });
      this.active.set(claim.computerId, { abort, finished, readOnly: isReadOnly(request) });
      return { finished };
    });
    if ('waiting' in admitted) {
      await admitted.waiting;
      return this.performCore(resolve, request, signal, retain, patient);
    }
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
    const active = this.active.get(computerId);
    active?.abort.abort();
    // Controller's cancellation generation fences delayed input even after a backend crash.
    await this.driver().cancel(computerId);
    await active?.finished.catch(() => {});
    await this.clearClaim(computerId, notice);
    this.uncertain.delete(computerId);
  }
  async forceRelease(computerId: string) {
    await this.ready();
    await this.exclusive(() =>
      this.release(
        computerId,
        'The human force released your computer. Use use_computer again; take a new screenshot before GUI input.',
      ),
    );
  }
  async releaseAgent(agentId: string) {
    await this.ready();
    await this.exclusive(async () => {
      const claim = await this.database.client.computerClaim.findUnique({ where: { agentId } });
      if (claim) await this.release(claim.computerId);
    });
  }
  async notices(agentId: string) {
    await this.ready();
    return this.database.client.computerNotice.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }
  async acknowledgeNotices(agentId: string, ids: string[]) {
    await this.database.client.computerNotice.deleteMany({ where: { agentId, id: { in: ids } } });
  }
}
