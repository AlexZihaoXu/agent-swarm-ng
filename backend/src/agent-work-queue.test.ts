import { afterEach, expect, it, vi } from 'vitest';
import { AgentWorkQueue } from './agent-work-queue';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

it('serializes conversations for one agent while allowing independent agents to work', async () => {
  const queue = new AgentWorkQueue(),
    gate = deferred(),
    calls: string[] = [];
  const human = queue.submit('a', 'human', async () => {
    calls.push('human');
    await gate.promise;
  });
  const dm = queue.submit('a', 'dm', async () => {
    calls.push('dm');
  });
  const other = queue.submit('b', 'dm', async () => {
    calls.push('other');
  });
  await other.finished;
  expect(calls).toEqual(['human', 'other']);
  expect(dm.state).toBe('queued');
  gate.resolve();
  await human.finished;
  await dm.finished;
  expect(calls).toEqual(['human', 'other', 'dm']);
  expect(queue.size).toBe(0);
});
it('cancels a queued job immediately, but does not release a running slot before cleanup', async () => {
  const queue = new AgentWorkQueue(),
    cleanup = deferred(),
    started = deferred();
  const active = queue.submit('a', 'human', async signal => {
    started.resolve();
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    await cleanup.promise;
  });
  await started.promise;
  const discarded = queue.submit('a', 'cancelled-dm', vi.fn());
  const laterWork = vi.fn(async () => {}),
    next = queue.submit('a', 'next-dm', laterWork);
  discarded.cancel();
  expect(await discarded.finished).toBe('cancelled');
  active.cancel();
  await Promise.resolve();
  expect(laterWork).not.toHaveBeenCalled();
  cleanup.resolve();
  await active.finished;
  await next.finished;
  expect(laterWork).toHaveBeenCalledTimes(1);
});
it('bounds admission, expires queued work, and rejects submissions after shutdown', async () => {
  vi.useFakeTimers();
  const queue = new AgentWorkQueue(2, 3),
    gate = deferred();
  const active = queue.submit('a', 'human', async () => gate.promise);
  const queuedWork = vi.fn(),
    waiting = queue.submit('a', 'dm', queuedWork, { queueTimeoutMs: 100 });
  expect(() => queue.submit('a', 'another', vi.fn())).toThrow('queue is full');
  expect(() => queue.submit('a', 'human', vi.fn())).toThrow('already queued');
  await vi.advanceTimersByTimeAsync(100);
  expect(await waiting.finished).toBe('cancelled');
  expect(queuedWork).not.toHaveBeenCalled();
  gate.resolve();
  await active.finished;
  await queue.shutdown();
  expect(() => queue.submit('b', 'new', vi.fn())).toThrow('shutting down');
});
it('applies execution deadlines only after startup, and failures do not strand subsequent work', async () => {
  vi.useFakeTimers();
  const queue = new AgentWorkQueue();
  const first = queue.submit(
    'a',
    'timeout',
    signal => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
    { executionTimeoutMs: 100 },
  );
  const failed = queue.submit('a', 'failure', async () => {
    throw new Error('private failure');
  });
  const final = queue.submit('a', 'last', async () => {});
  await vi.advanceTimersByTimeAsync(100);
  expect(await first.finished).toBe('cancelled');
  expect(await failed.finished).toBe('failed');
  expect(await final.finished).toBe('completed');
  expect(queue.size).toBe(0);
});
