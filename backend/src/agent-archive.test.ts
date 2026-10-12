import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { ArchiveError, jsonPart, OpenedArchive, writeTar } from './agent-archive';

const gz = (parts: Parameters<typeof writeTar>[0]) => Readable.from(writeTar(parts)).pipe(createGzip());
const collect = async (source: AsyncIterable<Uint8Array>) => {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

describe('agent file container', () => {
  it('round-trips JSON, JSON Lines and large binary parts', async () => {
    const big = Buffer.alloc(700_000, 7);
    const archive = await OpenedArchive.open(
      gz([
        jsonPart('manifest.json', { format: 'swarm-agent', version: 1 }),
        jsonPart('memories.jsonl', [{ a: 1 }, { b: 2 }], true),
        {
          name: 'files/blob',
          size: big.byteLength,
          body: (async function* () {
            yield big.subarray(0, 1000);
            yield big.subarray(1000);
          })(),
        },
        jsonPart('empty.jsonl', [], true),
      ]),
      10_000_000,
      10_000_000,
    );
    try {
      expect(await archive.json('manifest.json')).toEqual({ format: 'swarm-agent', version: 1 });
      expect(await archive.lines('memories.jsonl')).toEqual([{ a: 1 }, { b: 2 }]);
      expect(await archive.lines('empty.jsonl')).toEqual([]);
      expect(await archive.lines('missing.jsonl')).toEqual([]);
      expect((await collect(archive.stream('files/blob'))).equals(big)).toBe(true);
    } finally {
      await archive.close();
    }
  });

  it('refuses what is not an agent file, and stops unpacking at the limit', async () => {
    await expect(OpenedArchive.open(Readable.from([Buffer.from('not gzip')]), 1000, 1000)).rejects.toBeInstanceOf(
      ArchiveError,
    );
    const bomb = Buffer.alloc(5_000_000);
    await expect(
      OpenedArchive.open(gz([{ name: 'zeros', size: bomb.byteLength, body: bomb }]), 1_000_000, 1_000_000),
    ).rejects.toThrow('unpacks to more than allowed');
    await expect(collect(writeTar([jsonPart('../escape', {})]))).rejects.toThrow('Invalid archive entry name');
  });
});
