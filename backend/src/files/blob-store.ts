import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

export class FileTooLargeError extends Error {}
const ID = /^[0-9a-f]{64}$/;

/**
 * File bytes on disk, named by their SHA-256 under `<root>/<ab>/<hash>`. Writes stream to a temporary file,
 * are flushed to disk and then renamed into place, so a crash never leaves a partial blob under a real name.
 */
export class BlobStore {
  constructor(readonly root: string) {}

  path(id: string) {
    if (!ID.test(id)) throw new Error('Invalid blob id.');
    return join(this.root, id.slice(0, 2), id);
  }
  /** Stores bytes, refusing more than `maxBytes`. Returns the id, size and the first 8 KiB (for type detection). */
  async put(source: AsyncIterable<Uint8Array> | Uint8Array, maxBytes: number) {
    const staged = await this.stage(source, maxBytes);
    await this.commit(staged);
    return staged;
  }
  /**
   * Writes bytes to a temporary file (flushed) and hashes them, without publishing them yet: `commit` moves them
   * into place (or drops them when that content already exists), `discard` removes them.
   */
  async stage(source: AsyncIterable<Uint8Array> | Uint8Array, maxBytes: number) {
    const temporary = join(this.root, 'tmp');
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    const file = join(temporary, randomUUID());
    const handle = await open(file, 'wx', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    const head: Uint8Array[] = [];
    let headSize = 0;
    try {
      const chunks = source instanceof Uint8Array ? [source] : source;
      for await (const chunk of chunks) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new FileTooLargeError(`The file is larger than ${maxBytes} bytes.`);
        hash.update(chunk);
        if (headSize < 8192) {
          head.push(chunk.subarray(0, 8192 - headSize));
          headSize += Math.min(chunk.byteLength, 8192 - headSize);
        }
        await handle.write(chunk);
      }
      await handle.sync();
    } catch (error) {
      await handle.close();
      await rm(file, { force: true });
      throw error;
    }
    await handle.close();
    return { id: hash.digest('hex'), size, head: Buffer.concat(head), temporary: file };
  }
  async commit(staged: { id: string; temporary: string }) {
    await mkdir(join(this.root, staged.id.slice(0, 2)), { recursive: true, mode: 0o700 });
    if (await this.exists(staged.id)) await rm(staged.temporary, { force: true });
    else await rename(staged.temporary, this.path(staged.id));
  }
  async discard(staged: { temporary: string }) {
    await rm(staged.temporary, { force: true });
  }
  async exists(id: string) {
    return stat(this.path(id)).then(
      () => true,
      () => false,
    );
  }
  stream(id: string, range?: { start: number; end: number }) {
    return createReadStream(this.path(id), range);
  }
  read(id: string) {
    return readFile(this.path(id));
  }
  async remove(id: string) {
    await rm(this.path(id), { force: true });
  }
  /** Leftover temporary files from an interrupted upload (after a crash). */
  async clearTemporary() {
    await rm(join(this.root, 'tmp'), { recursive: true, force: true });
  }
}
