import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { SwarmSettingsStore } from '../swarm-settings';
import { BlobStore } from './blob-store';
import { channelAccess, chatKey, dmKey, groupKey, parseChannelKey } from './access';
import { detectFile, fileName } from './file-kind';
import { FileStore } from './store';

const bytes = (text: string) => new TextEncoder().encode(text);
async function setup() {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  const database = await prepareDatabase(join(root, 'platform.db'));
  const a = await database.createAgent({ name: 'Aether', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const b = await database.createAgent({ name: 'Bram', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const c = await database.createAgent({ name: 'Cleo', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const settings = new SwarmSettingsStore(database);
  const blobs = new BlobStore(join(root, 'files'));
  const files = new FileStore(database, blobs, settings);
  return { database, a, b, c, settings, blobs, files, root };
}
const agent = (row: { id: string; name: string }) => ({ kind: 'agent' as const, id: row.id, name: row.name });

it('knows images and PDFs by their bytes, text by being UTF-8, and everything else as a plain file', () => {
  expect(detectFile('x.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({
    kind: 'image',
    mime: 'image/png',
  });
  expect(detectFile('photo', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ kind: 'image' });
  expect(detectFile('a.pdf', bytes('%PDF-1.7'))).toMatchObject({ kind: 'pdf' });
  expect(detectFile('dict.py', bytes('from x import y\n'))).toEqual({ kind: 'text', mime: 'text/x-python' });
  // A renamed binary is not an image, and SVG/HTML are text (previewed as source, never rendered).
  expect(detectFile('fake.png', bytes('hello'))).toMatchObject({ kind: 'text' });
  expect(detectFile('logo.svg', bytes('<svg/>'))).toMatchObject({ kind: 'text' });
  expect(detectFile('x.icm', new Uint8Array([0, 1, 2, 3]))).toEqual({
    kind: 'other',
    mime: 'application/octet-stream',
  });
  // A multi-byte character cut at the end of the sample is still text.
  expect(detectFile('a.txt', bytes('héllo').subarray(0, 2))).toMatchObject({ kind: 'text' });
  expect(fileName('../../etc/passwd')).toBe('passwd');
  expect(fileName('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
  expect(fileName('...hidden')).toBe('hidden');
  expect(fileName('')).toBe('file');
});

it('names channels by kind and lets each actor see and post exactly where they already can talk', async () => {
  const { database, a, b, c } = await setup();
  try {
    expect(parseChannelKey('dm:b:a')).toBeNull(); // DM keys are sorted, as DM conversations are named
    expect(parseChannelKey('nope:1')).toBeNull();
    const channel = a.channels[0].id;
    expect(await channelAccess(database, chatKey(channel), { kind: 'human' })).toMatchObject({
      view: true,
      post: true,
      deleteAny: true,
    });
    expect(await channelAccess(database, chatKey(channel), { kind: 'agent', id: a.id })).toMatchObject({
      view: true,
      post: true,
      deleteAny: false,
    });
    expect(await channelAccess(database, chatKey(channel), { kind: 'agent', id: b.id })).toMatchObject({ view: false });
    // A DM: participants see it; they post only while connected; the human looks but never posts.
    const dm = dmKey(a.id, b.id);
    expect(await channelAccess(database, dm, { kind: 'agent', id: a.id })).toMatchObject({ view: true, post: false });
    await database.client.dmGrant.createMany({
      data: [
        { senderId: a.id, recipientId: b.id },
        { senderId: b.id, recipientId: a.id },
      ],
    });
    expect(await channelAccess(database, dm, { kind: 'agent', id: a.id })).toMatchObject({ post: true });
    expect(await channelAccess(database, dm, { kind: 'agent', id: c.id })).toMatchObject({ view: false });
    expect(await channelAccess(database, dm, { kind: 'human' })).toMatchObject({
      view: true,
      post: false,
      deleteAny: true,
    });
    // A group: members and the human.
    const group = await database.client.groupChat.create({
      data: { name: 'Team', members: { create: [{ agentId: a.id }] } },
    });
    expect(await channelAccess(database, groupKey(group.id), { kind: 'agent', id: a.id })).toMatchObject({
      post: true,
    });
    expect(await channelAccess(database, groupKey(group.id), { kind: 'agent', id: b.id })).toMatchObject({
      view: false,
    });
    expect(await channelAccess(database, groupKey('missing'), { kind: 'human' })).toMatchObject({ exists: false });
  } finally {
    await database.close();
  }
});

it('stores each content once, attaches files to messages, and keeps a tombstone when a file is deleted', async () => {
  const { database, a, b, files, blobs } = await setup();
  try {
    const key = chatKey(a.channels[0].id);
    const first = await files.add({
      channelKey: key,
      uploader: { kind: 'human' },
      name: 'spec.md',
      source: bytes('# Spec\n'),
    });
    expect(first).toMatchObject({
      name: 'spec.md',
      kind: 'text',
      size: 7,
      status: 'available',
      uploader: { name: 'You' },
    });
    const again = await files.add({ channelKey: key, uploader: agent(a), name: 'copy.md', source: bytes('# Spec\n') });
    expect(await database.client.fileBlob.count()).toBe(1); // same bytes, one blob
    await expect(
      files.add({ channelKey: key, uploader: agent(b), name: 'x.md', source: bytes('x') }),
    ).rejects.toMatchObject({ status: 403 });
    // Attach: only your own uploads to this channel, once.
    await expect(
      files.attach([again.id], { channelKey: key, messageKind: 'chat', messageId: 'm1', uploader: { kind: 'human' } }),
    ).rejects.toMatchObject({ status: 403 });
    const attached = await files.attach([first.id], {
      channelKey: key,
      messageKind: 'chat',
      messageId: 'm1',
      uploader: { kind: 'human' },
    });
    expect(attached.map(file => file.id)).toEqual([first.id]);
    await expect(
      files.attach([first.id], { channelKey: key, messageKind: 'chat', messageId: 'm2', uploader: { kind: 'human' } }),
    ).rejects.toMatchObject({ status: 409 });
    // Attaching again to the same message (a retried send) is harmless.
    await files.attach([first.id], {
      channelKey: key,
      messageKind: 'chat',
      messageId: 'm1',
      uploader: { kind: 'human' },
    });
    await files.attach([again.id], { channelKey: key, messageKind: 'chat', messageId: 'm2', uploader: agent(a) });
    expect((await files.list(key)).files.map(file => file.id)).toEqual([again.id, first.id]);
    // An agent may delete only its own file; the human any. Bytes stay while another file shares them.
    await expect(files.delete(first.id, { kind: 'agent', id: a.id }, 'Aether')).rejects.toMatchObject({ status: 403 });
    const gone = await files.delete(again.id, { kind: 'agent', id: a.id }, 'Aether');
    expect(gone).toMatchObject({
      status: 'deleted',
      name: 'copy.md',
      deleted: { by: { kind: 'agent', name: 'Aether' } },
    });
    expect(await database.client.fileBlob.count()).toBe(1);
    await files.delete(first.id, { kind: 'human' }, 'You');
    expect(await database.client.fileBlob.count()).toBe(0);
    expect(
      await blobs.exists(
        (await database.client.channelFile.findUniqueOrThrow({ where: { id: first.id } })).blobId ?? '0'.repeat(64),
      ),
    ).toBe(false);
    // Tombstones remain for the chat bubbles, not in the Files list.
    expect((await files.forMessages('chat', ['m1'])).get('m1')![0]).toMatchObject({
      status: 'deleted',
      name: 'spec.md',
    });
    expect((await files.list(key)).files).toEqual([]);
    // Agent history tools see references, including tombstones, and nothing for messages without files.
    expect(await files.annotate('chat', [{ id: 'm1' }, { id: 'none' }])).toEqual([
      { id: 'm1', files: [{ fileId: first.id, name: 'spec.md', kind: 'text', size: 7, status: 'deleted' }] },
      { id: 'none' },
    ]);
    expect((await files.list(key, { includeDeleted: true })).files).toHaveLength(2);
  } finally {
    await database.close();
  }
});

it('enforces the per-file limit and the storage budget, and deletes a channel’s files with it', async () => {
  const { database, a, settings, files, root } = await setup();
  try {
    const key = chatKey(a.channels[0].id);
    await settings.update({ uploadMaxMb: 1, storageBudgetGb: 1 });
    await expect(
      files.add({
        channelKey: key,
        uploader: { kind: 'human' },
        name: 'big.bin',
        source: new Uint8Array(1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ status: 413 });
    // Nothing half-written is left behind.
    expect(await readdir(join(root, 'files', 'tmp'))).toEqual([]);
    const kept = await files.add({ channelKey: key, uploader: { kind: 'human' }, name: 'a.txt', source: bytes('a') });
    await files.attach([kept.id], {
      channelKey: key,
      messageKind: 'chat',
      messageId: 'm',
      uploader: { kind: 'human' },
    });
    expect(await files.usage()).toMatchObject({ bytes: 1, files: 1, warning: false, full: false });
    // A never-sent upload is pruned later; a sent one is not.
    const draft = await files.add({ channelKey: key, uploader: { kind: 'human' }, name: 'b.txt', source: bytes('b') });
    await database.client.channelFile.update({ where: { id: draft.id }, data: { createdAt: new Date(0) } });
    expect(await files.pruneUnsent()).toBe(1);
    expect(await files.get(kept.id)).not.toBeNull();
    await files.deleteChannels([key]);
    expect(await database.client.channelFile.count()).toBe(0);
    expect(await database.client.fileBlob.count()).toBe(0);
  } finally {
    await database.close();
  }
});
