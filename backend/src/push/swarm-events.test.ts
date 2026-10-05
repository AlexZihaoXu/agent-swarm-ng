import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SwarmEvents, type Version } from './swarm-events';
import type { PushNotifier, SwarmEvent } from './notifier';

function setup(backend: Version, frontend: Version | undefined, folder: string) {
  const sent: { event: SwarmEvent; title: string; text: string }[] = [];
  const push = {
    swarm: async (event: SwarmEvent, title: string, text: string) => void sent.push({ event, title, text }),
  } as unknown as PushNotifier;
  const state = { frontend };
  const events = new SwarmEvents({
    push,
    dataDirectory: folder,
    backend,
    frontend: async () => state.frontend,
    log: { warn: () => {} },
  });
  return { events, sent, state };
}

describe('the Swarm’s own notifications', () => {
  it('says started the first time and after a plain restart, updated when a build changed', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'swarm-events-'));
    try {
      const first = setup({ version: 'aaa1111', summary: 'feat: one' }, { version: 'fff1111', summary: '' }, folder);
      await first.events.started();
      await first.events.stopping(50);
      // Nothing to compare with the first time: a start, not an update.
      expect(first.sent.map(item => item.event)).toEqual(['start', 'stop']);

      const restart = setup({ version: 'aaa1111', summary: 'feat: one' }, { version: 'fff1111', summary: '' }, folder);
      await restart.events.started();
      await restart.events.stopping(50);
      expect(restart.sent.map(item => item.event)).toEqual(['start', 'stop']);

      const updated = setup({ version: 'bbb2222', summary: 'feat: two' }, { version: 'fff1111', summary: '' }, folder);
      await updated.events.started();
      await updated.events.stopping(50);
      expect(updated.sent[0]).toEqual({
        event: 'update',
        title: 'Agent Swarm updated',
        text: 'Now on bbb2222: feat: two',
      });

      // A frontend-only update (the backend keeps running) is told once, when it is noticed.
      updated.state.frontend = { version: 'ggg3333', summary: 'fix: buttons' };
      await updated.events.checkFrontend();
      await updated.events.checkFrontend();
      expect(updated.sent.filter(item => item.event === 'update').map(item => item.text)).toEqual([
        'Now on bbb2222: feat: two',
        'Now on ggg3333: fix: buttons',
      ]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('never calls an unversioned (dev) build an update', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'swarm-events-'));
    try {
      await setup({ version: 'dev', summary: '' }, undefined, folder).events.started();
      const again = setup({ version: 'dev', summary: '' }, undefined, folder);
      await again.events.started();
      await again.events.stopping(50);
      expect(again.sent.map(item => item.event)).toEqual(['start', 'stop']);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('does not hold up a stop for a slow push service', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'swarm-events-'));
    try {
      const push = { swarm: () => new Promise(() => {}) } as unknown as PushNotifier;
      const events = new SwarmEvents({
        push,
        dataDirectory: folder,
        backend: { version: 'dev', summary: '' },
        frontend: async () => undefined,
        log: { warn: () => {} },
      });
      const started = Date.now();
      await events.stopping(100);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
