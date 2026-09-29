import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { AgentTimers, MAX_ACTIVE_TIMERS, TimerError } from './agent-timers';

async function setup() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await database.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  let clock = Date.parse('2026-09-29T12:00:00.000Z');
  const events: { agentId: string; kind: string; text: string; human: boolean }[] = [];
  const make = () =>
    new AgentTimers(
      database,
      async (agentId, kind, text, human) => {
        events.push({ agentId, kind, text, human });
        return true;
      },
      () => clock,
    );
  return { database, agent, events, make, advance: (ms: number) => (clock += ms) };
}

it('a timer fires once, with its note and the authority it was set with', async () => {
  const { database, agent, events, make, advance } = await setup();
  const timers = make();
  try {
    const timer = await timers.create(agent.id, {
      kind: 'timer',
      delaySeconds: 60,
      note: 'check the build',
      human: true,
    });
    await timers.check();
    expect(events).toHaveLength(0);
    advance(60_000);
    await timers.check();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentId: agent.id, kind: 'timer', human: true });
    expect(events[0].text).toContain(`timer ${timer.id} fired at 2026-09-29T12:01:00.000Z`);
    expect(events[0].text).toContain('Note: check the build');
    advance(60_000);
    await timers.check();
    expect(events).toHaveLength(1);
    expect(await timers.list(agent.id)).toEqual([]);
  } finally {
    timers.close();
    await database.close();
  }
});

it('a reminder counts its firings, shows the previous one, marks the last and then finishes', async () => {
  const { database, agent, events, make, advance } = await setup();
  const timers = make();
  try {
    await timers.create(agent.id, {
      kind: 'reminder',
      delaySeconds: 30,
      everySeconds: 30,
      times: 3,
      note: 'stretch',
      human: false,
    });
    for (let i = 0; i < 3; i++) {
      advance(30_000);
      await timers.check();
    }
    expect(events.map(event => event.text.match(/: (\d\/\d)/)?.[1])).toEqual(['1/3', '2/3', '3/3']);
    expect(events[0].text).toContain('this is the first');
    expect(events[1].text).toContain('previous at 2026-09-29T12:00:30.000Z');
    expect(events[2].text).toContain('This is the last reminder');
    expect(events[1].text).toContain('Next at 2026-09-29T12:01:30.000Z');
    expect(await timers.list(agent.id)).toEqual([]);
  } finally {
    timers.close();
    await database.close();
  }
});

it('survives a restart: an unlimited reminder resumes and counts what was missed while offline', async () => {
  const { database, agent, events, make, advance } = await setup();
  const before = make();
  await before.create(agent.id, {
    kind: 'reminder',
    delaySeconds: 10,
    everySeconds: 10,
    note: 'poll the queue',
    human: true,
  });
  before.close(); // the platform goes down
  advance(35_000); // occurrences at 10s, 20s and 30s fell due while it was down
  const after = make();
  try {
    await after.check();
    expect(events).toHaveLength(1);
    expect(events[0].text).toContain('3/∞');
    expect(events[0].text).toContain('2 earlier occurrence(s) were missed');
    expect(events[0].text).toContain('late');
    const [pending] = await after.list(agent.id);
    expect(pending).toMatchObject({
      kind: 'reminder',
      fired: 3,
      total: 'unlimited',
      nextAt: '2026-09-29T12:00:40.000Z',
    });
  } finally {
    after.close();
    await database.close();
  }
});

it('rejects bad timers and caps how many one agent holds; cancelling frees a slot', async () => {
  const { database, agent, make } = await setup();
  const timers = make();
  try {
    for (const bad of [
      { kind: 'timer' as const, delaySeconds: 0 },
      { kind: 'timer' as const, delaySeconds: 60, note: 'x'.repeat(257) },
      { kind: 'timer' as const, delaySeconds: 31 * 24 * 3600 },
      { kind: 'reminder' as const, delaySeconds: 5, everySeconds: 5, note: 'too often' },
      { kind: 'reminder' as const, delaySeconds: 60, everySeconds: 60, times: 0, note: 'never' },
      { kind: 'reminder' as const, delaySeconds: 60, everySeconds: 60 },
    ])
      await expect(timers.create(agent.id, { ...bad, human: false })).rejects.toBeInstanceOf(TimerError);
    const made = [];
    for (let i = 0; i < MAX_ACTIVE_TIMERS; i++)
      made.push(await timers.create(agent.id, { kind: 'timer', delaySeconds: 600, human: false }));
    await expect(timers.create(agent.id, { kind: 'timer', delaySeconds: 600, human: false })).rejects.toThrow(
      /At most/,
    );
    expect(await timers.cancel(agent.id, made[0].id)).toBe(true);
    expect(await timers.cancel(agent.id, made[0].id)).toBe(false);
    await timers.create(agent.id, { kind: 'timer', delaySeconds: 600, human: false });
  } finally {
    timers.close();
    await database.close();
  }
});
