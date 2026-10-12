import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';

/**
 * The agent file's container (docs/agent-export.md): a gzip'd POSIX tar (ustar) of named parts. Written as a stream;
 * read back from a temporary file, bounded before and after decompression, so a file can never fill the disk or
 * memory (a "zip bomb" stops at the limit).
 */
const BLOCK = 512;
export type ArchivePart = { name: string; size: number; body: AsyncIterable<Uint8Array> | Uint8Array };

const NAME = /^[A-Za-z0-9._/-]{1,100}$/;
function header(name: string, size: number) {
  if (!NAME.test(name) || name.includes('..')) throw new Error(`Invalid archive entry name ${name}.`);
  const block = Buffer.alloc(BLOCK);
  const field = (offset: number, length: number, value: string) => block.write(value, offset, length, 'ascii');
  field(0, 100, name);
  field(100, 8, '0000644\0');
  field(108, 8, '0000000\0');
  field(116, 8, '0000000\0');
  field(124, 12, `${size.toString(8).padStart(11, '0')}\0`);
  field(
    136,
    12,
    `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0')}\0`,
  );
  block.fill(0x20, 148, 156); // checksum counted as spaces
  field(156, 1, '0');
  field(257, 6, 'ustar\0');
  field(263, 2, '00');
  let sum = 0;
  for (const byte of block) sum += byte;
  field(148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return block;
}

/** The tar stream of `parts` (each part's body must yield exactly its declared size). */
export async function* writeTar(parts: AsyncIterable<ArchivePart> | Iterable<ArchivePart>) {
  for await (const part of parts) {
    yield header(part.name, part.size);
    let written = 0;
    for await (const chunk of part.body instanceof Uint8Array ? [part.body] : part.body) {
      written += chunk.byteLength;
      if (written > part.size) throw new Error(`${part.name} is larger than declared.`);
      yield chunk;
    }
    if (written !== part.size) throw new Error(`${part.name} is smaller than declared.`);
    if (part.size % BLOCK) yield Buffer.alloc(BLOCK - (part.size % BLOCK));
  }
  yield Buffer.alloc(BLOCK * 2);
}

/** A JSON (or JSON Lines) part. */
export function jsonPart(name: string, value: unknown, lines = false): ArchivePart {
  const text = lines
    ? (value as unknown[]).map(item => JSON.stringify(item)).join('\n')
    : JSON.stringify(value, null, 2);
  const body = Buffer.from(text);
  return { name, size: body.byteLength, body };
}

export class ArchiveError extends Error {}

const bounded = (limit: number, message: string) => {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.byteLength;
      if (total > limit) return done(new ArchiveError(message));
      done(null, chunk);
    },
  });
};

/** An archive unpacked to a temporary file, its parts indexed by name. */
export class OpenedArchive {
  private constructor(
    private readonly folder: string,
    private readonly file: string,
    private readonly handle: FileHandle,
    readonly parts: Map<string, { offset: number; size: number }>,
  ) {}

  /**
   * Reads a gzip'd tar from `source`: at most `maxCompressed` bytes in, `maxSize` bytes once decompressed, and only
   * plain files with safe names (anything else is refused).
   */
  static async open(source: AsyncIterable<Uint8Array>, maxCompressed: number, maxSize: number) {
    const folder = await mkdtemp(join(tmpdir(), 'swarm-agent-import-'));
    const file = join(folder, 'archive.tar');
    try {
      await pipeline(
        source,
        bounded(maxCompressed, 'The file is larger than allowed.'),
        createGunzip(),
        bounded(maxSize, 'The file unpacks to more than allowed.'),
        createWriteStream(file, { mode: 0o600 }),
      ).catch(error => {
        throw error instanceof ArchiveError ? error : new ArchiveError('This is not an agent file.');
      });
      const handle = await open(file, 'r');
      const parts = new Map<string, { offset: number; size: number }>();
      const size = (await handle.stat()).size;
      const block = Buffer.alloc(BLOCK);
      let offset = 0;
      while (offset + BLOCK <= size) {
        await handle.read(block, 0, BLOCK, offset);
        if (block.every(byte => byte === 0)) break;
        const name = block.toString('ascii', 0, 100).replace(/\0.*$/s, '');
        const type = String.fromCharCode(block[156]!);
        const length = parseInt(block.toString('ascii', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
        if (!NAME.test(name) || name.includes('..') || (type !== '0' && type !== '\0') || !Number.isSafeInteger(length))
          throw new ArchiveError('This agent file has an entry it should not have.');
        if (parts.has(name)) throw new ArchiveError('This agent file repeats an entry.');
        offset += BLOCK;
        if (offset + length > size) throw new ArchiveError('This agent file is cut short.');
        parts.set(name, { offset, size: length });
        offset += Math.ceil(length / BLOCK) * BLOCK;
      }
      return new OpenedArchive(folder, file, handle, parts);
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
  }

  has(name: string) {
    return this.parts.has(name);
  }
  /** A part's bytes, refused above `maxBytes` (JSON parts are read whole). */
  async bytes(name: string, maxBytes = 256 * 1024 * 1024) {
    const part = this.parts.get(name);
    if (!part) throw new ArchiveError(`This agent file has no ${name}.`);
    if (part.size > maxBytes) throw new ArchiveError(`${name} is larger than allowed.`);
    const buffer = Buffer.alloc(part.size);
    if (part.size) await this.handle.read(buffer, 0, part.size, part.offset);
    return buffer;
  }
  async json<T>(name: string): Promise<T> {
    try {
      return JSON.parse((await this.bytes(name)).toString('utf8')) as T;
    } catch (error) {
      if (error instanceof ArchiveError) throw error;
      throw new ArchiveError(`${name} in this agent file is not valid.`);
    }
  }
  /** A JSON Lines part (missing: none). */
  async lines<T>(name: string): Promise<T[]> {
    if (!this.has(name)) return [];
    const text = (await this.bytes(name)).toString('utf8');
    try {
      return text ? text.split('\n').map(line => JSON.parse(line) as T) : [];
    } catch {
      throw new ArchiveError(`${name} in this agent file is not valid.`);
    }
  }
  /** A part as a stream (large files). */
  stream(name: string) {
    const part = this.parts.get(name);
    if (!part) throw new ArchiveError(`This agent file has no ${name}.`);
    if (!part.size) return (async function* () {})();
    return createReadStream(this.file, { start: part.offset, end: part.offset + part.size - 1 });
  }
  async close() {
    await this.handle.close().catch(() => {});
    await rm(this.folder, { recursive: true, force: true });
  }
}
