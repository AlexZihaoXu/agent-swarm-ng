import { beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareDatabase } from './test-database';
import { PlatformStore } from './platform-store';
import { ActivityStore, ACTIVITY_CHUNK_SIZE } from './activity-store';
import { createActivityRecorder } from './agent-activity';

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'activity-'));
});
const config = { name: 'Activity', endpointId: 'fake', model: 'test', thinkingLevel: 'off' as const };
it('persists empty streaming entries and reads empty or exhausted fragments without breaking the archive', async () => {
  const db = await prepareDatabase(join(folder, 'empty.db'));
  try {
    const agent = await db.createAgent(config),
      store = new ActivityStore(db);
    const recorder = createActivityRecorder(agent.id, agent.channels[0].id, '', () => {}, 'empty-run', store);
    recorder.record('thinking', 'Thinking', '', 'thought');
    await recorder.flush();
    expect((await store.page(agent.id)).entries[0]).toMatchObject({ text: '', totalLength: 0, nextOffset: null });
    expect(await store.fragment(agent.id, 'empty-run:thought', 0)).toMatchObject({ text: '', nextOffset: null });
    recorder.record('thinking', 'Thinking', 'continued', 'thought', true);
    await recorder.flush();
    expect((await store.page(agent.id)).entries[0].text).toBe('continued');
    expect(await store.fragment(agent.id, 'empty-run:thought', 9)).toMatchObject({ text: '', nextOffset: null });
    expect(await store.fragment(agent.id, 'empty-run:thought', 100)).toMatchObject({ text: '', nextOffset: null });
  } finally {
    await db.close();
  }
});
it('coalesces durable revisions, redacts split credentials, strips images and never publishes chat', async () => {
  const db = await prepareDatabase(join(folder, 'recorder.db'));
  try {
    const agent = await db.createAgent(config),
      store = new ActivityStore(db),
      events: any[] = [];
    const recorder = createActivityRecorder(
      agent.id,
      agent.channels[0].id,
      'secret-key',
      event => events.push(event),
      'run',
      store,
    );
    recorder.record('assistant', 'Output', 'secret-', 'output', true);
    recorder.record('assistant', 'Output', 'key and text', 'output', true);
    recorder.record('assistant', 'Output', 'secret-key and final', 'output');
    recorder.onEvent({
      type: 'tool_execution_end',
      toolName: 'screenshot',
      result: {
        content: [
          { type: 'image', data: 'BASE64_BYTES' },
          { type: 'text', text: '{"imageId":"image-1"}' },
        ],
      },
    } as any);
    await recorder.flush();
    expect(events).toHaveLength(3);
    const page = await store.page(agent.id);
    expect(page.entries[0]).toMatchObject({ text: '[redacted] and final', revision: 3 });
    expect(JSON.stringify(page)).not.toContain('BASE64_BYTES');
    expect(JSON.stringify(page)).not.toContain('secret-key');
    expect(page.entries[1].text).toContain('image-1');
    expect(await db.client.message.count()).toBe(0);
    expect(await db.client.agentSession.count()).toBe(0);
  } finally {
    await db.close();
  }
});
it('marks unfinished records interrupted without replacing their captured evidence', async () => {
  const db = await prepareDatabase(join(folder, 'partial-state.db'));
  try {
    const agent = await db.createAgent(config),
      store = new ActivityStore(db);
    const recorder = createActivityRecorder(agent.id, agent.channels[0].id, '', () => {}, 'partial-run', store);
    recorder.record('thinking', 'Thinking', 'Evidence before restart', 'thinking', false, 'streaming');
    await recorder.flush();
    await store.interruptActive();
    expect(await store.fragment(agent.id, 'partial-run:thinking', 0)).toMatchObject({
      text: 'Evidence before restart',
      state: 'interrupted',
    });
  } finally {
    await db.close();
  }
});
it('does not publish or persist a known credential prefix between streaming checkpoints', async () => {
  const db = await prepareDatabase(join(folder, 'stream-redaction.db'));
  try {
    const agent = await db.createAgent(config),
      store = new ActivityStore(db),
      events: any[] = [];
    const recorder = createActivityRecorder(
      agent.id,
      agent.channels[0].id,
      'private-key',
      event => events.push(event),
      'secret-run',
      store,
    );
    recorder.record('assistant', 'Output', 'prefix private-', 'text', false, 'streaming');
    await recorder.flush();
    expect(JSON.stringify(events)).not.toContain('private-');
    recorder.close('interrupted');
    await recorder.flush();
    expect(JSON.stringify(await store.page(agent.id))).not.toContain('private-');
    recorder.record('assistant', 'Output', 'prefix private-key suffix', 'text', false, 'complete');
    await recorder.flush();
    expect((await store.page(agent.id)).entries[0].text).toBe('prefix [redacted] suffix');
  } finally {
    await db.close();
  }
});
it('keeps complete Unicode text behind bounded indexed pages and revision-checked fragments across restart', async () => {
  const path = join(folder, 'archive.db');
  let db = await prepareDatabase(path);
  const agent = await db.createAgent(config),
    other = await db.createAgent(config);
  let store = new ActivityStore(db);
  const text = '\ufeffzz' + 'x😀'.repeat(ACTIVITY_CHUNK_SIZE) + '\u0000tail';
  const entry = {
    id: 'long',
    runId: 'run',
    channelId: agent.channels[0].id,
    kind: 'thinking' as const,
    label: 'Thinking',
    timestamp: 123,
    revision: 1,
    text,
  };
  await store.save(agent.id, entry);
  for (let i = 0; i < 33; i++) await store.save(agent.id, { ...entry, id: `entry-${i}`, text: String(i) });
  await store.save(other.id, { ...entry, id: 'foreign' });
  const latest = await store.page(agent.id);
  expect(latest.entries).toHaveLength(30);
  const older = await store.page(agent.id, latest.nextCursor!);
  expect(older.entries).toHaveLength(4);
  expect(Buffer.byteLength(older.entries[0].text)).toBeLessThanOrEqual(ACTIVITY_CHUNK_SIZE);
  let restored = older.entries[0].text,
    offset = older.entries[0].nextOffset;
  while (offset != null) {
    const rest = await store.fragment(agent.id, 'long', offset, 1);
    if (!rest || rest === 'changed') throw new Error('Missing fragment');
    expect(Buffer.byteLength(rest.text)).toBeLessThanOrEqual(ACTIVITY_CHUNK_SIZE);
    restored += rest.text;
    offset = rest.nextOffset;
  }
  expect(restored).toBe(text);
  expect(await store.fragment(other.id, 'long', 0, 1)).toBeNull();
  await store.save(agent.id, { ...entry, revision: 2, text: 'replacement' });
  expect(await store.fragment(agent.id, 'long', 0, 1)).toBe('changed');
  await store.save(agent.id, entry); // stale write must not overwrite a newer revision
  const plan = await db.client.$queryRawUnsafe<{ detail: string }[]>(
    'EXPLAIN QUERY PLAN SELECT sequence FROM Activity WHERE agentId = ? AND sequence < ? ORDER BY sequence DESC LIMIT 30',
    agent.id,
    1000,
  );
  expect(plan.map(row => row.detail).join(' ')).toContain('Activity_agentId_sequence_idx');
  await db.close();
  db = new PlatformStore(pathToFileURL(path).href);
  store = new ActivityStore(db);
  try {
    expect(await store.fragment(agent.id, 'long', 0, 2)).toMatchObject({ text: 'replacement' });
    await db.deleteAgent(agent.id, agent.name);
    expect((await store.page(agent.id)).entries).toEqual([]);
    expect((await store.page(other.id)).entries).toHaveLength(1);
  } finally {
    await db.close();
  }
});
it('restores latest context outside the page and marks only active runs interrupted without replay', async () => {
  const db = await prepareDatabase(join(folder, 'interrupted.db'));
  try {
    const agent = await db.createAgent(config),
      store = new ActivityStore(db);
    const recorder = createActivityRecorder(agent.id, agent.channels[0].id, '', () => {}, 'run', store);
    await recorder.start();
    recorder.record('status', 'Context usage', '12 / 100 tokens', 'context-usage');
    for (let i = 0; i < 35; i++) recorder.record('tool_result', 'Result', `${i}`);
    await recorder.flush();
    expect((await store.page(agent.id)).contextUsage?.text).toBe('12 / 100 tokens');
    await store.interruptActive();
    expect(await store.fragment(agent.id, 'run:run-status', 0, 2)).toMatchObject({
      label: 'Run interrupted',
      text: expect.stringContaining('not resumed'),
    });
    await store.interruptActive();
    expect(await db.client.activity.count()).toBe(38);
  } finally {
    await db.close();
  }
});
it('checkpoints an active stream on its timer and flushes the final replacement without replay', async () => {
  const db = await prepareDatabase(join(folder, 'stream.db'));
  try {
    const agent = await db.createAgent(config),
      store = new ActivityStore(db),
      events: any[] = [];
    const recorder = createActivityRecorder(
      agent.id,
      agent.channels[0].id,
      '',
      event => events.push(event),
      'run',
      store,
    );
    await recorder.start();
    recorder.record('thinking', 'Thinking', 'partial', 'thought', true);
    await vi.waitFor(() => expect(events.some(event => event.entry.text === 'partial')).toBe(true));
    expect(await store.fragment(agent.id, 'run:thought', 0, 1)).toMatchObject({ text: 'partial' });
    recorder.record('thinking', 'Thinking', ' continued', 'thought', true);
    recorder.record('thinking', 'Thinking', 'final replacement', 'thought');
    await recorder.finish();
    expect(await store.fragment(agent.id, 'run:thought', 0, 3)).toMatchObject({ text: 'final replacement' });
    await store.interruptActive();
    expect(await store.fragment(agent.id, 'run:run-status', 0, 2)).toMatchObject({ label: 'Run ended' });
    expect(events.filter(event => event.entry.id === 'run:thought')).toHaveLength(2);
  } finally {
    await db.close();
  }
});
it('does not emit unsaved activity or leak raw persistence errors when checkpointing fails', async () => {
  const store = { save: vi.fn().mockRejectedValue(new Error('SECRET storage details')) } as unknown as ActivityStore;
  const emit = vi.fn(),
    failed = vi.fn();
  const recorder = createActivityRecorder('agent', 'channel', '', emit, 'run', store, failed);
  recorder.record('assistant', 'Output', 'not committed');
  await expect(recorder.flush()).rejects.toThrow('Operator activity could not be saved.');
  expect(emit).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledOnce();
});

