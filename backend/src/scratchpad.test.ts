import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { Scratchpad, scratchPath } from './scratchpad';
import { SwarmSettingsStore } from './swarm-settings';
import { applyEdits, pageText } from './text-page';
import { createCanvas } from '@napi-rs/canvas';

const png = () => createCanvas(8, 4).encode('png');

async function setup() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await database.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  const other = await database.createAgent({ name: 'B', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  const settings = new SwarmSettingsStore(database);
  const pad = new Scratchpad(database, settings);
  const activity: string[] = [];
  pad.onActivity = event => activity.push(`${event.active ? '+' : '-'}${event.path}`);
  return { database, agent, other, settings, pad, activity };
}

it('accepts relative paths at most three folders deep and refuses anything else', () => {
  expect(scratchPath('drafts/plan.md')).toBe('drafts/plan.md');
  expect(scratchPath('/scratch:x')).toBe('scratch:x'); // only a leading "scratch:" prefix is dropped
  expect(scratchPath('scratch:/a/b/c/d.md')).toBe('a/b/c/d.md');
  expect(scratchPath('', { folder: true })).toBe('');
  expect(() => scratchPath('a/b/c/d/e.md')).toThrow('3 levels');
  expect(scratchPath('a/b/c', { folder: true })).toBe('a/b/c');
  expect(() => scratchPath('a/b/c/d', { folder: true })).toThrow('3 levels');
  for (const bad of ['', 'a//b', '../x', 'a/./b', 'a\\b', 'bad\u0007name', 'x'.repeat(81)])
    expect(() => scratchPath(bad)).toThrow();
});

it('pages text like the computer read tool and applies exact, unique, disjoint edits', () => {
  const text = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const first = pageText(text);
  expect(first).toMatchObject({ offset: 1, lines: 200, totalLines: 450, nextOffset: 201, prevOffset: null });
  expect(pageText(text, 401)).toMatchObject({ lines: 50, nextOffset: null, prevOffset: 201, truncated: false });
  const long = pageText('é'.repeat(30_000));
  expect(long).toMatchObject({ partialLine: true, truncated: true, nextOffset: null });
  expect(Buffer.byteLength(long.text)).toBeLessThanOrEqual(50_000);
  expect(
    applyEdits('a b c', [
      { oldText: 'c', newText: 'C' },
      { oldText: 'a', newText: 'A' },
    ]),
  ).toBe('A b C');
  expect(() => applyEdits('a a', [{ oldText: 'a', newText: 'b' }])).toThrow('more than once');
  expect(() => applyEdits('abc', [{ oldText: 'x', newText: 'y' }])).toThrow('not found');
  expect(() =>
    applyEdits('abc', [
      { oldText: 'ab', newText: '' },
      { oldText: 'bc', newText: '' },
    ]),
  ).toThrow('overlap');
});

it('keeps each agent’s text files in folders, with write, edit, list, copy, move and delete', async () => {
  const { database, agent, other, pad, activity } = await setup();
  try {
    expect(await pad.write(agent.id, 'plans/plan.md', '# Plan\nstep one\n')).toMatchObject({ created: true });
    expect(await pad.write(agent.id, 'plans/plan.md', '# Plan\nstep one\nstep two\n')).toMatchObject({
      created: false,
    });
    await pad.write(agent.id, 'notes.txt', 'hello');
    expect(activity).toEqual([
      '+plans/plan.md',
      '-plans/plan.md',
      '+plans/plan.md',
      '-plans/plan.md',
      '+notes.txt',
      '-notes.txt',
    ]);
    const root = await pad.list(agent.id);
    expect(root.folders).toEqual([{ name: 'plans', path: 'plans', files: 1, size: 25 }]);
    expect(root.files.map(file => file.name)).toEqual(['notes.txt']);
    expect(root.usage).toMatchObject({ files: 2, maxFiles: 500 });
    // Private: another agent sees nothing.
    expect((await pad.list(other.id)).files).toEqual([]);
    await expect(pad.read(other.id, 'notes.txt')).rejects.toThrow('no file');
    // Edit is exact and checked first.
    await pad.edit(agent.id, 'plans/plan.md', [{ oldText: 'step two', newText: 'step 2' }]);
    expect((await pad.read(agent.id, 'plans/plan.md')).text).toContain('step 2');
    await expect(pad.edit(agent.id, 'plans/plan.md', [{ oldText: 'missing', newText: 'x' }])).rejects.toThrow();
    // Copy keeps the old version; a folder copies whole.
    await pad.copy(agent.id, 'plans/plan.md', 'plans/plan-v1.md');
    await pad.copy(agent.id, 'plans', 'archive/plans');
    expect((await pad.list(agent.id, 'archive/plans')).files.map(file => file.name)).toEqual(['plan-v1.md', 'plan.md']);
    await expect(pad.copy(agent.id, 'notes.txt', 'plans/plan.md')).rejects.toThrow('already exists');
    // Move renames folders with everything in them.
    await pad.move(agent.id, 'archive', 'old');
    expect((await pad.list(agent.id, 'old/plans')).files).toHaveLength(2);
    await expect(pad.move(agent.id, 'old', 'old/inner')).rejects.toThrow('inside itself');
    // A file and a folder cannot share a name; reading a folder says so.
    await expect(pad.write(agent.id, 'plans', 'x')).rejects.toThrow('is a folder');
    await expect(pad.write(agent.id, 'notes.txt/inner.md', 'x')).rejects.toThrow('is a file');
    await expect(pad.read(agent.id, 'plans')).rejects.toThrow('is a folder');
    // Delete a folder and all its files.
    expect(await pad.delete(agent.id, 'old')).toMatchObject({ kind: 'folder', deleted: 2 });
    await expect(pad.list(agent.id, 'old')).rejects.toThrow('no folder');
  } finally {
    await database.close();
  }
});

it('enforces the Settings → Swarm limits for file size, file count and total space', async () => {
  const { database, agent, settings, pad } = await setup();
  try {
    await settings.update({ scratchFileMaxKb: 16, scratchMaxFiles: 10, scratchTotalMb: 1 });
    await expect(pad.write(agent.id, 'big.txt', 'x'.repeat(17 * 1024))).rejects.toThrow('at most 16384 bytes');
    for (let i = 0; i < 10; i++) await pad.write(agent.id, `f${i}.txt`, 'x');
    await expect(pad.write(agent.id, 'f10.txt', 'x')).rejects.toThrow('at most 10 files');
    await pad.write(agent.id, 'f0.txt', 'replacing an existing file does not count twice');
    await expect(pad.copy(agent.id, 'f1.txt', 'copy.txt')).rejects.toThrow('at most 10 files');
    // Deleting the agent removes its scratchpad.
    await database.client.agent.delete({ where: { id: agent.id } });
    expect(await database.client.scratchFile.count()).toBe(0);
  } finally {
    await database.close();
  }
});

it('gives every agent scratch tools that return its mistakes as tool errors', async () => {
  const { database, agent, pad } = await setup();
  const { createScratchTools } = await import('./scratch-tools');
  const tools = Object.fromEntries(createScratchTools(pad, agent.id).map(tool => [tool.name, tool]));
  const call = async (name: string, params: object) => {
    const result = await tools[name].execute('call', params as never, undefined, undefined, undefined as never);
    return {
      ...JSON.parse((result.content[0] as { text: string }).text),
      isError: Boolean((result as { isError?: boolean }).isError),
    };
  };
  try {
    expect(Object.keys(tools).sort()).toEqual([
      'scratch_delete',
      'scratch_edit',
      'scratch_list',
      'scratch_move',
      'scratch_read',
      'scratch_write',
    ]);
    expect(await call('scratch_write', { path: 'a/b/c/d/e.md', content: 'x' })).toMatchObject({ isError: true });
    expect(await call('scratch_write', { path: 'demo/page.md', content: 'one\ntwo\n' })).toMatchObject({
      created: true,
      isError: false,
    });
    expect(await call('scratch_read', { path: 'demo/page.md', offset: 2 })).toMatchObject({ text: 'two\n', lines: 1 });
    expect(
      await call('scratch_edit', { path: 'demo/page.md', edits: [{ oldText: 'nope', newText: '' }] }),
    ).toMatchObject({
      isError: true,
    });
    expect(await call('scratch_list', {})).toMatchObject({ folders: [{ name: 'demo' }] });
    // An image comes back as an image for a vision model; a text-only model is told it cannot see it.
    await pad.writeImage(agent.id, 'shot.png', await png(), 'image/png');
    const seen = await tools.scratch_read.execute('call', { path: 'shot.png' } as never, undefined, undefined, {
      model: { input: ['text', 'image'] },
    } as never);
    expect(seen.content.map(part => part.type)).toEqual(['text', 'image']);
    expect(JSON.parse((seen.content[0] as { text: string }).text)).toMatchObject({ path: 'shot.png', kind: 'image' });
    await expect(call('scratch_read', { path: 'shot.png' })).rejects.toThrow('cannot see images');
  } finally {
    await database.close();
  }
});

it('lets the dashboard browse an agent’s scratchpad read-only', async () => {
  const { buildApp } = await import('./app');
  const { database, agent, pad } = await setup();
  const app = await buildApp({ requireLogin: false, database, computerController: null });
  try {
    await pad.write(agent.id, 'drafts/report.md', '# Report\n');
    const list = await app.inject({ method: 'GET', url: `/api/agents/${agent.id}/scratch` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ folder: '', folders: [{ name: 'drafts', files: 1 }] });
    const file = await app.inject({
      method: 'GET',
      url: `/api/agents/${agent.id}/scratch/file?path=${encodeURIComponent('drafts/report.md')}`,
    });
    expect(file.json()).toMatchObject({ text: '# Report\n', lines: 1 });
    expect(
      (await app.inject({ method: 'GET', url: `/api/agents/${agent.id}/scratch/file?path=missing.md` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/agents/nobody/scratch' })).statusCode).toBe(404);
    // An image shows as a picture, served as its own type.
    const bytes = await png();
    await pad.writeImage(agent.id, 'drafts/shot.png', bytes, 'image/png');
    expect((await app.inject(`/api/agents/${agent.id}/scratch?folder=drafts`)).json().files).toMatchObject([
      { name: 'report.md', kind: 'text' },
      { name: 'shot.png', kind: 'image' },
    ]);
    const image = await app.inject(
      `/api/agents/${agent.id}/scratch/image?path=${encodeURIComponent('drafts/shot.png')}`,
    );
    expect([image.statusCode, image.headers['content-type'], image.rawPayload.equals(bytes)]).toEqual([
      200,
      'image/png',
      true,
    ]);
    expect(
      (await app.inject(`/api/agents/${agent.id}/scratch/image?path=${encodeURIComponent('drafts/report.md')}`))
        .statusCode,
    ).toBe(400);
    // No way to change it from the dashboard.
    expect((await app.inject({ method: 'POST', url: `/api/agents/${agent.id}/scratch`, payload: {} })).statusCode).toBe(
      404,
    );
  } finally {
    await app.close();
    await database.close();
  }
});
