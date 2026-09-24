import { expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { prepareDatabase } from './test-database';
import { PlatformStore } from './platform-store';
import { AgentSessionStore } from './agent-session-store';
import { GroupStore } from './group-store';
import { SwarmStore } from './swarm-store';

async function fixture() {
  const path = join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`);
  const database = await prepareDatabase(path);
  const agent = await database.createAgent({ name: 'A', endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
  const other = await database.createAgent({ name: 'B', endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
  return { path, database, agent, other, sessions: new AgentSessionStore(database) };
}

it('saves incremental private entries in SQLite and restores them across database connections', async () => {
  const { path, database, agent, other, sessions } = await fixture();
  const session = SessionManager.inMemory();
  try {
    session.appendMessage({ role: 'user', content: 'A private task', timestamp: 1 });
    await sessions.save(agent.id, session);
    session.appendMessage({ role: 'user', content: 'An agent thread', timestamp: 2 });
    await sessions.save(agent.id, session);
    expect(await sessions.load(other.id)).toBeNull();
    expect(await database.client.agentSessionEntry.count({ where: { agentId: agent.id } })).toBe(2);
    await database.close();
    const reopened = new PlatformStore(pathToFileURL(path).href);
    try {
      const restored = (await new AgentSessionStore(reopened).load(agent.id))!;
      expect(restored.getSessionId()).toBe(session.getSessionId());
      expect(restored.getEntries()).toEqual(session.getEntries());
      expect(restored.getSessionFile()).toBeUndefined();
      restored.appendMessage({ role: 'user', content: 'After restart', timestamp: 3 });
      await new AgentSessionStore(reopened).save(agent.id, restored);
      expect(await reopened.client.agentSessionEntry.count({ where: { agentId: agent.id } })).toBe(3);
      await reopened.deleteAgent(agent.id, agent.name);
      expect(await reopened.client.agentSessionEntry.count()).toBe(0);
      expect(await reopened.client.agentSession.count()).toBe(0);
      expect(await reopened.client.agent.count()).toBe(1);
    } finally { await reopened.close(); }
  } finally { await database.close(); }
});

it('saves the completed boundary even if the live Pi manager starts another turn before SQLite writes', async () => {
  const { database, agent, sessions } = await fixture();
  try {
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: 'user', content: 'Finished turn', timestamp: 1 });
    const checkpoint = AgentSessionStore.capture(manager);
    manager.appendMessage({ role: 'user', content: 'Later turn still in flight', timestamp: 2 });
    await database.appendMessage(agent.channels[0].id, 'assistant', 'Published after the frozen boundary');
    await sessions.save(agent.id, checkpoint, { advancePublications: false });
    const interrupted = (await sessions.load(agent.id))!;
    expect(interrupted.buildSessionContext().messages).toHaveLength(2); // Finished turn + recovered publication.
    expect(JSON.stringify(interrupted.buildSessionContext().messages)).toContain('Published after the frozen boundary');
    await sessions.save(agent.id, manager); // Provider is idle, so it is safe to advance publication cursors.
    expect((await sessions.load(agent.id))!.getEntries()).toHaveLength(2);
  } finally { await database.close(); }
});

it('keeps the previous checkpoint if a new snapshot is oversized or from a divergent session', async () => {
  const { database, agent, sessions } = await fixture();
  try {
    const first = SessionManager.inMemory();
    first.appendMessage({ role: 'user', content: 'Safe checkpoint', timestamp: 1 });
    await sessions.save(agent.id, first);
    const wrong = SessionManager.inMemory();
    wrong.appendMessage({ role: 'user', content: 'Unrelated session', timestamp: 2 });
    await expect(sessions.save(agent.id, wrong)).rejects.toThrow('different session');
    first.appendMessage({ role: 'user', content: 'x'.repeat(1024 * 1024), timestamp: 2 });
    await expect(sessions.save(agent.id, first)).rejects.toThrow('too large');
    expect((await sessions.load(agent.id))!.getEntries()).toHaveLength(1);
  } finally { await database.close(); }
});

it('fails closed on a corrupt private checkpoint instead of silently starting a new Pi session', async () => {
  const { database, agent, sessions } = await fixture();
  try {
    const session = SessionManager.inMemory();
    session.appendMessage({ role: 'user', content: 'Protected prior context', timestamp: 1 });
    await sessions.save(agent.id, session);
    await database.client.agentSessionEntry.update({ where: { agentId_position: { agentId: agent.id, position: 0 } }, data: { payload: '{"type":"message","id":"wrong","parentId":null}' } });
    await expect(sessions.load(agent.id)).rejects.toThrow('Private agent session is invalid');
  } finally { await database.close(); }
});

it('reconciles committed private, group and DM publications missed by a Pi checkpoint once', async () => {
  const { database, agent, other, sessions } = await fixture();
  try {
    const session = SessionManager.inMemory();
    session.appendMessage({ role: 'user', content: 'Before publications', timestamp: 1 });
    await sessions.save(agent.id, session);
    await database.appendMessage(agent.channels[0].id, 'assistant', 'Saved private answer');
    const groups = new GroupStore(database);
    const group = await groups.create('Shared', [agent.id, other.id]);
    const human = await groups.publishHuman(group.id, 'Start', crypto.randomUUID());
    await groups.publishAgent(group.id, agent.id, 'Saved group answer', human.message.chainId, 'reply');
    const swarm = new SwarmStore(database);
    await swarm.updateSettings(agent.id, { allowedDmAgentIds: [other.id] });
    await swarm.send({ senderId: agent.id, recipientId: other.id, chainId: human.message.chainId, deliveryKey: 'saved-dm', text: 'Saved peer answer' });
    const restored = (await sessions.load(agent.id))!;
    const context = JSON.stringify(restored.buildSessionContext().messages);
    for (const text of ['Saved private answer', 'Saved group answer', 'Saved peer answer']) expect(context).toContain(text);
    expect(restored.getEntries().filter(entry => entry.type === 'custom_message')).toHaveLength(1);
    await sessions.save(agent.id, restored);
    expect((await sessions.load(agent.id))!.getEntries().filter(entry => entry.type === 'custom_message')).toHaveLength(1);
  } finally { await database.close(); }
});

it('persists a completed compaction as one consistent private checkpoint', async () => {
  const { database, agent, sessions } = await fixture();
  try {
    const session = SessionManager.inMemory();
    session.appendMessage({ role: 'user', content: 'Old detail', timestamp: 1 });
    const kept = session.appendMessage({ role: 'user', content: 'Retained detail', timestamp: 2 });
    await sessions.save(agent.id, session);
    session.appendCompaction('Old detail summarized', kept, 100);
    await sessions.save(agent.id, session);
    const restored = (await sessions.load(agent.id))!;
    expect(restored.buildSessionContext().messages.map(message => message.role === 'user' ? message.content : message.role === 'compactionSummary' ? message.summary : '')).toEqual(['Old detail summarized', 'Retained detail']);
    expect(restored.getEntries()).toHaveLength(2); // Only the retained active path is loaded.
    expect(await database.client.agentSessionEntry.count({ where: { agentId: agent.id } })).toBe(3); // Older entry remains archived.
    const next = restored.appendMessage({ role: 'user', content: 'Next turn', timestamp: 3 });
    await sessions.save(agent.id, restored);
    expect((await sessions.load(agent.id))!.buildSessionContext()).toEqual(restored.buildSessionContext());
    restored.appendCompaction('Earlier work summarized again', next, 120);
    await sessions.save(agent.id, restored);
    const later = (await sessions.load(agent.id))!;
    expect(later.buildSessionContext().messages.map(message => message.role === 'user' ? message.content : message.role === 'compactionSummary' ? message.summary : '')).toEqual(['Earlier work summarized again', 'Next turn']);
    expect(later.getEntries()).toHaveLength(2);
    expect(await database.client.agentSessionEntry.count({ where: { agentId: agent.id } })).toBe(5);
  } finally { await database.close(); }
});
