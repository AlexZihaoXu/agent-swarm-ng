import { expect, it } from 'vitest';
import { HttpComputerRuntime } from './runtime-client';
it('carries validation generation and cancels/joins on transport failure without retrying input', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: URL, init: RequestInit) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.endsWith('/validate')) return Response.json({ valid: true, validationToken: 'fence-token' });
    if (path.endsWith('/cancel')) return Response.json({ settled: true });
    if (path.endsWith('/actions')) { expect(JSON.parse(String(init.body)).validationToken).toBe('fence-token'); throw new Error('Network lost'); }
    throw new Error('Unexpected call');
  }) as unknown as typeof fetch;
  const client = new HttpComputerRuntime('http://controller:3101', fetcher);
  const prepared = await client.validate('desk', { actions: [{ type: 'mouse.left_click' }] });
  await expect(client.execute('desk', prepared)).rejects.toMatchObject({ settled: true });
  expect(calls).toEqual(['/computers/desk/actions/validate','/computers/desk/actions','/computers/desk/actions/cancel']);
});
it('returns zero-start validation rejection but never assumes an uncertain cancel settled', async () => {
  const fetcher = (async (url: URL) => new URL(url).pathname.endsWith('/cancel') ? Response.json({ settled: false }) : Response.json({ message: 'Bad combo' }, { status: 400 })) as unknown as typeof fetch;
  const client = new HttpComputerRuntime('http://controller:3101', fetcher);
  expect(await client.execute('desk', {})).toMatchObject({ started: false, completed: 0, error: expect.stringContaining('Bad combo') });
  await expect(client.cancel('desk')).rejects.toThrow(/confirmed/);
});
