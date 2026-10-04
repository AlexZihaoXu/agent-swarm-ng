import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { prepareDatabase } from './test-database';
import { Organizations } from './organizations';
import { SwarmStore } from './swarm-store';
import { GroupStore } from './group-store';
import { ComputerUseService } from './computer-use/service';
import { buildApp } from './app';
import { EndpointStore } from './endpoint-store';

async function setup() {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const service = new ComputerUseService(db, {
    capture: async () => ({}) as never,
    execute: async () => ({}) as never,
    cancel: async () => {},
  });
  const orgs = new Organizations(db, (agentId, ids) => service.assign(agentId, ids));
  const agent = (name: string) => db.createAgent({ name, endpointId: 'm', model: 'm', thinkingLevel: 'off' });
  const computer = (name: string, organizationId = 'personal') =>
    db.client.computer.create({ data: { name, requestKey: crypto.randomUUID(), state: 'running', organizationId } });
  return { db, service, orgs, agent, computer, swarm: new SwarmStore(db), groups: new GroupStore(db) };
}

it('keeps links inside one organization: assignments, DM permissions and group members', async () => {
  const { db, service, orgs, agent, computer, swarm, groups } = await setup();
  try {
    const lab = await orgs.create('Lab', 'admin');
    const [ada, bo] = [await agent('Ada'), await agent('Bo')];
    const desk = await computer('Desk');
    const rig = await computer('Rig', lab);
    expect((await db.findAgent(ada.id))?.organizationId).toBe('personal');
    await service.assign(ada.id, [desk.id]);
    await expect(service.assign(ada.id, [desk.id, rig.id])).rejects.toThrow('own organization');
    await swarm.updateSettings(ada.id, { allowedDmAgentIds: [bo.id] });
    const group = await groups.create('Team', [ada.id, bo.id]);
    await expect(groups.create('Mixed', [ada.id], lab)).rejects.toThrow('must all be in its organization');
    expect(group.organizationId).toBe('personal');

    // Moving Bo to Lab: the preview lists what crosses; applying drops it and moves him.
    const preview = await orgs.move('agent', bo.id, lab, false);
    expect(preview).toEqual({
      dropped: ['DM with Ada: no longer allowed', 'Group Team: no longer a member'],
      moved: false,
    });
    expect(await db.client.dmGrant.count()).toBe(2);
    expect(await orgs.move('agent', bo.id, lab, true)).toMatchObject({ moved: true });
    expect(await db.client.dmGrant.count()).toBe(0);
    expect(await db.client.groupMember.count({ where: { groupId: group.id } })).toBe(1);
    await expect(swarm.updateSettings(ada.id, { allowedDmAgentIds: [bo.id] })).rejects.toThrow('own organization');

    // Moving Ada's computer away releases her claim and unassigns it.
    await service.use(ada.id, 'Desk', true);
    expect(await orgs.move('computer', desk.id, lab, false)).toEqual({
      dropped: ['Agent Ada: no longer assigned'],
      moved: false,
    });
    await orgs.move('computer', desk.id, lab, true);
    expect(await db.client.computerAssignment.count({ where: { agentId: ada.id } })).toBe(0);
    expect(await db.client.computerClaim.count()).toBe(0);
    await service.assign(bo.id, [desk.id, rig.id]);

    // A group moves without the members that stay behind.
    expect((await orgs.move('group', group.id, lab, false)).dropped).toEqual(['Member Ada: removed from the group']);
    await orgs.move('group', group.id, lab, true);
    await groups.update(group.id, 'Team', [bo.id]);
    expect(await orgs.move('agent', bo.id, lab, true)).toEqual({ dropped: [], moved: false });
  } finally {
    await db.close();
  }
});

it('creates, renames and deletes organizations: never one with things in it, never the last', async () => {
  const { db, orgs, agent } = await setup();
  try {
    const lab = await orgs.create('  Lab ', 'admin');
    await orgs.rename(lab, 'Research');
    expect((await orgs.list()).map(org => [org.name, org.agents])).toEqual([
      ['Personal', 0],
      ['Research', 0],
    ]);
    await expect(orgs.create('', 'admin')).rejects.toThrow('1–60 characters');
    const ada = await agent('Ada');
    await orgs.move('agent', ada.id, lab, true);
    await expect(orgs.remove(lab)).rejects.toThrow('still has 1 agent(s)');
    await orgs.move('agent', ada.id, 'personal', true);
    await orgs.remove(lab);
    await expect(orgs.remove('personal')).rejects.toThrow('still has 1 agent(s)');
    await db.client.agent.deleteMany();
    await expect(orgs.remove('personal')).rejects.toThrow('this is the last one');
    await expect(orgs.move('agent', 'nobody', 'personal', false)).rejects.toThrow('Agent not found');
  } finally {
    await db.close();
  }
});

it('serves organizations to the dashboard and creates agents in the chosen one', async () => {
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'orgs-api-'));
  const db = await prepareDatabase(join(folder, 'api.db'));
  const endpoints = new EndpointStore(join(folder, 'endpoints.json'));
  await endpoints.save({ id: 'fixture', name: 'Fixture', baseUrl: 'http://test.invalid/v1', apiKey: '' });
  const app = await buildApp({ requireLogin: false, database: db, endpointStore: endpoints, computerController: null });
  try {
    const created = await app.inject({ method: 'POST', url: '/api/organizations', payload: { name: 'Lab' } });
    const lab = created.json().organizations.find((org: { name: string }) => org.name === 'Lab');
    const create = (organizationId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: { name: 'Ada', endpointId: 'fixture', model: 'test-model', thinkingLevel: 'off', organizationId },
      });
    expect((await create('nope')).statusCode).toBe(404);
    const agent = await create(lab.id);
    expect(agent.json().organizationId).toBe(lab.id);
    const preview = await app.inject({
      method: 'POST',
      url: '/api/organizations/personal/move',
      payload: { kind: 'agent', id: agent.json().id, apply: false },
    });
    expect(preview.json()).toEqual({ dropped: [], moved: false });
    expect((await app.inject({ method: 'DELETE', url: `/api/organizations/${lab.id}` })).statusCode).toBe(409);
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/organizations/nope', payload: { name: 'X' } })).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
    await db.close();
  }
});
