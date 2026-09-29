import type { PlatformStore } from '../platform-store';
import type { SwarmSettingsStore } from '../swarm-settings';
import { channelAccess, type Actor } from './access';
import { BlobStore, FileTooLargeError } from './blob-store';
import { detectFile, fileName } from './file-kind';

/** Files one message may carry (humans and agents alike). */
export const FILES_PER_MESSAGE = 10;
/** Storage use at or above this share of the budget shows a warning. */
export const STORAGE_WARNING = 0.8;
const MB = 1024 * 1024;

export class FileError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 413 | 507 = 400,
  ) {
    super(message);
  }
}
/** Who posted a file (a name snapshot keeps it meaningful after an agent is deleted). */
export type Uploader = { kind: 'human' } | { kind: 'agent'; id: string; name: string };
export type MessageKind = 'chat' | 'dm' | 'group';

type Row = Awaited<ReturnType<PlatformStore['client']['channelFile']['findUniqueOrThrow']>>;
/** A file as the dashboard and agents see it. A deleted file keeps its name, who deleted it and when. */
export function fileView(row: Row) {
  return {
    id: row.id,
    channelKey: row.channelKey,
    name: row.name,
    mime: row.mime,
    kind: row.kind as 'image' | 'text' | 'pdf' | 'other',
    size: row.size,
    status: row.status as 'available' | 'deleted',
    uploader: {
      kind: row.uploaderKind as 'human' | 'agent',
      id: row.uploaderId,
      name: row.uploaderName,
    },
    messageKind: row.messageKind as MessageKind | null,
    messageId: row.messageId,
    createdAt: row.createdAt.toISOString(),
    ...(row.status === 'deleted'
      ? {
          deleted: {
            by: { kind: row.deletedByKind as 'human' | 'agent', id: row.deletedById, name: row.deletedByName ?? '' },
            at: row.deletedAt?.toISOString() ?? null,
          },
        }
      : {}),
  };
}
export type FileView = ReturnType<typeof fileView>;

/**
 * Files posted to channels. Bytes live once per content in the blob store; each post is a ChannelFile row tied
 * to its channel and (once sent) its message. Nothing is deleted automatically: the uploader or the human deletes
 * a file (a tombstone stays), and deleting a channel deletes its files. Access always follows the channel.
 */
export class FileStore {
  constructor(
    private database: PlatformStore,
    readonly blobs: BlobStore,
    private settings: SwarmSettingsStore,
  ) {}

  /** Bytes stored (each content once) against the Settings → Swarm budget. */
  async usage() {
    await this.database.initialize();
    const [blobs, files, settings] = await Promise.all([
      this.database.client.fileBlob.aggregate({ _sum: { size: true } }),
      this.database.client.channelFile.count({ where: { status: 'available' } }),
      this.settings.get(),
    ]);
    const bytes = blobs._sum.size ?? 0;
    const budgetBytes = settings.storageBudgetGb * 1024 * MB;
    return {
      bytes,
      budgetBytes,
      files,
      maxFileBytes: settings.uploadMaxMb * MB,
      warning: bytes >= budgetBytes * STORAGE_WARNING,
      full: bytes >= budgetBytes,
    };
  }

  /**
   * Stores one file for a channel (not yet in a message: `attach` puts it there). Refused when the uploader may
   * not post in the channel, the file is larger than Settings → Swarm allows, or storage is full.
   */
  async add(input: {
    channelKey: string;
    uploader: Uploader;
    name: string;
    source: AsyncIterable<Uint8Array> | Uint8Array;
  }) {
    const actor: Actor = input.uploader.kind === 'human' ? { kind: 'human' } : { kind: 'agent', id: input.uploader.id };
    const access = await channelAccess(this.database, input.channelKey, actor);
    if (!access.exists) throw new FileError('That channel does not exist.', 404);
    if (!access.post) throw new FileError('You cannot post files in that channel.', 403);
    const usage = await this.usage();
    if (usage.full)
      throw new FileError('File storage is full. Delete files or raise the limit in Settings → Swarm.', 507);
    let stored;
    try {
      stored = await this.blobs.put(input.source, usage.maxFileBytes);
    } catch (error) {
      if (error instanceof FileTooLargeError)
        throw new FileError(`Files are at most ${Math.round(usage.maxFileBytes / MB)} MB (Settings → Swarm).`, 413);
      throw error;
    }
    const known = await this.database.client.fileBlob.findUnique({ where: { id: stored.id } });
    if (!known && usage.bytes + stored.size > usage.budgetBytes) {
      await this.blobs.remove(stored.id);
      throw new FileError('File storage is full. Delete files or raise the limit in Settings → Swarm.', 507);
    }
    const name = fileName(input.name);
    const { kind, mime } = detectFile(name, stored.head);
    const row = await this.database.client.$transaction(async tx => {
      if (!known)
        await tx.fileBlob.upsert({
          where: { id: stored.id },
          create: { id: stored.id, size: stored.size },
          update: {},
        });
      return tx.channelFile.create({
        data: {
          channelKey: input.channelKey,
          uploaderKind: input.uploader.kind,
          uploaderId: input.uploader.kind === 'agent' ? input.uploader.id : null,
          uploaderName: input.uploader.kind === 'agent' ? input.uploader.name : 'You',
          name,
          mime,
          kind,
          size: stored.size,
          blobId: stored.id,
        },
      });
    });
    return fileView(row);
  }

