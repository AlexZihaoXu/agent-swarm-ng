import type { PlatformStore } from './platform-store';
import type { SwarmSettingsStore } from './swarm-settings';
import { applyEdits, pageText, type TextEdit } from './text-page';

/** At most this many folders above a file: `a/b/c/file.md`. */
export const SCRATCH_MAX_FOLDERS = 3;
const SEGMENT_MAX = 80;
const PATH_MAX = 255;

export class ScratchError extends Error {}

/**
 * A scratch path: relative, `/`-separated, no `.`/`..` or empty segments, no control characters, at most three
 * folders deep. A leading `/` or `scratch:` is accepted and dropped. `''` is the root folder.
 */
export function scratchPath(raw: string, { folder = false } = {}) {
  if (typeof raw !== 'string') throw new ScratchError('A path is text such as "drafts/plan.md".');
  let path = raw.trim();
  if (path.startsWith('scratch:')) path = path.slice('scratch:'.length);
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!path) {
    if (folder) return '';
    throw new ScratchError('Name a file, such as "drafts/plan.md".');
  }
  if (path.length > PATH_MAX) throw new ScratchError(`Paths are at most ${PATH_MAX} characters.`);
  const segments = path.split('/');
  for (const segment of segments) {
    if (!segment) throw new ScratchError('A path has no empty parts ("a//b").');
    if (segment === '.' || segment === '..') throw new ScratchError('A path has no "." or ".." parts.');
    if (segment.length > SEGMENT_MAX) throw new ScratchError(`Each name is at most ${SEGMENT_MAX} characters.`);
    if (/[\u0000-\u001f\u007f\\]/.test(segment)) throw new ScratchError('Names have no control characters or "\\".');
  }
  if (segments.length - (folder ? 0 : 1) > SCRATCH_MAX_FOLDERS)
    throw new ScratchError(`The scratchpad allows at most ${SCRATCH_MAX_FOLDERS} levels of folders.`);
  return segments.join('/');
}
const inFolder = (path: string, folder: string) => !folder || path.startsWith(`${folder}/`);
/** The images a scratchpad keeps (as bytes, beside its text files). */
export const SCRATCH_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const kindOf = (mime: string | null) => (mime ? ('image' as const) : ('text' as const));
const byteSize = (text: string) => Buffer.byteLength(text, 'utf8');

type Activity = (event: { agentId: string; path: string; active: boolean }) => void;

/**
 * An agent's scratchpad: text files (UTF-8) and images kept as database rows under folder paths. Private to the agent
 * (the dashboard can browse it read-only), never deleted automatically, bounded by Settings → Swarm limits.
 */
export class Scratchpad {
  /** Told while an agent writes to its scratchpad (the chat shows it, like typing). */
  onActivity?: Activity;
  constructor(
    private database: PlatformStore,
    private settings: SwarmSettingsStore,
  ) {}

  private async rows(agentId: string) {
    await this.database.initialize();
    return this.database.client.scratchFile.findMany({
      where: { agentId },
      select: { path: true, size: true, mime: true, updatedAt: true },
      orderBy: { path: 'asc' },
    });
  }
  private async limits() {
    const settings = await this.settings.get();
    return {
      fileBytes: settings.scratchFileMaxKb * 1024,
      files: settings.scratchMaxFiles,
      totalBytes: settings.scratchTotalMb * 1024 * 1024,
    };
  }
  /** Runs a change while telling watchers the agent is writing `path`. */
  private async writing<T>(agentId: string, path: string, work: () => Promise<T>) {
    this.onActivity?.({ agentId, path, active: true });
    try {
      return await work();
    } finally {
      this.onActivity?.({ agentId, path, active: false });
    }
  }

