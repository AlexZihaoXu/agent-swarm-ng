import type { ChannelMessage } from './chat-runtime';
export type TriageDecision = { action: 'interrupt' | 'queue' | 'uncertain'; reason: string };
export type EvaluateMessages = (messages: ChannelMessage[], signal: AbortSignal) => Promise<TriageDecision>;

/** Backend-owned admission, debounce and revision guard; no model or publication authority. */
export class MessageInbox {
  private pending: ChannelMessage[] = [];
  private revision = 0;
  private receivedAt = 0;
  private closed = false;
  private wake?: () => void;
  private changed?: () => void;
  private triage?: AbortController;
  private note?: string;
  constructor(private debounceMs = 1500) {}
  add(message: ChannelMessage) {
    if (this.closed) return false;
    this.pending.push(message);
    // A Discord batch already waited out its channel's quiet period: it does not restart the pause.
    if (!message.source?.discord) this.receivedAt = Date.now();
    this.revision++;
    this.wake?.();
    this.triage?.abort();
    this.changed?.();
    return true;
  }
  prepend(message: ChannelMessage) {
    if (!this.pending.length) return this.add(message);
    if (this.closed) return false;
    this.pending.unshift(message);
    this.revision++;
    this.wake?.();
    return true;
  }
  hasPending() {
    return this.pending.length > 0;
  }
  pendingIds() {
    return this.pending.map(message => message.id).filter((id): id is string => Boolean(id));
  }
  close() {
    this.closed = true;
    this.triage?.abort();
    this.wake?.();
  }
  async take(signal: AbortSignal) {
    while (!this.closed && Date.now() - this.receivedAt < this.debounceMs) {
      signal.throwIfAborted();
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          this.wake = undefined;
          resolve();
        };
        const timer = setTimeout(done, Math.max(0, this.debounceMs - (Date.now() - this.receivedAt)));
        this.wake = done;
        signal.addEventListener('abort', done, { once: true });
      });
    }
    signal.throwIfAborted();
    const messages = this.pending.splice(0),
      note = this.note;
    this.note = undefined;
    return { messages, note };
  }
  async during(
    work: () => Promise<void>,
    evaluate: EvaluateMessages,
    interrupt: () => Promise<void>,
    signal: AbortSignal,
  ) {
    let running = true,
      interrupted = false,
      evaluated = -1;
    let pump: Promise<void> | undefined;
    const start = () => {
      if (pump || !running || interrupted || signal.aborted || !this.pending.length) return;
      pump = (async () => {
        while (running && !interrupted && !signal.aborted && this.pending.length && evaluated !== this.revision) {
          const revision = this.revision;
          evaluated = revision;
          const controller = new AbortController();
          this.triage = controller;
          const abort = () => controller.abort();
          signal.addEventListener('abort', abort, { once: true });
          let decision: TriageDecision;
          try {
            decision = await evaluate([...this.pending], controller.signal);
          } catch {
            // Failing open to an interrupt: new messages must not wait behind long work because triage broke.
            decision = {
              action: 'interrupt',
              reason: 'Triage unavailable; interrupting so the new messages are not missed.',
            };
          } finally {
            signal.removeEventListener('abort', abort);
          }
          if (!running || signal.aborted || controller.signal.aborted || revision !== this.revision) continue;
          if (decision.action === 'interrupt') {
            interrupted = true;
            this.note = `Interruption triage: interrupt. ${decision.reason.slice(0, 500)}\nRe-evaluate the request using the new messages. Preserve completed work; cancellation does not undo effects. Do not blindly repeat unfinished side-effecting operations.`;
            await interrupt();
          }
        }
      })()
        .catch(() => {
          this.note = undefined;
          interrupted = false;
        })
        .finally(() => {
          pump = undefined;
          // An arrival between the loop's last check and promise settlement must not be lost.
          if (evaluated !== this.revision) start();
        });
    };
    this.changed = start;
    try {
      const result = work();
      start();
      await result;
    } finally {
      running = false;
      this.changed = undefined;
      this.triage?.abort();
      await pump;
      this.triage = undefined;
    }
    return interrupted;
  }
}
