import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { SwarmSettingsStore } from '../swarm-settings';
import { Scratchpad } from '../scratchpad';
import type { ComputerUseService } from '../computer-use/service';
import { BlobStore } from './blob-store';
import { FileStore } from './store';
import { createFileTools, parseLocation } from './file-tools';
import { chatKey } from './access';
import { ControllerError } from '../computer-controller-client';

const text = (value: { content: { type: string; text?: string }[] }) => JSON.parse(value.content[0].text!);
async function setup() {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  const database = await prepareDatabase(join(root, 'platform.db'));
  const a = await database.createAgent({ name: 'Aether', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const b = await database.createAgent({ name: 'Bram', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const settings = new SwarmSettingsStore(database);
  const files = new FileStore(database, new BlobStore(join(root, 'files')), settings);
  const scratch = new Scratchpad(database, settings);
  // A computer assigned to Aether and currently held by Bram; its disk is a map.
  const disk = new Map<string, Buffer>([['/home/agent/data.bin', Buffer.from([0, 159, 146, 150])]]);
  const notices: [string, string][] = [];
  const computers = {
    list: async (agentId: string) =>
      agentId === a.id
        ? [{ id: 'c1', name: 'Desk', state: 'running', holder: { id: b.id, name: 'Bram' }, current: false }]
        : [],
  } as unknown as ComputerUseService;
  const collect = async (source: AsyncIterable<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const transfers = {
    exportFile: async (_id: string, path: string) => {
      if (path === '/offline') throw new TypeError('fetch failed');
      const bytes = disk.get(path);
      if (!bytes) throw new ControllerError(404, 'Path not found.');
      return {
        name: path.split('/').pop()!,
        size: bytes.length,
        stream: (async function* () {
          yield bytes;
        })(),
      };
    },
    importFile: async (_id: string, path: string, size: number, body: AsyncIterable<Uint8Array>) => {
      const bytes = await collect(body);
      expect(bytes.length).toBe(size);
      disk.set(path, bytes);
      return { path, size };
    },
  };
  const toolsFor = (agent: { id: string; name: string; channels: { id: string }[] }) =>
    Object.fromEntries(
      createFileTools({
        agentId: agent.id,
        agentName: agent.name,
        channelId: agent.channels[0].id,
        files,
        scratch,
        settings,
        computers,
        transfers,
        notifyHolder: (holder, message) => notices.push([holder, message]),
      }).map(tool => [tool.name, tool]),
    );
  const call = async (agent: typeof a, name: string, params: object, vision = false) =>
    toolsFor(agent)[name].execute('call', params as never, undefined, undefined, {
      model: { input: vision ? ['text', 'image'] : ['text'] },
    } as never);
  return { database, a, b, files, scratch, disk, notices, call };
}

it('parses the three kinds of location', () => {
  expect(parseLocation('scratch:drafts/a.md')).toEqual({ kind: 'scratch', path: 'drafts/a.md' });
  expect(parseLocation('computer:My Desk:/home/agent/x:y.txt')).toEqual({
    kind: 'computer',
    computer: 'My Desk',
    path: '/home/agent/x:y.txt',
  });
  expect(parseLocation('file:abc')).toEqual({ kind: 'file', fileId: 'abc' });
  expect(() => parseLocation('/etc/passwd')).toThrow('scratch:');
});

it('uploads from the scratchpad, lists and reads files by page, and deletes only its own', async () => {
  const { database, a, b, scratch, files, call } = await setup();
  try {
    await scratch.write(a.id, 'notes/plan.md', 'one\ntwo\nthree\n');
    const uploaded = text(await call(a, 'upload_file', { from: 'scratch:notes/plan.md' }));
    expect(uploaded).toMatchObject({ name: 'plan.md', kind: 'text', sent: false, channelId: a.channels[0].id });
    const read = text(await call(a, 'read_file', { fileId: uploaded.fileId, limit: 2 }));
    expect(read).toMatchObject({ text: 'one\ntwo\n', nextOffset: 3, totalLines: 3 });
    // Like the Files dialog, the list shows sent files.
    expect(text(await call(a, 'list_files', {})).files).toHaveLength(0);
    await files.attach([uploaded.fileId], {
      channelKey: chatKey(a.channels[0].id),
      messageKind: 'chat',
      messageId: 'm1',
      uploader: { kind: 'agent', id: a.id, name: 'Aether' },
    });
    expect(text(await call(a, 'list_files', {})).files).toMatchObject([{ name: 'plan.md', uploadedBy: 'Aether' }]);
    // Another agent cannot see a private chat's files.
    await expect(call(b, 'read_file', { fileId: uploaded.fileId })).rejects.toThrow('No such file');
    await expect(call(b, 'list_files', { channelId: `chat:${a.channels[0].id}` })).rejects.toThrow();
    // The human's file cannot be deleted by the agent; its own can.
    const human = await files.add({
      channelKey: chatKey(a.channels[0].id),
      uploader: { kind: 'human' },
      name: 'x.bin',
      source: new Uint8Array([0, 1, 2]),
    });
    await expect(call(a, 'delete_file', { fileId: human.id })).rejects.toThrow('uploader or the human');
    await expect(call(a, 'read_file', { fileId: human.id })).rejects.toThrow('copy_file it to an assigned computer');
    expect(text(await call(a, 'delete_file', { fileId: uploaded.fileId }))).toMatchObject({ status: 'deleted' });
    await expect(call(a, 'read_file', { fileId: uploaded.fileId })).rejects.toThrow('deleted by Aether');
  } finally {
    await database.close();
  }
});

it('copies between the scratchpad and assigned computers, text-only into the scratchpad, and tells the holder', async () => {
  const { database, a, b, scratch, disk, notices, call } = await setup();
  try {
    await scratch.write(a.id, 'report.md', '# Report\n');
    expect(
      text(await call(a, 'copy_file', { from: 'scratch:report.md', to: 'computer:Desk:/home/agent/report.md' })),
    ).toMatchObject({ copied: true, to: 'computer:Desk:/home/agent/report.md', size: 9 });
    expect(disk.get('/home/agent/report.md')!.toString()).toBe('# Report\n');
    expect(notices).toEqual([[b.id, 'Aether copied a file to /home/agent/report.md on Desk.']]);
    // Back into the scratchpad under another name; binary files stay out.
    await call(a, 'copy_file', { from: 'computer:c1:/home/agent/report.md', to: 'scratch:copy.md' });
    expect((await scratch.content(a.id, 'copy.md')).content).toBe('# Report\n');
    await expect(
      call(a, 'copy_file', { from: 'computer:Desk:/home/agent/data.bin', to: 'scratch:d.bin' }),
    ).rejects.toThrow('UTF-8 text');
    // Scratch to scratch keeps old versions side by side.
    await call(a, 'copy_file', { from: 'scratch:report.md', to: 'scratch:report-v1.md' });
    expect((await scratch.content(a.id, 'report-v1.md')).content).toBe('# Report\n');
    // Assignment is required; a chat file is never a destination.
    await expect(call(b, 'copy_file', { from: 'scratch:x.md', to: 'computer:Desk:/tmp/x' })).rejects.toThrow();
    await expect(call(a, 'copy_file', { from: 'scratch:report.md', to: 'computer:Other:/tmp/x' })).rejects.toThrow(
      'not a computer assigned to you',
    );
    await expect(call(a, 'copy_file', { from: 'scratch:report.md', to: 'file:x' })).rejects.toThrow('upload_file');
    // An unreachable controller is reported as such, not as a raw network error.
    await expect(call(a, 'copy_file', { from: 'computer:Desk:/offline', to: 'scratch:x.md' })).rejects.toThrow(
      'controller is unavailable',
    );
    // A chat file (any type) can go onto a computer.
    const up = text(await call(a, 'upload_file', { from: 'computer:Desk:/home/agent/data.bin' }));
    expect(up).toMatchObject({ kind: 'other', size: 4 });
    await call(a, 'copy_file', { from: `file:${up.fileId}`, to: 'computer:Desk:/tmp/data.bin' });
    expect(disk.get('/tmp/data.bin')).toEqual(disk.get('/home/agent/data.bin'));
  } finally {
    await database.close();
  }
});

it('presents a scratch file live: readers see its current content', async () => {
  const { database, a, scratch, files, call } = await setup();
  try {
    await scratch.write(a.id, 'draft.md', 'v1\n');
    const presented = text(await call(a, 'present_scratch', { path: 'draft.md' }));
    expect(presented).toMatchObject({ name: 'draft.md', sent: false });
    expect((await files.get(presented.fileId))!.view).toMatchObject({
      kind: 'scratch',
      scratch: { agentId: a.id, path: 'draft.md' },
    });
    await scratch.write(a.id, 'draft.md', 'v2\n');
    expect(text(await call(a, 'read_file', { fileId: presented.fileId }))).toMatchObject({ text: 'v2\n' });
    await scratch.delete(a.id, 'draft.md');
    await expect(call(a, 'read_file', { fileId: presented.fileId })).rejects.toThrow('no longer');
  } finally {
    await database.close();
  }
});