  /** The folders and files directly inside `folder` (the root by default). */
  async list(agentId: string, rawFolder = '') {
    const folder = scratchPath(rawFolder, { folder: true });
    const rows = await this.rows(agentId);
    if (folder && !rows.some(row => inFolder(row.path, folder)))
      throw new ScratchError(`There is no folder "${folder}".`);
    const folders = new Map<string, { files: number; size: number }>();
    const files: { name: string; path: string; kind: 'text' | 'image'; size: number; updatedAt: string }[] = [];
    for (const row of rows) {
      if (!inFolder(row.path, folder)) continue;
      const rest = folder ? row.path.slice(folder.length + 1) : row.path;
      const slash = rest.indexOf('/');
      if (slash < 0)
        files.push({
          name: rest,
          path: row.path,
          kind: kindOf(row.mime),
          size: row.size,
          updatedAt: row.updatedAt.toISOString(),
        });
      else {
        const name = rest.slice(0, slash);
        const entry = folders.get(name) ?? { files: 0, size: 0 };
        entry.files++;
        entry.size += row.size;
        folders.set(name, entry);
      }
    }
    return {
      folder,
      folders: [...folders].map(([name, entry]) => ({ name, path: folder ? `${folder}/${name}` : name, ...entry })),
      files,
      usage: await this.usage(agentId, rows),
    };
  }
  async usage(agentId: string, rows?: { size: number }[]) {
    const all = rows ?? (await this.rows(agentId));
    const limits = await this.limits();
    return {
      files: all.length,
      bytes: all.reduce((sum, row) => sum + row.size, 0),
      maxFiles: limits.files,
      maxBytes: limits.totalBytes,
      maxFileBytes: limits.fileBytes,
    };
  }
  /** One page of a file (1-based lines, like the computer `read` tool). */
  async read(agentId: string, rawPath: string, offset?: number, limit?: number) {
    const path = scratchPath(rawPath);
    const row = await this.file(agentId, path);
    if (row.mime) throw new ScratchError(`"${path}" is an image (${row.mime}), not text.`);
    return { path, size: row.size, updatedAt: row.updatedAt.toISOString(), ...pageText(row.content, offset, limit) };
  }
  /** The whole file (for copying and previews): an image has `data` and `mime`, text has `content`. */
  async content(agentId: string, rawPath: string) {
    const path = scratchPath(rawPath);
    return this.file(agentId, path);
  }
  private async file(agentId: string, path: string) {
    await this.database.initialize();
    const row = await this.database.client.scratchFile.findUnique({ where: { agentId_path: { agentId, path } } });
    if (!row) {
      const isFolder = (await this.rows(agentId)).some(other => inFolder(other.path, path));
      throw new ScratchError(isFolder ? `"${path}" is a folder; list it instead.` : `There is no file "${path}".`);
    }
    return row;
  }

  /** Checks that `files` (path → size, replacing any same-path rows) fit the limits and the folder structure. */
  private async admit(agentId: string, files: Map<string, number>, removing: Set<string> = new Set()) {
    const limits = await this.limits();
    const rows = (await this.rows(agentId)).filter(row => !removing.has(row.path));
    const after = new Map(rows.map(row => [row.path, row.size]));
    for (const [path, size] of files) {
      if (size > limits.fileBytes)
        throw new ScratchError(`"${path}" is ${size} bytes; a scratch file is at most ${limits.fileBytes} bytes.`);
      if ([...after.keys()].some(other => other.startsWith(`${path}/`)))
        throw new ScratchError(`"${path}" is a folder; choose another file name.`);
      const segments = path.split('/');
      for (let i = 1; i < segments.length; i++) {
        const parent = segments.slice(0, i).join('/');
        if (after.has(parent) && !files.has(parent))
          throw new ScratchError(`"${parent}" is a file, so it cannot hold "${path}".`);
      }
      after.set(path, size);
    }
    if (after.size > limits.files)
      throw new ScratchError(`The scratchpad holds at most ${limits.files} files; delete some first.`);
    const total = [...after.values()].reduce((sum, size) => sum + size, 0);
    if (total > limits.totalBytes)
      throw new ScratchError(
        `That would use ${total} bytes; the scratchpad holds at most ${limits.totalBytes} bytes. Delete some files first.`,
      );
  }

