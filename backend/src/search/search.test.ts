import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { buildApp } from '../app';
import { EndpointStore } from '../endpoint-store';
import { prepareDatabase } from '../test-database';
import { SESSION_COOKIE } from '../auth/sessions';
import { PlatformStore } from '../platform-store';
import { dayStart, ftsQuery, snippetOf } from './store';

const PASSWORD = 'correct horse battery';

async function fixture() {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  const database = await prepareDatabase(`${root}.db`);
  const app = await buildApp({
    database,
    endpointStore: new EndpointStore(`${root}-endpoints.json`),
    computerController: null,
    requireLogin: true,
  });
  const call = (url: string, cookie: string) =>
    app.inject({ method: 'GET', url, headers: { host: '127.0.0.1:19090', cookie } });
  const login = async (method: 'setup' | 'login', name: string) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/auth/${method}`,
      headers: { host: '127.0.0.1:19090' },
      payload: { name, password: PASSWORD },
    });
    return `${SESSION_COOKIE}=${response.cookies.find(found => found.name === SESSION_COOKIE)!.value}`;
  };
  const admin = await login('setup', 'Admin');
  const created = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { host: '127.0.0.1:19090', cookie: admin },
    payload: { name: 'Sam', password: PASSWORD },
  });
  const samOrg = (created.json() as { organizations: { id: string }[] }).organizations[0]!.id;
  const sam = await login('login', 'Sam');
  const agent = (name: string, organizationId: string) =>
    database.createAgent({ name, endpointId: 'mine', model: 'test', thinkingLevel: 'off', organizationId });
  const chain = async () =>
    (await database.client.dmChain.create({ data: { id: crypto.randomUUID(), origin: 'human' } })).id;
  const groupMessage = async (groupId: string, text: string, author?: { id: string; name: string }) =>
    database.client.groupMessage.create({
      data: {
        groupId,
        role: author ? 'assistant' : 'user',
        authorId: author?.id,
        authorName: author?.name ?? 'Sam',
        text,
        chainId: await chain(),
        submissionKey: crypto.randomUUID(),
      },
    });
  const dm = async (senderId: string, recipientId: string, text: string) =>
    database.client.dmMessage.create({
      data: {
        conversationId: `dm:${[senderId, recipientId].sort().join(':')}`,
        senderId,
        recipientId,
        text,
        chainId: await chain(),
        deliveryKey: crypto.randomUUID(),
      },
    });
  return { app, database, call, admin, sam, samOrg, agent, groupMessage, dm };
}
type Body = {
  total: number;
  more: boolean;
  results: {
    id: string;
    kind: string;
    conversation: { key: string; name: string };
    author: { kind: string; name: string | null };
    snippet: { text: string; ranges: { start: number; end: number }[]; clippedStart: boolean; clippedEnd: boolean };
    files: { name: string }[];
  }[];
};

describe('message search', { timeout: 120_000 }, () => {
  it('builds safe FTS queries, snippets and day bounds', () => {
    // Substrings in any language: 3+ characters use the trigram index, shorter terms LIKE.
    expect(ftsQuery('deplo fix')).toEqual({ terms: ['deplo', 'fix'], match: '"deplo" "fix"', likes: [] });
    expect(ftsQuery('"exact phrase" NEAR(a b) OR')).toEqual({
      terms: ['exact phrase', 'NEAR(a', 'b)', 'OR'],
      match: '"exact phrase" "NEAR(a"',
      likes: ['b)', 'OR'],
    });
    expect(ftsQuery('长老 amd')).toEqual({ terms: ['长老', 'amd'], match: '"amd"', likes: ['长老'] });
    expect(ftsQuery('!!! ...')).toBeNull();
    expect(snippetOf('a Match b', ['match'])).toEqual({
      text: 'a Match b',
      ranges: [{ start: 2, end: 7 }],
      clippedStart: false,
      clippedEnd: false,
    });
    expect(snippetOf('我要换amd了', ['amd', '换']).ranges).toEqual([{ start: 2, end: 6 }]);
    const long = snippetOf(`${'word '.repeat(200)}needle${' tail'.repeat(100)}`, ['needle']);
    expect(long.clippedStart && long.clippedEnd).toBe(true);
    expect(long.text.slice(long.ranges[0]!.start, long.ranges[0]!.end)).toBe('needle');
    expect(dayStart('2026-10-05', 'America/Toronto').toISOString()).toBe('2026-10-05T04:00:00.000Z');
    expect(dayStart('2026-01-05', 'America/Toronto').toISOString()).toBe('2026-01-05T05:00:00.000Z');
    expect(dayStart('2026-10-05', 'UTC').toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('finds only what the person may read, across chats, groups and agent DMs', async () => {
    const { app, database, call, admin, sam, samOrg, agent, groupMessage, dm } = await fixture();
    try {
      const ada = await agent('Ada', 'personal');
      const bo = await agent('Bo', samOrg);
      const cy = await agent('Cy', samOrg);
      await database.appendMessage(ada.channels[0].id, 'user', 'admin secret launch plan');
      await database.appendMessage(bo.channels[0].id, 'user', 'Sam asks about the launch', undefined, undefined, {
        userId: 'x',
        name: 'Sam',
      });
      await database.appendMessage(bo.channels[0].id, 'assistant', 'Bo answers: launch on Friday');
      const group = await database.client.groupChat.create({ data: { name: 'Crew', organizationId: samOrg } });
      await groupMessage(group.id, 'Cy says the launch is ready', { id: cy.id, name: 'Cy' });
      await dm(bo.id, cy.id, 'private launch checklist between agents');
      // A DM with an agent of another owner's organization (from before a move) is not Sam's.
      await dm(bo.id, ada.id, 'cross organization launch note');

      const samAll = (await call('/api/search/messages?q=launch', sam)).json() as Body;
      expect(samAll.results.map(result => result.snippet.text).sort()).toEqual([
        'Bo answers: launch on Friday',
        'Cy says the launch is ready',
        'Sam asks about the launch',
        'private launch checklist between agents',
      ]);
      expect(samAll.total).toBe(4);
      const adminAll = (await call('/api/search/messages?q=launch', admin)).json() as Body;
      expect(adminAll.total).toBe(6);
      // The current organization only.
      expect(((await call(`/api/search/messages?q=launch&organizationId=personal`, admin)).json() as Body).total).toBe(
        1,
      );

      // Another person's conversations and organizations are as if they did not exist.
      for (const url of [
        `/api/search/messages?q=launch&conversation=chat:${ada.channels[0].id}`,
        `/api/search/messages?q=launch&organizationId=personal`,
        `/api/search/messages?q=launch&conversation=dm:${[ada.id, bo.id].sort().join(':')}`,
        '/api/search/messages?q=launch&conversation=chat:missing',
      ])
        expect((await call(url, sam)).statusCode, url).toBe(404);

      // One conversation.
      const inChat = (
        await call(`/api/search/messages?q=launch&conversation=chat:${bo.channels[0].id}`, sam)
      ).json() as Body;
      expect(inChat.results.map(result => result.author)).toEqual([
        expect.objectContaining({ kind: 'agent', name: 'Bo' }),
        expect.objectContaining({ kind: 'human', name: 'Sam' }),
      ]);
      const inGroup = (await call(`/api/search/messages?q=ready&conversation=group:${group.id}`, sam)).json() as Body;
      expect(inGroup.results).toMatchObject([{ kind: 'group', conversation: { name: 'Crew' } }]);
      const inDm = (
        await call(`/api/search/messages?q=check&conversation=dm:${[bo.id, cy.id].sort().join(':')}`, sam)
      ).json() as Body;
      expect(inDm.results).toMatchObject([{ kind: 'dm', conversation: { name: 'Bo and Cy' } }]);
      // Exactly what was typed is highlighted ("check" inside "checklist"), as the index matches substrings.
      expect(inDm.results[0]!.snippet).toMatchObject({ ranges: [{ start: 15, end: 20 }] });

      // Nothing to search for.
      expect((await call('/api/search/messages', sam)).statusCode).toBe(400);
      expect(app.unruledRoutes).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('filters by author, attachments, links and days, sorts and pages', async () => {
    const { app, database, call, admin, agent, groupMessage } = await fixture();
    try {
      const ada = await agent('Ada', 'personal');
      const channel = ada.channels[0].id;
      const at = (text: string, iso: string, role: 'user' | 'assistant' = 'user') =>
        database.client.message.create({ data: { channelId: channel, role, text, createdAt: new Date(iso) } });
      await at('note one see https://example.com', '2026-10-01T12:00:00Z');
      await at('note two', '2026-10-02T12:00:00Z', 'assistant');
      const withImage = await at('note three', '2026-10-03T12:00:00Z');
      const withFile = await at('note four', '2026-10-04T12:00:00Z');
      const file = (messageId: string, kind: string, status = 'available') =>
        database.client.channelFile.create({
          data: {
            channelKey: `chat:${channel}`,
            messageKind: 'chat',
            messageId,
            uploaderKind: 'human',
            uploaderName: 'You',
            name: `${kind}.bin`,
            mime: 'application/octet-stream',
            kind,
            size: 1,
            status,
          },
        });
      await file(withImage.id, 'image');
      await file(withFile.id, 'other');
      await file(withFile.id, 'image', 'deleted'); // a tombstone counts for nothing
      const search = async (query: string) =>
        ((await call(`/api/search/messages?${query}`, admin)).json() as Body).results.map(
          result => result.snippet.text,
        );
      expect(await search('q=note&from=you')).toEqual(['note four', 'note three', 'note one see https://example.com']);
      expect(await search(`q=note&from=agent:${ada.id}`)).toEqual(['note two']);
      expect(await search('has=file')).toEqual(['note four', 'note three']);
      expect(await search('has=image')).toEqual(['note three']);
      expect((await call('/api/search/messages?has=file', admin)).json().results[0].files).toEqual([
        expect.objectContaining({ name: 'other.bin' }),
      ]);
      // has:link alone (no 3+ character term) would read every message: one conversation only, not all chats.
      expect((await call('/api/search/messages?has=link', admin)).statusCode).toBe(400);
      expect(await search('q=see&has=link')).toEqual(['note one see https://example.com']);
      // Days are the admin's time zone (UTC until set): during, after (the following days), before.
      expect(await search('q=note&during=2026-10-02')).toEqual(['note two']);
      expect(await search('q=note&after=2026-10-02')).toEqual(['note four', 'note three']);
      expect(await search('q=note&before=2026-10-02')).toEqual(['note one see https://example.com']);
      expect(await search('q=note&after=2026-10-01&before=2026-10-04')).toEqual(['note three', 'note two']);
      await database.client.user.update({ where: { id: 'admin' }, data: { timeZone: 'Pacific/Kiritimati' } }); // UTC+14
      expect(await search('q=note&during=2026-10-03')).toEqual(['note two']);
      expect(await search('q=note&sort=oldest')).toEqual([
        'note one see https://example.com',
        'note two',
        'note three',
        'note four',
      ]);

      // Paging: 25 a page, newest first, across chats and groups; the count stops at 1000.
      const group = await database.client.groupChat.create({ data: { name: 'Many' } });
      for (let index = 0; index < 30; index++) await groupMessage(group.id, `bulk ${index}`);
      const first = (await call('/api/search/messages?q=bulk', admin)).json() as Body;
      expect(first).toMatchObject({ total: 30, more: false });
      expect(first.results).toHaveLength(25);
      const second = (await call('/api/search/messages?q=bulk&page=2', admin)).json() as Body;
      expect(second.results.map(result => result.snippet.text)).toEqual([
        'bulk 4',
        'bulk 3',
        'bulk 2',
        'bulk 1',
        'bulk 0',
      ]);
      await database.client.message.createMany({
        data: Array.from({ length: 1001 }, (_, index) => ({
          channelId: channel,
          role: 'user' as const,
          text: `many ${index}`,
        })),
      });
      expect((await call('/api/search/messages?q=many', admin)).json()).toMatchObject({ total: 1000, more: true });
      expect((await call('/api/search/messages?q=many&page=41', admin)).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('keeps the index in step with inserts, edits and deletes, and indexes older messages', async () => {
    const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
    const url = pathToFileURL(`${root}.db`).href;
    // Messages saved before the search migration are indexed by it.
    const client = createClient({ url });
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
    const names = (await readdir(migrations)).filter(name => name !== 'migration_lock.toml').sort();
    const search = names.indexOf('20261005030000_message_search');
    for (const name of names.slice(0, search))
      await client.executeMultiple(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
    await client.executeMultiple(`
      INSERT INTO "Agent" ("id", "name", "endpointId", "model", "thinkingLevel") VALUES ('old', 'Old', 'e', 'm', 'off');
      INSERT INTO "Channel" ("id", "agentId") VALUES ('old-channel', 'old');
      INSERT INTO "Message" ("id", "channelId", "role", "text", "createdAt") VALUES ('m1', 'old-channel', 'user', 'archived zebra', '2026-01-01T00:00:00.000Z');`);
    for (const name of names.slice(search))
      await client.executeMultiple(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
    client.close();
    const database = new PlatformStore(url);
    await database.initialize();
    const app = await buildApp({
      database,
      endpointStore: new EndpointStore(`${root}-endpoints.json`),
      computerController: null,
      requireLogin: false,
    });
    try {
      const found = async (q: string) =>
        (
          (await app.inject({ method: 'GET', url: `/api/search/messages?q=${encodeURIComponent(q)}` })).json() as Body
        ).results.map(result => result.id);
      expect(await found('zebra')).toEqual(['m1']);
      const added = await database.appendMessage('old-channel', 'assistant', 'fresh giraffe');
      expect(await found('giraffe')).toEqual([added.id]);
      await database.client.message.update({ where: { id: added.id }, data: { text: 'edited okapi' } });
      expect(await found('giraffe')).toEqual([]);
      expect(await found('okapi')).toEqual([added.id]);
      await database.client.message.delete({ where: { id: added.id } });
      expect(await found('okapi')).toEqual([]);
      // Any language, inside words: "amd" (index) and "换" (too short for it) both find "我要换amd了".
      const chinese = await database.appendMessage('old-channel', 'assistant', '我要换amd了希望不会后悔');
      expect(await found('amd')).toEqual([chinese.id]);
      // Too short for the index across all chats; within one conversation it is matched with LIKE.
      expect(
        (await app.inject({ method: 'GET', url: `/api/search/messages?q=${encodeURIComponent('换')}` })).json().message,
      ).toBe('To search all chats, type at least 3 characters.');
      const inChat = async (q: string) =>
        (
          (
            await app.inject({
              method: 'GET',
              url: `/api/search/messages?q=${encodeURIComponent(q)}&conversation=chat:old-channel`,
            })
          ).json() as Body
        ).results.map(result => result.id);
      expect(await inChat('换')).toEqual([chinese.id]);
      expect(await found('后悔 amd')).toEqual([chinese.id]);
      expect(await found('后悔 intel')).toEqual([]);
      // LIKE wildcards in a term are literal.
      expect(await inChat('%')).toEqual([]);
      // NUL and other control characters are dropped, never a server error.
      expect(await found('amd\u0000x')).toEqual([]);
      // Group messages too, and deleting a group takes its messages out of the index.
      const group = await database.client.groupChat.create({ data: { name: 'Herd' } });
      const chain = await database.client.dmChain.create({ data: { id: crypto.randomUUID(), origin: 'human' } });
      const post = await database.client.groupMessage.create({
        data: {
          groupId: group.id,
          role: 'user',
          authorName: 'You',
          text: 'group gazelle',
          chainId: chain.id,
          submissionKey: 'k',
        },
      });
      expect(await found('gazelle')).toEqual([post.id]);
      await database.client.groupChat.delete({ where: { id: group.id } });
      expect(await found('gazelle')).toEqual([]);
      // Deleting the agent cascades to its messages, and to their index entries.
      await database.client.agent.delete({ where: { id: 'old' } });
      expect(await found('zebra')).toEqual([]);
      // FTS5's own check of the index against the messages (it throws on a mismatch).
      for (const table of ['MessageSearch', 'GroupMessageSearch', 'DmMessageSearch'])
        await database.client.$executeRawUnsafe(
          `INSERT INTO "${table}"("${table}", rank) VALUES ('integrity-check', 1)`,
        );
    } finally {
      await app.close();
    }
  });

  it('loads history reaching back to a message, in every kind of conversation', async () => {
    const { app, database, call, admin, sam, samOrg, agent, groupMessage, dm } = await fixture();
    try {
      const bo = await agent('Bo', samOrg);
      const cy = await agent('Cy', samOrg);
      const ada = await agent('Ada', 'personal');
      const channel = bo.channels[0].id;
      const messages = [];
      for (let index = 0; index < 260; index++)
        messages.push(await database.appendMessage(channel, 'user', `message ${index}`));
      const target = messages[30]!;
      const page = (await call(`/api/channels/${channel}/messages?around=${target.id}`, sam)).json() as {
        messages: { id: string; sequence: number }[];
        nextCursor: number | null;
      };
      // 200 newest of "10 before the target … latest": the target is not reached yet; asking again reaches it.
      expect(page.messages).toHaveLength(200);
      expect(page.messages.at(-1)!.id).toBe(messages[259]!.id);
      const again = (
        await call(`/api/channels/${channel}/messages?around=${target.id}&before=${page.nextCursor}`, sam)
      ).json() as { messages: { id: string }[]; nextCursor: number | null };
      expect(again.messages[0]!.id).toBe(messages[20]!.id);
      expect(again.messages.some(message => message.id === target.id)).toBe(true);
      expect(again.nextCursor).toBe(messages[20]!.sequence);
      // A message of another conversation, or another person's chat, is refused.
      expect((await call(`/api/channels/${channel}/messages?around=missing`, sam)).statusCode).toBe(404);
      expect((await call(`/api/channels/${ada.channels[0].id}/messages?around=${target.id}`, admin)).statusCode).toBe(
        404,
      );

      const group = await database.client.groupChat.create({ data: { name: 'Crew', organizationId: samOrg } });
      const posts = [];
      for (let index = 0; index < 15; index++) posts.push(await groupMessage(group.id, `post ${index}`));
      const groupPage = (await call(`/api/groups/${group.id}/messages?around=${posts[12]!.id}`, sam)).json();
      expect(groupPage.messages.map((message: { text: string }) => message.text)).toEqual(
        posts.slice(2).map(post => post.text),
      );
      expect(groupPage.nextCursor).toBe(posts[2]!.sequence);
      expect((await call(`/api/groups/${group.id}/messages?around=${target.id}`, sam)).statusCode).toBe(404);

      const notes = [];
      for (let index = 0; index < 3; index++) notes.push(await dm(bo.id, cy.id, `note ${index}`));
      const dmPage = (await call(`/api/agents/${bo.id}/dms/${cy.id}?around=${notes[1]!.id}`, sam)).json();
      expect(dmPage.messages.map((message: { text: string }) => message.text)).toEqual(['note 0', 'note 1', 'note 2']);
      expect(dmPage.nextCursor).toBeNull();
      expect((await call(`/api/agents/${bo.id}/dms/${cy.id}?around=${posts[0]!.id}`, sam)).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
