import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ScreenshotPool } from './image-pool';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
it('retains on disk, evicts oldest in batches, and rejects foreign or traversal reads', async () => {
  const root = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'images-')); roots.push(root);
  const pool = new ScreenshotPool(root, { maximum: 1000, evict: 400 });
  const frame = { data: new Uint8Array(250), mimeType: 'image/png' as const, width: 10, height: 10, bounds: [0,0,999,999] };
  const agent = crypto.randomUUID(); const first = await pool.put(agent, frame); const second = await pool.put(agent, frame);
  const third = await pool.put(agent, frame); const fourth = await pool.put(agent, frame);
  expect(await pool.read(agent, first.id)).toBeNull(); expect(await pool.read(agent, second.id)).toBeNull();
  expect((await new ScreenshotPool(root, { maximum: 1000, evict: 400 }).read(agent, fourth.id))?.data.byteLength).toBe(250);
  expect(await pool.read(crypto.randomUUID(), third.id)).toBeNull(); expect(await pool.read(agent, '../secret')).toBeNull();
  expect((await readdir(root)).filter(p => p.endsWith('.png'))).toHaveLength(2);
});
it('rejects oversize single images without evicting existing copies', async () => {
  const root = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'images-')); roots.push(root);
  const pool = new ScreenshotPool(root, { maximum: 100, evict: 30 }); const agent = crypto.randomUUID();
  const frame = { data: new Uint8Array(20), mimeType: 'image/png' as const, width: 2, height: 2, bounds: [0,0,999,999] };
  const first = await pool.put(agent, frame);
  await expect(pool.put(agent, { ...frame, data: new Uint8Array(101) })).rejects.toThrow(/large/);
  expect(await pool.read(agent, first.id)).not.toBeNull();
});
