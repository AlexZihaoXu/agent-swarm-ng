import { expect, it } from 'vitest';
import { bodyOf } from './computer-controller-client';

const collect = async (source: AsyncIterable<Uint8Array>) => {
  const parts: Uint8Array[] = [];
  for await (const part of source) parts.push(part);
  return Buffer.concat(parts).toString();
};

it('reads a download as it arrives, so a caller may take it after other work', async () => {
  const body = bodyOf(new Response('part one, part two'));
  // An upload checks the database first; the bytes are buffered meanwhile.
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(await collect(body)).toBe('part one, part two');
});

it('passes a failed download on, and cancels one the caller stops reading', async () => {
  const failing = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('half'));
      controller.error(new Error('connection reset'));
    },
  });
  await expect(collect(bodyOf(new Response(failing)))).rejects.toThrow('connection reset');

  let cancelled = false;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  });
  const body = bodyOf(new Response(endless));
  await body.next();
  await body.return(undefined);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(cancelled).toBe(true);
});
