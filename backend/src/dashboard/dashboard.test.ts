import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { dashboardData } from './routes';

const HOUR = 3_600_000;

it('buckets samples, active time, tokens and spend over the period, scoped to an organization', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const client = database.client;
  const now = Date.parse('2026-10-03T12:00:00Z');
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR);
  await client.organization.create({ data: { id: 'lab', name: 'Lab' } });
  await client.agent.create({
    data: { id: 'ada', name: 'Ada', model: 'm', thinkingLevel: 'off', endpointId: 'e' },
  });
  await client.agent.create({
    data: {
      id: 'bo',
      name: 'Bo',
      model: 'm',
      thinkingLevel: 'off',
      endpointId: 'e',
      organizationId: 'lab',
    },
  });
  await client.computer.create({ data: { id: 'desk', name: 'Desk', requestKey: 'k' } });
  await client.systemSample.createMany({
    data: [
      { at: at(0.7), cpuPercent: 20, memUsed: 4n, memTotal: 16n },
      { at: at(0.6), cpuPercent: 40, memUsed: 6n, memTotal: 16n },
      { at: at(100), cpuPercent: 99, memUsed: 9n, memTotal: 16n },
    ],
  });
  await client.diskSample.createMany({
    data: [
      { at: at(2), disk: '/dev/nvme0n1p2', label: 'nvme0n1p2', uses: '["docker"]', used: 300n, total: 500n },
      {
        at: at(1),
        disk: '/dev/nvme0n1p2',
        label: 'nvme0n1p2',
        uses: '["docker","platform data"]',
        used: 310n,
        total: 500n,
      },
      { at: at(1), disk: 'bulk', label: 'bulk (ZFS)', uses: '["listed"]', used: 200n, total: 800n },
    ],
  });
  await client.computerSample.create({
    data: { at: at(1), computerId: 'desk', cpuPercent: 12, memUsed: 2n, memLimit: 4n },
  });
  await client.agentRunSpan.createMany({
    data: [
      { agentId: 'ada', runId: 'r1', startedAt: at(3), endedAt: new Date(at(3).getTime() + 15 * 60_000) },
      { agentId: 'ada', runId: 'r0', startedAt: at(60), endedAt: at(59) },
      { agentId: 'bo', runId: 'r2', startedAt: at(2), endedAt: at(1) },
    ],
  });
  await client.usageEvent.createMany({
    data: [
      {
        at: at(1),
        agentId: 'ada',
        provider: 'openai-codex',
        model: 'm',
        purpose: 'turn',
        input: 10,
        output: 5,
        cacheRead: 100,
        cacheWrite: 0,
        reasoning: 2,
        cost: 0.5,
      },
      {
        at: at(1),
        agentId: 'bo',
        provider: 'openrouter',
        model: 'm',
        purpose: 'triage',
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 3,
        reasoning: 0,
        cost: 0.25,
      },
    ],
  });

  const all = await dashboardData(database, '48h', undefined, now);
  expect(all.buckets).toHaveLength(96);
  expect(all.bucketMs).toBe(30 * 60_000);
  // One bucket averages two samples; the old sample is outside the period.
  expect(all.system.cpuPercent.filter(value => value !== null)).toEqual([30]);
  expect(all.system.memTotal).toBe(16);
  expect(all.disks.map(disk => [disk.disk, disk.uses, disk.total, disk.used.filter(v => v !== null)])).toEqual([
    ['/dev/nvme0n1p2', ['docker', 'platform data'], 500, [300, 310]],
    ['bulk', ['listed'], 800, [200]],
  ]);
  expect(all.computers[0]).toMatchObject({ id: 'desk', memLimit: 4 });
  const ada = all.agents.find(agent => agent.id === 'ada')!;
  expect(ada.activeMs).toBe(15 * 60_000);
  expect(ada.tokenTotals).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 0, reasoning: 2 });
  expect(all.providers.map(p => [p.provider, p.subscription, p.total])).toEqual([
    ['openai-codex', true, 0.5],
    ['openrouter', false, 0.25],
  ]);

  // An organization shows its own agents' work and computers; system-wide charts stay.
  const lab = await dashboardData(database, '48h', 'lab', now);
  expect(lab.agents.map(agent => agent.name)).toEqual(['Bo']);
  expect(lab.computers).toEqual([]);
  expect(lab.providers.map(p => p.provider)).toEqual(['openrouter']);
  expect(lab.disks).toHaveLength(2);
  // A longer period reaches the older run.
  const week = await dashboardData(database, '7d', undefined, now);
  expect(week.agents.find(agent => agent.id === 'ada')!.activeMs).toBe(15 * 60_000 + HOUR);
});