  /** Checks files can go into a message (before it is saved): same channel and uploader, unsent, at most 10. */
  async attachable(ids: string[], target: { channelKey: string; uploader: Uploader; messageId?: string }) {
    if (ids.length > FILES_PER_MESSAGE) throw new FileError(`A message carries at most ${FILES_PER_MESSAGE} files.`);
    if (new Set(ids).size !== ids.length) throw new FileError('A file is listed twice.');
    if (!ids.length) return;
    await this.database.initialize();
    const rows = await this.database.client.channelFile.findMany({ where: { id: { in: ids } } });
    const uploaderId = target.uploader.kind === 'agent' ? target.uploader.id : null;
    for (const id of ids) {
      const row = rows.find(item => item.id === id);
      if (!row || row.channelKey !== target.channelKey)
        throw new FileError('That file was not uploaded to this chat.', 404);
      if (row.uploaderKind !== target.uploader.kind || row.uploaderId !== uploaderId)
        throw new FileError('That file was uploaded by someone else.', 403);
      if (row.messageId && row.messageId !== target.messageId)
        throw new FileError('That file is already in a message.', 409);
      if (row.status !== 'available') throw new FileError(`"${row.name}" was deleted.`, 409);
    }
  }
  /** Puts uploaded files into a sent message: same channel, same uploader, not yet in a message, at most 10. */
  async attach(
    ids: string[],
    target: { channelKey: string; messageKind: MessageKind; messageId: string; uploader: Uploader },
  ) {
    if (!ids.length) return [];
    await this.attachable(ids, target);
    await this.database.client.channelFile.updateMany({
      where: { id: { in: ids } },
      data: { messageKind: target.messageKind, messageId: target.messageId },
    });
    return this.forMessages(target.messageKind, [target.messageId]).then(map => map.get(target.messageId) ?? []);
  }
  /** File references for the agent (what it sees in message envelopes). */
  static refs(files: FileView[] | undefined) {
    return (files ?? []).map(file => ({
      id: file.id,
      name: file.name,
      kind: file.kind,
      size: file.size,
      status: file.status,
    }));
  }

  /** History items (with message ids) plus their file references as agent tools show them. */
  async annotate<T extends { id: string }>(messageKind: MessageKind, items: T[]) {
    const map = await this.forMessages(
      messageKind,
      items.map(item => item.id),
    );
    return items.map(item => {
      const files = map.get(item.id);
      if (!files) return item;
      return { ...item, files: FileStore.refs(files).map(({ id, ...file }) => ({ fileId: id, ...file })) };
    });
  }

