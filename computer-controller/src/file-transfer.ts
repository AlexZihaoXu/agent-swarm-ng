import { posix } from 'node:path';
import { ResourceError } from './resources';

/** Largest file one transfer moves (the backend applies the smaller configured limit). */
export const MAX_TRANSFER = 1024 * 1024 * 1024;
const BLOCK = 512;

/** An absolute guest file path outside virtual filesystems, normalised. */
export function transferPath(raw: unknown) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.includes('\0') || Buffer.byteLength(raw) > 4096)
    throw new ResourceError(400, 'Use an absolute guest file path of at most 4096 bytes.');
  const path = posix.normalize(raw);
  const name = posix.basename(path);
  if (path === '/' || path.endsWith('/') || !name || name === '.' || name === '..' || Buffer.byteLength(name) > 255)
    throw new ResourceError(400, 'Name a file, not a folder.');
  if (['/proc', '/sys', '/dev'].some(root => path === root || path.startsWith(`${root}/`)))
    throw new ResourceError(403, 'Virtual filesystems are not available.');
  return { path, directory: posix.dirname(path), name };
}

/** Docker's path stat header (Go FileMode bits): only a plain file transfers. */
export function regularFile(header: string | null) {
  let stat: { name?: unknown; size?: unknown; mode?: unknown; linkTarget?: unknown };
  try {
    stat = JSON.parse(Buffer.from(header ?? '', 'base64').toString());
  } catch {
    throw new ResourceError(503, 'Invalid guest file response.');
  }
  if (typeof stat.size !== 'number' || typeof stat.mode !== 'number')
    throw new ResourceError(503, 'Invalid guest file response.');
  if (typeof stat.linkTarget === 'string' && stat.linkTarget)
    throw new ResourceError(400, 'This path is a symbolic link; copy the file it points to instead.');
  // ModeDir | ModeSymlink | ModeNamedPipe | ModeSocket | ModeDevice | ModeCharDevice | ModeIrregular
  const type = (1n << 31n) | (1n << 27n) | (1n << 25n) | (1n << 24n) | (1n << 26n) | (1n << 21n) | (1n << 19n);
  if (BigInt(Math.trunc(stat.mode)) & type) throw new ResourceError(400, 'Only regular files can be copied.');
  return { size: stat.size };
}

function octal(value: number, length: number) {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}
function header(name: string, size: number, type: '0' | 'x', mtime: number) {
  const block = Buffer.alloc(BLOCK);
  block.write(name.slice(0, 99), 0, 'ascii');
  block.write(octal(0o644, 8), 100, 'ascii');
  block.write(octal(1000, 8), 108, 'ascii');
  block.write(octal(1000, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(mtime, 12), 136, 'ascii');
  block.fill(' ', 148, 156);
  block.write(type, 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7) + ' ', 148, 'ascii');
  return block;
}
const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/**
 * A one-file tar stream: a PAX record carries the exact (possibly long or non-ASCII) name, then the regular file
 * owned by the guest user (1000:1000, mode 0644), then the end marker. Exactly `size` body bytes are required.
 */
export async function* tarOneFile(name: string, size: number, body: AsyncIterable<Uint8Array>) {
  const mtime = Math.floor(Date.now() / 1000);
  // A PAX record counts its own length digits: "<length> key=value\n".
  const record = (key: string, value: string) => {
    const text = ` ${key}=${value}\n`;
    const base = Buffer.byteLength(text);
    let length = base + String(base).length;
    if (String(length).length !== String(base).length) length = base + String(length).length;
    return `${length}${text}`;
  };
  const pax = Buffer.from(record('path', name));
  yield header('PaxHeader', pax.length, 'x', mtime);
  yield pax;
  yield padding(pax.length);
  yield header('file', size, '0', mtime);
  let written = 0;
  for await (const chunk of body) {
    written += chunk.byteLength;
    if (written > size) throw new ResourceError(400, 'The file is larger than announced.');
    yield chunk;
  }
  if (written !== size) throw new ResourceError(400, 'The file is smaller than announced.');
  yield padding(size);
  yield Buffer.alloc(BLOCK * 2);
}

/** Reads a tar stream up to its first regular file and yields just that file's bytes. */
export async function* untarFirstFile(source: AsyncIterable<Uint8Array>, maxBytes: number) {
  let buffer = Buffer.alloc(0);
  const iterator = source[Symbol.asyncIterator]();
  const fill = async (length: number) => {
    while (buffer.length < length) {
      const next = await iterator.next();
      if (next.done) throw new ResourceError(503, 'Incomplete guest file response.');
      buffer = Buffer.concat([buffer, next.value]);
    }
  };
  try {
    while (true) {
      await fill(BLOCK);
      const block = buffer.subarray(0, BLOCK);
      buffer = buffer.subarray(BLOCK);
      if (block.every(byte => byte === 0)) throw new ResourceError(400, 'Only regular files can be copied.');
      const size = parseInt(block.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
      const type = String.fromCharCode(block[156] || 48);
      if (!Number.isSafeInteger(size) || size < 0) throw new ResourceError(503, 'Invalid guest file response.');
      const padded = size + ((BLOCK - (size % BLOCK)) % BLOCK);
      if (['x', 'g', 'L', 'K'].includes(type)) {
        // Metadata entries (long names, PAX records) precede the file: skip them.
        if (padded > 1024 * 1024) throw new ResourceError(503, 'Invalid guest file response.');
        await fill(padded);
        buffer = buffer.subarray(padded);
        continue;
      }
      if (type !== '0') throw new ResourceError(400, 'Only regular files can be copied.');
      if (size > maxBytes) throw new ResourceError(413, 'The file is larger than the transfer limit.');
      let remaining = size;
      while (remaining > 0) {
        if (!buffer.length) {
          const next = await iterator.next();
          if (next.done) throw new ResourceError(503, 'Incomplete guest file response.');
          buffer = Buffer.from(next.value);
        }
        const part = buffer.subarray(0, Math.min(remaining, buffer.length));
        buffer = buffer.subarray(part.length);
        remaining -= part.length;
        yield part;
      }
      return;
    }
  } finally {
    await iterator.return?.();
  }
}
