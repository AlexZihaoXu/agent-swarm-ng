import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageInbox, type TriageDecision } from './message-inbox';
const message = (text: string) => ({ role: 'user' as const, text });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
describe('message admission and interruption races', () => {
  it('waits for 1.5 seconds of silence and preserves all messages in order', async () => {
    vi.useFakeTimers();
    const inbox = new MessageInbox();
    const signal = new AbortController().signal;
    inbox.add(message('hi'));
    const take = inbox.take(signal);
    const settled = vi.fn();
    void take.then(settled);
    await vi.advanceTimersByTimeAsync(1000);
    inbox.add(message('do the task'));
    await vi.advanceTimersByTimeAsync(1499);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await take).messages.map(m => m.text)).toEqual(['hi', 'do the task']);
  });
  it('cancels triage when main finishes, without interrupting completed work', async () => {
    const inbox = new MessageInbox(0),
      main = deferred<void>();
    let cancelled = false;
    const interrupt = vi.fn();
    const run = inbox.during(
      () => main.promise,
      (_messages, signal) =>
        new Promise(resolve => {
          signal.addEventListener('abort', () => {
            cancelled = true;
            resolve({ action: 'interrupt', reason: 'late' });
          });
        }),
      interrupt,
      new AbortController().signal,
    );
    inbox.add(message('new'));
    main.resolve();
    await run;
    expect(cancelled).toBe(true);
    expect(interrupt).not.toHaveBeenCalled();
    expect(inbox.hasPending()).toBe(true);
  });
  it('ignores stale decisions and serializes triage; only latest revision can interrupt', async () => {
    const inbox = new MessageInbox(0),
      main = deferred<void>(),
      first = deferred<TriageDecision>();
    const evaluate = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ action: 'interrupt', reason: 'Correction' });
    const interrupt = vi.fn(async () => main.resolve());
    const run = inbox.during(() => main.promise, evaluate, interrupt, new AbortController().signal);
    inbox.add(message('one'));
    inbox.add(message('two'));
    expect(evaluate).toHaveBeenCalledTimes(1);
    first.resolve({ action: 'interrupt', reason: 'stale' });
    await run;
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect((await inbox.take(new AbortController().signal)).note).toContain('Correction');
  });
  it('triages a message arriving as the previous evaluation is settling', async () => {
    const inbox = new MessageInbox(0),
      main = deferred<void>(),
      first = deferred<TriageDecision>();
    const evaluate = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ action: 'interrupt', reason: 'New correction' });
    const interrupt = vi.fn(async () => main.resolve());
    const run = inbox.during(() => main.promise, evaluate, interrupt, new AbortController().signal);
    inbox.add(message('one'));
    first.resolve({ action: 'queue', reason: 'Unrelated' });
    await Promise.resolve();
    inbox.add(message('correction arriving at settlement'));
    await run;
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  it('queues uncertainty and errors; Stop cancels debounce and closes admission', async () => {
    const inbox = new MessageInbox(),
      controller = new AbortController();
    inbox.add(message('saved'));
    const result = inbox.take(controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow();
    inbox.close();
    expect(inbox.add(message('late'))).toBe(false);
    for (const action of ['queue', 'uncertain', 'error']) {
      const queue = new MessageInbox(0),
        main = deferred<void>(),
        interrupt = vi.fn();
      const evaluate = vi.fn(async () => {
        if (action === 'error') throw new Error();
        return { action: action as 'queue' | 'uncertain', reason: 'Wait' };
      });
      const run = queue.during(() => main.promise, evaluate, interrupt, new AbortController().signal);
      queue.add(message('follow-up'));
      await Promise.resolve();
      main.resolve();
      await run;
      expect(interrupt).not.toHaveBeenCalled();
      expect(queue.hasPending()).toBe(true);
    }
  });
});