  /** Creates or replaces a file. */
  async write(agentId: string, rawPath: string, content: string) {
    const path = scratchPath(rawPath);
    if (typeof content !== 'string') throw new ScratchError('Content is text.');
    const size = byteSize(content);
    return this.writing(agentId, path, async () => {
      await this.admit(agentId, new Map([[path, size]]));
      const existing = await this.database.client.scratchFile.findUnique({
        where: { agentId_path: { agentId, path } },
        select: { id: true },
      });
      await this.database.client.scratchFile.upsert({
        where: { agentId_path: { agentId, path } },
        create: { agentId, path, content, size },
        update: { content, size, data: null, mime: null },
      });
      return { path, size, created: !existing, lines: content ? content.split('\n').length : 0 };
    });
  }
  /** Creates or replaces an image (PNG, JPEG, WebP or GIF bytes). */
  async writeImage(agentId: string, rawPath: string, data: Uint8Array, mime: string) {
    const path = scratchPath(rawPath);
    if (!SCRATCH_IMAGE_TYPES.includes(mime)) throw new ScratchError('Images are PNG, JPEG, WebP or GIF.');
    const size = data.byteLength;
    return this.writing(agentId, path, async () => {
      await this.admit(agentId, new Map([[path, size]]));
      const existing = await this.database.client.scratchFile.findUnique({
        where: { agentId_path: { agentId, path } },
        select: { id: true },
      });
      const bytes = new Uint8Array(data);
      await this.database.client.scratchFile.upsert({
        where: { agentId_path: { agentId, path } },
        create: { agentId, path, content: '', data: bytes, mime, size },
        update: { content: '', data: bytes, mime, size },
      });
      return { path, size, mime, created: !existing };
    });
  }
  /** Exact replacements in one file, all checked before anything changes. */
  async edit(agentId: string, rawPath: string, edits: TextEdit[]) {
    const path = scratchPath(rawPath);
    const row = await this.file(agentId, path);
    if (row.mime) throw new ScratchError(`"${path}" is an image; it cannot be edited as text.`);
    const content = applyEdits(row.content, edits);
    return this.writing(agentId, path, async () => {
      await this.admit(agentId, new Map([[path, byteSize(content)]]));
      // Refuse if the file changed since it was read above (another edit won the race).
      const { count } = await this.database.client.scratchFile.updateMany({
        where: { agentId, path, updatedAt: row.updatedAt },
        data: { content, size: byteSize(content) },
      });
      if (!count) throw new ScratchError(`"${path}" changed while editing; read it again.`);
      return { path, size: byteSize(content), edits: edits.length };
    });
  }
  /** The files at `path`: the file itself, or everything inside the folder. */
  private async selection(agentId: string, path: string) {
    const rows = await this.rows(agentId);
    const exact = rows.filter(row => row.path === path);
    if (exact.length) return { kind: 'file' as const, paths: [path] };
    const inside = rows.filter(row => inFolder(row.path, path)).map(row => row.path);
    if (!inside.length) throw new ScratchError(`There is no file or folder "${path}".`);
    return { kind: 'folder' as const, paths: inside };
  }
  private target(from: string, to: string, path: string) {
    const moved = path === from ? to : `${to}${path.slice(from.length)}`;
    return scratchPath(moved);
  }
  /** Moves or renames a file or folder. */
  async move(agentId: string, rawFrom: string, rawTo: string) {
    const from = scratchPath(rawFrom),
      to = scratchPath(rawTo);
    if (from === to) throw new ScratchError('The source and destination are the same.');
    if (to.startsWith(`${from}/`)) throw new ScratchError('A folder cannot move inside itself.');
    const { kind, paths } = await this.selection(agentId, from);
    const rows = await this.database.client.scratchFile.findMany({
      where: { agentId, path: { in: paths } },
      select: { path: true, size: true },
    });
    const moved = new Map(rows.map(row => [this.target(from, to, row.path), row.size]));
    const existing = new Set((await this.rows(agentId)).map(row => row.path));
    for (const path of moved.keys())
      if (existing.has(path) && !paths.includes(path)) throw new ScratchError(`"${path}" already exists.`);
    return this.writing(agentId, to, async () => {
      await this.admit(agentId, moved, new Set(paths));
      await this.database.client.$transaction(
        rows.map(row =>
          this.database.client.scratchFile.update({
            where: { agentId_path: { agentId, path: row.path } },
            data: { path: this.target(from, to, row.path) },
          }),
        ),
      );
      return { kind, from, to, files: rows.length };
    });
  }
  /** Copies a file or folder inside the scratchpad (for example to keep an older version of a plan). */
  async copy(agentId: string, rawFrom: string, rawTo: string) {
    const from = scratchPath(rawFrom),
      to = scratchPath(rawTo);
    if (from === to) throw new ScratchError('The source and destination are the same.');
    if (to.startsWith(`${from}/`)) throw new ScratchError('A folder cannot be copied inside itself.');
    const { kind, paths } = await this.selection(agentId, from);
    const rows = await this.database.client.scratchFile.findMany({ where: { agentId, path: { in: paths } } });
    const copies = rows.map(row => ({
      path: this.target(from, to, row.path),
      content: row.content,
      data: row.data,
      mime: row.mime,
      size: row.size,
    }));
    const existing = new Set((await this.rows(agentId)).map(row => row.path));
    for (const copy of copies)
      if (existing.has(copy.path)) throw new ScratchError(`"${copy.path}" already exists; choose another name.`);
    return this.writing(agentId, to, async () => {
      await this.admit(agentId, new Map(copies.map(copy => [copy.path, copy.size])));
      await this.database.client.$transaction(
        copies.map(copy => this.database.client.scratchFile.create({ data: { agentId, ...copy } })),
      );
      return { kind, from, to, files: copies.length };
    });
  }
  /** Deletes a file, or a folder and everything in it. */
  async delete(agentId: string, rawPath: string) {
    const path = scratchPath(rawPath);
    const { kind, paths } = await this.selection(agentId, path);
    return this.writing(agentId, path, async () => {
      const { count } = await this.database.client.scratchFile.deleteMany({ where: { agentId, path: { in: paths } } });
      return { kind, path, deleted: count };
    });
  }
}
