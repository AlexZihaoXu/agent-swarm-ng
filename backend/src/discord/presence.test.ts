import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { prepareDatabase } from '../test-database';
import { MockDiscord } from './testing/mock-discord';
import { DiscordConnections } from './connections';
import { DiscordStore } from './store';
import { DiscordTokenStore } from './token-store';
import { DiscordPresence, IDLE_AFTER_MS } from './presence';

vi.setConfig({ testTimeout: 15_000 });
const TOKEN = 'MTAwMDAwMDAwMDAwMDAwMDAx.GxYzAb.abcdefghijklmnopqrstuvwxyz0123';
let discord: MockDiscord;
beforeEach(async () => {
  discord = await new MockDiscord().start();
  discord.tokens.set(TOKEN, { id: '1000000000000000001', username: 'aether-bot' });
});
afterEach(async () => {
  await discord.stop();
});

it('shows auto as online while the agent works and idle after ten quiet minutes; idle and dnd are forced', async () => {
  const root = join(process.env.SQLITE_TEST_ROOT!, crypto.randomUUID());
  await mkdir(root, { recursive: true });
  const database = await prepareDatabase(join(root, 'platform.db'));
  const agent = await database.createAgent({ name: 'Aether', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
  const tokens = new DiscordTokenStore(join(root, 'bots.json'));
  await tokens.set(agent.id, TOKEN);
  const store = new DiscordStore(database);
  const connections = new DiscordConnections(tokens, store, { api: discord.api });
  let now = 1_790_000_000_000;
  const presence = new DiscordPresence(store, connections, () => now);
  const last = () => discord.presences.at(-1)!;
  try {
    await connections.restart(agent.id);
    // Connected without any write activity yet: auto shows idle.
    await vi.waitFor(() => expect(last()).toMatchObject({ status: 'idle', activities: [] }), { timeout: 5000 });
    presence.wrote(agent.id);
    await vi.waitFor(() => expect(last().status).toBe('online'));
    expect(await presence.set(agent.id, { text: '  Building   the dashboard ' })).toEqual({
      mode: 'auto',
      shown: 'online',
      text: 'Building the dashboard',
    });
    await vi.waitFor(() =>
      expect(last()).toMatchObject({ status: 'online', activities: [{ type: 4, state: 'Building the dashboard' }] }),
    );
    now += IDLE_AFTER_MS - 1000;
    await presence.tick();
    expect(last().status).toBe('online');
    now += 2000;
    await presence.tick();
    await vi.waitFor(() => expect(last().status).toBe('idle'));
    // Forced modes do not follow activity.
    await presence.set(agent.id, { mode: 'dnd' });
    await vi.waitFor(() => expect(last().status).toBe('dnd'));
    presence.wrote(agent.id);
    await presence.tick();
    expect(last().status).toBe('dnd');
    await presence.set(agent.id, { mode: 'auto', text: '' });
    await vi.waitFor(() => expect(last()).toMatchObject({ status: 'online', activities: [] }));
    await expect(presence.set(agent.id, { mode: 'invisible' as never })).rejects.toThrow('cannot be invisible');
    await expect(presence.set(agent.id, { text: 'x'.repeat(129) })).rejects.toThrow('at most 128');
    // A new Gateway session starts with the chosen status.
    await presence.set(agent.id, { mode: 'idle', text: 'Back soon' });
    await connections.restart(agent.id);
    await vi.waitFor(() => expect(discord.identifies.length).toBe(2));
    expect(discord.identifies[1].presence).toMatchObject({ status: 'idle', activities: [{ state: 'Back soon' }] });
  } finally {
    presence.close();
    await connections.close();
    await database.close();
  }
});
