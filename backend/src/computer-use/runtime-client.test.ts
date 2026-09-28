import { expect, it } from 'vitest';
import { HttpComputerRuntime } from './runtime-client';
it('carries validation generation and cancels/joins on transport failure without retrying input', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: URL, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith('/validate')) return Response.json({ valid: true, validationToken: 'fence-token' });
    if (path.endsWith('/cancel')) return Response.json({ settled: true });
    if (path.endsWith('/actions')) {
      expect(JSON.parse(String(init.body)).validationToken).toBe('fence-token');
      throw new Error('Network lost');
    }
    throw new Error('Unexpected call');
  }) as unknown as typeof fetch;
  const client = new HttpComputerRuntime('http://controller:3101', fetcher);
  const prepared = await client.validate('desk', { actions: [{ type: 'mouse.left_click' }] });
  await expect(client.execute('desk', prepared)).rejects.toMatchObject({ settled: true });
  expect(calls).toEqual([
    '/computers/desk/actions/validate',
    '/computers/desk/actions',
    '/computers/desk/core/cancel',
    '/computers/desk/actions/cancel',
  ]);
});
it('fences core requests and settles core processes before GUI input on cancellation', async () => {
  const calls: string[] = [];
  const token = 'edc242f0-06f3-4a19-a941-6c3935e44f87';
  const fetcher = (async (url: URL, options?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith('/prepare')) return Response.json({ validationToken: token });
    if (path.endsWith('/cancel')) return Response.json({ settled: true });
    expect(JSON.parse(options!.body as string)).toMatchObject({ kind: 'bash', validationToken: token });
    throw new Error('Connection lost');
  }) as unknown as typeof fetch;
  const client = new HttpComputerRuntime('http://controller', fetcher);
  const prepared = await client.prepareCore('desk', { kind: 'bash', command: 'pwd' });
  await expect(client.core('desk', prepared)).rejects.toMatchObject({ settled: true });
  expect(calls).toEqual([
    '/computers/desk/core/prepare',
    '/computers/desk/core/execute',
    '/computers/desk/core/cancel',
    '/computers/desk/actions/cancel',
  ]);
});
it('returns zero-start validation rejection but never assumes an uncertain cancel settled', async () => {
  const fetcher = (async (url: URL) =>
    new URL(url).pathname.endsWith('/cancel')
      ? Response.json({ settled: false })
      : Response.json({ message: 'Bad combo' }, { status: 400 })) as unknown as typeof fetch;
  const client = new HttpComputerRuntime('http://controller:3101', fetcher);
  expect(await client.execute('desk', {})).toMatchObject({
    started: false,
    completed: 0,
    error: expect.stringContaining('Bad combo'),
  });
  await expect(client.cancel('desk')).rejects.toThrow(/confirmed/);
});
