import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { buildApp } from '../app';
import { chatKey, dmKey, groupKey } from './access';
import { fileLines } from '../chat-runtime';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
async function setup() {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  const database = await prepareDatabase(join(root, 'platform.db'));
  const app = await buildApp({ requireLogin: false, database, computerController: null });
  const agent = await database.createAgent({ name: 'Aether', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
  const upload = (channelKey: string, name: string, payload: Buffer | string) =>
    app.inject({
      method: 'POST',
      url: `/api/files?channelKey=${encodeURIComponent(channelKey)}&name=${encodeURIComponent(name)}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload,
    });
  return { root, database, app, agent, upload };
}

it('uploads any file as a raw stream, serves images inline and everything else as a download, and previews text', async () => {
  const { database, app, agent, upload } = await setup();
  try {
    const key = chatKey(agent.channels[0].id);
    const image = await upload(key, 'shot.png', png);
    expect(image.statusCode).toBe(201);
    expect(image.json()).toMatchObject({ name: 'shot.png', kind: 'image', mime: 'image/png', size: png.length });
    const inline = await app.inject(`/api/files/${image.json().id}/content`);
    expect(inline.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    expect(inline.headers['content-disposition']).toMatch(/^inline;/);
    expect(inline.rawPayload).toEqual(png);
    // Bytes never change, but a file can be deleted: browsers revalidate and get 304 while it exists.
    expect(inline.headers['cache-control']).toBe('private, no-cache');
    const again = await app.inject({
      url: `/api/files/${image.json().id}/content`,
      headers: { 'if-none-match': String(inline.headers.etag) },
    });
    expect(again.statusCode).toBe(304);
    const forced = await app.inject(`/api/files/${image.json().id}/content?download=1`);
    expect(forced.headers['content-disposition']).toMatch(/^attachment;/);

    // HTML is text: previewed as source and downloaded, never rendered here (only by the sandboxed view route).
    const page = await upload(key, 'page.html', '<script>alert(1)</script>\nline 2\n');
    expect(page.json()).toMatchObject({ kind: 'text' });
    const html = await app.inject(`/api/files/${page.json().id}/content`);
    expect(html.headers['content-type']).toBe('application/octet-stream');
    expect(html.headers['content-disposition']).toMatch(/^attachment;/);
    const preview = await app.inject(`/api/files/${page.json().id}/text?limit=1`);
    expect(preview.json()).toMatchObject({
      text: '<script>alert(1)</script>\n',
      totalLines: 2,
      nextOffset: 2,
      previewLimited: false,
    });
    expect((await app.inject(`/api/files/${image.json().id}/text`)).statusCode).toBe(400);

    // Unknown channels and files are not found; the human never posts into an agent-to-agent DM.
    expect((await upload('chat:missing', 'a.txt', 'a')).statusCode).toBe(404);
    const other = await database.createAgent({ name: 'Bram', endpointId: 'mock', model: 'm', thinkingLevel: 'off' });
    expect((await upload(dmKey(agent.id, other.id), 'a.txt', 'a')).statusCode).toBe(403);
    expect((await app.inject('/api/files/nope/content')).statusCode).toBe(404);
  } finally {
    await app.close();
    await database.close();
  }
});

it('renders HTML files only through the sandboxed view route, within its size cap', async () => {
  const { database, app, agent, upload } = await setup();
  try {
    const key = chatKey(agent.channels[0].id);
    const source = '<!doctype html><p id="x">hi</p><script>x.textContent = "ran"</script>';
    const page = (await upload(key, 'Report.HTM', source)).json();
    const viewed = await app.inject(`/api/files/${page.id}/view`);
    // Only as the viewer's frame: opened as a page (a link to it) it is refused.
    const asPage = await app.inject({ url: `/api/files/${page.id}/view`, headers: { 'sec-fetch-dest': 'document' } });
    expect(asPage.statusCode).toBe(400);
    expect(
      (await app.inject({ url: `/api/files/${page.id}/view`, headers: { 'sec-fetch-dest': 'iframe' } })).statusCode,
    ).toBe(200);
    expect(viewed.statusCode).toBe(200);
    expect(viewed.body).toBe(source);
    expect(viewed.headers).toMatchObject({
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; " +
        "style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; " +
        "connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    });
    expect(viewed.headers['content-disposition']).toMatch(/^inline;/);
    // Its download stays an attachment, never rendered.
    expect((await app.inject(`/api/files/${page.id}/content`)).headers['content-type']).toBe(
      'application/octet-stream',
    );

    // Only HTML: other text, SVG and images are refused; unknown and deleted files are not served.
    for (const [name, payload] of [
      ['notes.txt', '<script>1</script>'],
      ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
      ['shot.html.png', png],
      ['page.html.bin', Buffer.from([0, 1, 2])],
    ] as const) {
      const other = (await upload(key, name, payload)).json();
      expect((await app.inject(`/api/files/${other.id}/view`)).statusCode, name).toBe(400);
    }
    expect((await app.inject('/api/files/nope/view')).statusCode).toBe(404);
    await app.inject({ method: 'DELETE', url: `/api/files/${page.id}` });
    expect((await app.inject(`/api/files/${page.id}/view`)).statusCode).toBe(410);

    // Over 10 MB it downloads instead.
    const big = (await upload(key, 'big.html', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'))).json();
    expect((await app.inject(`/api/files/${big.id}/view`)).statusCode).toBe(413);

    // A live scratch preview of an HTML file renders as it is now.
    await database.client.scratchFile.create({
      data: { agentId: agent.id, path: 'site/index.html', content: '<b>live</b>', size: 11 },
    });
    const live = await database.client.channelFile.create({
      data: {
        channelKey: key,
        uploaderKind: 'agent',
        uploaderId: agent.id,
        uploaderName: 'Aether',
        name: 'index.html',
        mime: 'text/plain',
        kind: 'scratch',
        size: 11,
        scratchAgentId: agent.id,
        scratchPath: 'site/index.html',
      },
    });
    const scratchView = await app.inject(`/api/files/${live.id}/view`);
    expect([scratchView.statusCode, scratchView.body, scratchView.headers['content-security-policy']]).toEqual([
      200,
      '<b>live</b>',
      viewed.headers['content-security-policy'],
    ]);
  } finally {
    await app.close();
    await database.close();
  }
});

it('serves videos inline in byte ranges so players can seek', async () => {
  const { database, app, agent, upload } = await setup();
  try {
    const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(88, 7)]);
    const posted = await upload(chatKey(agent.channels[0].id), 'clip.mp4', video);
    expect(posted.json()).toMatchObject({ kind: 'video', mime: 'video/mp4', size: 100 });
    const url = `/api/files/${posted.json().id}/content`;
    const whole = await app.inject(url);
    expect([whole.statusCode, whole.headers['content-type'], whole.headers['accept-ranges']]).toEqual([
      200,
      'video/mp4',
      'bytes',
    ]);
    expect(whole.headers['content-disposition']).toMatch(/^inline;/);
    const part = await app.inject({ url, headers: { range: 'bytes=4-11' } });
    expect([part.statusCode, part.headers['content-range'], part.headers['content-length']]).toEqual([
      206,
      'bytes 4-11/100',
      '8',
    ]);
    expect(part.body).toBe('ftypisom');
    const tail = await app.inject({ url, headers: { range: 'bytes=-10' } });
    expect([tail.headers['content-range'], tail.rawPayload.length]).toEqual(['bytes 90-99/100', 10]);
    const open = await app.inject({ url, headers: { range: 'bytes=95-' } });
    expect(open.headers['content-range']).toBe('bytes 95-99/100');
    const outside = await app.inject({ url, headers: { range: 'bytes=200-' } });
    expect([outside.statusCode, outside.headers['content-range']]).toEqual([416, 'bytes */100']);
    // A range for an older version (If-Range mismatch) or a malformed one gets the whole file.
    const stale = await app.inject({ url, headers: { range: 'bytes=0-1', 'if-range': '"old"' } });
    expect([stale.statusCode, stale.rawPayload.length]).toEqual([200, 100]);
    expect((await app.inject({ url, headers: { range: 'bytes=1-2,5-6' } })).statusCode).toBe(200);
  } finally {
    await app.close();
    await database.close();
  }
});

it('refuses uploads over the per-file limit or the storage budget without leaving partial files', async () => {
  const { root, database, app, agent, upload } = await setup();
  try {
    const key = chatKey(agent.channels[0].id);
    await app.inject({ method: 'PATCH', url: '/api/settings/swarm', payload: { uploadMaxMb: 1 } });
    const big = await upload(key, 'big.bin', Buffer.alloc(1024 * 1024 + 1));
    expect(big.statusCode).toBe(413);
    expect(await readdir(join(root, 'files', 'tmp'))).toEqual([]);
    // A budget already used up refuses the next upload.
    await database.client.fileBlob.create({
      data: { id: 'f'.repeat(64), size: 11 * 1024 ** 3, storage: 'local', location: 'x' },
    });
    const full = await upload(key, 'a.txt', 'a');
    expect(full.statusCode).toBe(507);
    const listing = await app.inject(`/api/files?channelKey=${key}`);
    expect(listing.json().usage).toMatchObject({ full: true, warning: true });
  } finally {
    await app.close();
    await database.close();
  }
});

it('attaches files to group messages, lists and deletes them with a tombstone, and deletes them with the group', async () => {
  const { database, app, upload } = await setup();
  try {
    const group = await database.client.groupChat.create({ data: { name: 'Team' } });
    const key = groupKey(group.id);
    const first = (await upload(key, 'notes.md', '# Notes\n')).json();
    const second = (await upload(key, 'shot.png', png)).json();
    const payload = { message: '', clientMessageId: crypto.randomUUID(), fileIds: [first.id, second.id] };
    const posted = await app.inject({ method: 'POST', url: `/api/groups/${group.id}/messages`, payload });
    expect(posted.statusCode).toBe(202);
    // A retry after a lost response returns the same message instead of refusing its files.
    const retried = await app.inject({ method: 'POST', url: `/api/groups/${group.id}/messages`, payload });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toMatchObject({ duplicate: true, message: { id: posted.json().message.id } });
    expect(posted.json().message.files.map((file: { id: string }) => file.id)).toEqual([first.id, second.id]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/groups/${group.id}/messages`,
          payload: { message: '', clientMessageId: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(400);
    const history = (await app.inject(`/api/groups/${group.id}/messages`)).json().messages;
    expect(history[0].files).toHaveLength(2);

    const listed = await app.inject(`/api/files?channelKey=${key}&sort=name&order=asc`);
    expect(listed.json()).toMatchObject({ totalBytes: 19, files: [{ name: 'notes.md' }, { name: 'shot.png' }] });
    expect((await app.inject(`/api/files?channelKey=${key}&query=shot`)).json().files).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/files/${first.id}` });
    expect(deleted.json()).toMatchObject({ status: 'deleted', name: 'notes.md', deleted: { by: { kind: 'human' } } });
    expect((await app.inject(`/api/files/${first.id}/content`)).statusCode).toBe(410);
    const after = (await app.inject(`/api/groups/${group.id}/messages`)).json().messages[0].files;
    expect(after.map((file: { status: string }) => file.status)).toEqual(['deleted', 'available']);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${group.id}`,
      payload: { confirmation: 'Team' },
    });
    expect(removed.statusCode).toBe(200);
    expect(await database.client.channelFile.count()).toBe(0);
    expect(await database.client.fileBlob.count()).toBe(0);
  } finally {
    await app.close();
    await database.close();
  }
});

it('deletes an agent’s chat and DM files with the agent', async () => {
  const { database, app, agent, upload } = await setup();
  try {
    await upload(chatKey(agent.channels[0].id), 'a.txt', 'a');
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}`,
      payload: { confirmation: 'Aether' },
    });
    expect(deleted.statusCode).toBe(200);
    expect(await database.client.channelFile.count()).toBe(0);
  } finally {
    await app.close();
    await database.close();
  }
});

it('shows agents file references, never contents, in message envelopes', () => {
  expect(fileLines([{ id: 'f1', name: 'plan.md', kind: 'text', size: 2048, status: 'available' }])).toContain(
    '"plan.md" (text, 2.0 KB, fileId f1)',
  );
  expect(fileLines([])).toBe('');
});

it('finds sent chat files and scratch files by name for Portal, never unsent or deleted ones', async () => {
  const { database, app, agent, upload } = await setup();
  try {
    const key = chatKey(agent.channels[0].id);
    const sent = (await upload(key, 'Quarterly-report.pdf', 'pdf')).json();
    await upload(key, 'report-draft.txt', 'not sent yet');
    const gone = (await upload(key, 'old-report.txt', 'x')).json();
    await database.client.channelFile.update({ where: { id: sent.id }, data: { messageId: 'm1' } });
    await database.client.channelFile.update({
      where: { id: gone.id },
      data: { messageId: 'm2', status: 'deleted' },
    });
    await database.client.scratchFile.create({
      data: { agentId: agent.id, path: 'plans/report.md', content: '# Plan', size: 6 },
    });
    const found = await app.inject('/api/files/find?q=report');
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({
      files: [{ id: sent.id, name: 'Quarterly-report.pdf', channelKey: key, kind: sent.kind, size: 3 }],
      scratch: [{ agentId: agent.id, path: 'plans/report.md', size: 6 }],
    });
    expect((await app.inject('/api/files/find?q=')).statusCode).toBe(400);
  } finally {
    await app.close();
    await database.close();
  }
});