  async get(id: string) {
    await this.database.initialize();
    const row = await this.database.client.channelFile.findUnique({ where: { id } });
    return row ? { view: fileView(row), blobId: row.blobId } : null;
  }
  /** The files of these messages, in upload order, keyed by message id (for history and publications). */
  async forMessages(messageKind: MessageKind, messageIds: string[]) {
    const map = new Map<string, FileView[]>();
    if (!messageIds.length) return map;
    await this.database.initialize();
    const rows = await this.database.client.channelFile.findMany({
      where: { messageKind, messageId: { in: messageIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) map.set(row.messageId!, [...(map.get(row.messageId!) ?? []), fileView(row)]);
    return map;
  }
  /** A channel's files for its Files modal: sent files, newest first by default, optionally searched by name. */
  async list(
    channelKey: string,
    options: {
      query?: string;
      sort?: 'date' | 'name' | 'size' | 'type';
      order?: 'asc' | 'desc';
      includeDeleted?: boolean;
    } = {},
  ) {
    await this.database.initialize();
    const rows = await this.database.client.channelFile.findMany({
      where: {
        channelKey,
        messageId: { not: null },
        ...(options.includeDeleted ? {} : { status: 'available' }),
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const query = options.query?.trim().toLowerCase();
    const matching = query ? rows.filter(row => row.name.toLowerCase().includes(query)) : rows;
    const order = options.order === 'asc' ? 1 : -1;
    const key = options.sort ?? 'date';
    matching.sort((a, b) => {
      const compare =
        key === 'name'
          ? a.name.localeCompare(b.name)
          : key === 'size'
            ? a.size - b.size
            : key === 'type'
              ? a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
              : a.createdAt.getTime() - b.createdAt.getTime();
      return compare * order;
    });
    return { files: matching.map(fileView), totalBytes: matching.reduce((sum, row) => sum + row.size, 0) };
  }

  /**
   * Deletes a file: its bytes go (unless another post shares them) and a tombstone keeps its name, who deleted it
   * and when. The human may delete any file; an agent only files it uploaded, in a channel it can still see.
   */
  /** Hears each deletion, so open chats can show the tombstone. */
  onDeleted?: (file: FileView) => void;
  async delete(id: string, actor: Actor, actorName: string) {
    const found = await this.get(id);
    if (!found) throw new FileError('No such file.', 404);
    const { view } = found;
    const access = await channelAccess(this.database, view.channelKey, actor);
    if (!access.view) throw new FileError('No such file.', 404);
    const own = actor.kind === 'agent' && view.uploader.kind === 'agent' && view.uploader.id === actor.id;
    if (!access.deleteAny && !own) throw new FileError('Only the uploader or the human can delete this file.', 403);
    if (view.status === 'deleted') return view;
    await this.database.client.channelFile.update({
      where: { id },
      data: {
        status: 'deleted',
        blobId: null,
        deletedByKind: actor.kind,
        deletedById: actor.kind === 'agent' ? actor.id : null,
        deletedByName: actorName,
        deletedAt: new Date(),
      },
    });
    await this.collect([found.blobId]);
    const deleted = (await this.get(id))!.view;
    this.onDeleted?.(deleted);
    return deleted;
  }
  /** Deleting a channel deletes its files (their rows too, since the messages are gone). */
  async deleteChannels(channelKeys: string[]) {
    if (!channelKeys.length) return;
    await this.database.initialize();
    const rows = await this.database.client.channelFile.findMany({
      where: { channelKey: { in: channelKeys } },
      select: { blobId: true },
    });
    await this.database.client.channelFile.deleteMany({ where: { channelKey: { in: channelKeys } } });
    await this.collect(rows.map(row => row.blobId));
  }
  /** Deleting an agent deletes the files of its private chat and of its agent-to-agent DMs. */
  async deleteForAgent(agentId: string, channelIds: string[]) {
    await this.database.initialize();
    const dms = await this.database.client.channelFile.findMany({
      where: { channelKey: { startsWith: 'dm:', contains: agentId } },
      select: { channelKey: true },
      distinct: ['channelKey'],
    });
    const keys = dms.map(row => row.channelKey).filter(key => key.split(':').slice(1).includes(agentId));
    await this.deleteChannels([...channelIds.map(id => `chat:${id}`), ...keys]);
  }
  /**
   * Uploads that never made it into a message (the send was abandoned) are removed after a while; they were never
   * in a chat. Posted files are never removed automatically.
   */
  async pruneUnsent(olderThanMs = 24 * 60 * 60 * 1000) {
    await this.database.initialize();
    const before = new Date(Date.now() - olderThanMs);
    const rows = await this.database.client.channelFile.findMany({
      where: { messageId: null, createdAt: { lt: before } },
      select: { id: true, blobId: true },
    });
    if (!rows.length) return 0;
    await this.database.client.channelFile.deleteMany({ where: { id: { in: rows.map(row => row.id) } } });
    await this.collect(rows.map(row => row.blobId));
    return rows.length;
  }
  /** Removes blobs no file refers to any more. */
  private async collect(blobIds: (string | null)[]) {
    for (const id of new Set(blobIds.filter((value): value is string => Boolean(value)))) {
      const users = await this.database.client.channelFile.count({ where: { blobId: id } });
      if (users) continue;
      await this.database.client.fileBlob.deleteMany({ where: { id } });
      await this.blobs.remove(id);
    }
  }
}
