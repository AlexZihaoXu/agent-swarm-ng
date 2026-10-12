import { expect, it } from 'vitest';
import { triageGate } from './triage-gate';

it('runs one triage at a time per agent; one cancelled while waiting leaves at once and never runs', async () => {
  let release!: () => void;
  const order: string[] = [];
  const first = triageGate('agent', async () => {
    order.push('first');
    await new Promise<void>(resolve => (release = resolve));
    return 'first';
  });
  const controller = new AbortController();
  const waiting = triageGate(
    'agent',
    async () => {
      order.push('cancelled one');
      return 'never';
    },
    controller.signal,
  );
  const third = triageGate('agent', async () => {
    order.push('third');
    return 'third';
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  // It stops waiting now, while the first triage is still running.
  await expect(waiting).rejects.toThrow();
  expect(order).toEqual(['first']);
  release();
  expect(await first).toBe('first');
  expect(await third).toBe('third');
  expect(order).toEqual(['first', 'third']);
});
