import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { regularFile, tarOneFile, transferPath, untarFirstFile } from './file-transfer';

async function collect(source: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function* chunks(...parts: string[]) {
  for (const part of parts) yield Buffer.from(part);
}

it('accepts absolute file paths outside virtual filesystems only', () => {
  expect(transferPath('/home/agent/a/../b.txt')).toEqual({ path: '/home/agent/b.txt', directory: '/home/agent', name: 'b.txt' });
  for (const bad of ['relative', '/', '/proc/1/environ', '/dev/sda', '/sys/x', '/tmp/', `/${'x'.repeat(256)}`])
    expect(() => transferPath(bad)).toThrow();
});

it('builds a tar that standard tar extracts exactly (long, non-ASCII names included) and reads it back', async () => {
  const name = `${'long-'.repeat(30)}résumé.txt`;
  const tar = await collect(tarOneFile(name, 11, chunks('hello', ' world')));
  expect(tar.length % 512).toBe(0);
  const folder = mkdtempSync(join(tmpdir(), 'tar-'));
  try {
    writeFileSync(join(folder, 'x.tar'), tar);
    execFileSync('tar', ['-xf', 'x.tar'], { cwd: folder });
    expect(readFileSync(join(folder, name), 'utf8')).toBe('hello world');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  // Split at awkward boundaries, the first file still comes back byte for byte.
  const pieces = async function* () {
    for (let index = 0; index < tar.length; index += 300) yield tar.subarray(index, index + 300);
  };
  expect((await collect(untarFirstFile(pieces(), 100))).toString()).toBe('hello world');
  await expect(collect(untarFirstFile(pieces(), 5))).rejects.toMatchObject({ code: 413 });
});

it('refuses a body that differs from the announced size', async () => {
  await expect(collect(tarOneFile('a', 3, chunks('four')))).rejects.toThrow('larger');
  await expect(collect(tarOneFile('a', 5, chunks('four')))).rejects.toThrow('smaller');
});

it('lets only regular files through Docker path stats', () => {
  const stat = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64');
  expect(regularFile(stat({ name: 'a', size: 3, mode: 0o644, linkTarget: '' }))).toEqual({ size: 3 });
  expect(() => regularFile(stat({ name: 'd', size: 0, mode: 2 ** 31 + 0o755, linkTarget: '' }))).toThrow('regular');
  expect(() => regularFile(stat({ name: 'l', size: 0, mode: 2 ** 27, linkTarget: '/etc/passwd' }))).toThrow('link');
  expect(() => regularFile(stat({ name: 'p', size: 0, mode: 2 ** 25 }))).toThrow('regular');
  expect(() => regularFile('garbage')).toThrow();
});