it('prunes old activity, keeps unfinished runs and the newest context reading, and marks the gap once', async () => {
  const db = await prepareDatabase(join(folder, 'prune.db'));
  try {
    const first = await db.createAgent(config),
      second = await db.createAgent({ ...config, name: 'Other' }),
      store = new ActivityStore(db);
    const day = 86_400_000,
      now = Date.now();
    const save = (
      agentId: string,
      id: string,
      ageDays: number,
      extra: Partial<{ label: string; state: string }> = {},
    ) =>
      store.save(agentId, {
        id,
        runId: 'r',
        channelId: 'c',
        kind: 'status',
        label: extra.label ?? 'Event',
        text: id,
        timestamp: now - ageDays * day,
        revision: 1,
        state: extra.state ?? 'complete',
      } as any);
    await save(first.id, 'old-a', 45);
    await save(first.id, 'old-b', 40);
    await save(first.id, 'old-active', 50, { state: 'active' });
    await save(first.id, 'old-context', 44, { label: 'Context usage' });
    await save(first.id, 'newest-context', 41, { label: 'Context usage' });
    await save(first.id, 'recent', 2);
    await save(second.id, 'other-recent', 1);
    expect(await store.prune(0)).toBe(0); // disabled
    expect(await store.prune(30, now)).toBe(3); // old-a, old-b, old-context
    let ids = (await store.page(first.id)).entries.map(entry => entry.id);
    expect(ids).toEqual(['retention:' + first.id, 'old-active', 'newest-context', 'recent']); // marker sorts first; sequence order otherwise
    expect((await store.page(first.id)).entries[0]).toMatchObject({
      label: 'History pruned',
      text: expect.stringContaining('older than 30 days'),
    });
    expect((await store.page(second.id)).entries.map(entry => entry.id)).toEqual(['other-recent']); // untouched agent has no marker
    expect((await store.page(first.id)).contextUsage?.id).toBe('newest-context');
    await save(first.id, 'old-c', 35);
    expect(await store.prune(30, now)).toBe(1);
    ids = (await store.page(first.id)).entries.map(entry => entry.id);
    expect(ids.filter(id => id.startsWith('retention:'))).toHaveLength(1); // replaced, not duplicated
    expect(await store.prune(30, now)).toBe(0);
  } finally {
    await db.close();
  }
});
