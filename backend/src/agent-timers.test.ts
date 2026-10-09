import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { AgentTimers, MAX_ACTIVE_TIMERS, TimerError } from './agent-timers';

async function setup() {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await database.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  let clock = Date.parse('2026-09-29T12:00:00.000Z');
  const events: { agentId: string; kind: string; text: string; human: boolean; eventId?: string }[] = [];
  const make = () =>
    new AgentTimers(
      database,
      async (agentId, kind, text, human, eventId) => {
        events.push({ agentId, kind, text, human, eventId });
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
    delaySeconds: 300,
    everySeconds: 300,
    note: 'poll the queue',
    human: true,
  });
  before.close(); // the platform goes down
  advance(1_050_000); // occurrences at 5, 10 and 15 minutes fell due while it was down
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
      nextAt: '2026-09-29T12:20:00.000Z',
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
      // Faster than every 5 minutes: never endless, at most 360 firings.
      { kind: 'reminder' as const, delaySeconds: 60, everySeconds: 60, note: 'endless and fast' },
      { kind: 'reminder' as const, delaySeconds: 60, everySeconds: 60, times: 361, note: 'too many' },
    ])
      await expect(timers.create(agent.id, { ...bad, human: false })).rejects.toBeInstanceOf(TimerError);
    // Every 5 minutes or slower may repeat until cancelled.
    await timers.cancel(
      agent.id,
      (
        await timers.create(agent.id, {
          kind: 'reminder',
          delaySeconds: 300,
          everySeconds: 300,
          note: 'ok',
          human: false,
        })
      ).id,
    );
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

it('keeps a firing until a turn has seen it, and delivers it again after a restart', async () => {
  const { database, agent, events, make, advance } = await setup();
  let timers = make();
  try {
    await timers.create(agent.id, { kind: 'timer', delaySeconds: 30, note: 'call the lab', human: true });
    advance(30_000);
    await timers.check();
    expect(events).toHaveLength(1);
    const first = events[0]!;
    expect(await database.client.pendingTimerEvent.count()).toBe(1);
    // The platform stops before the agent's turn saw it: the next start delivers it again, with the same id.
    timers.close();
    timers = make();
    timers.start();
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[1]).toMatchObject({ eventId: first.eventId, human: true });
    expect(events[1]!.text).toMatch(
      /^\[Delivered again: this timer fired at .+, but the platform restarted before you saw it\.\]/,
    );
    expect(events[1]!.text).toContain('call the lab');
    // Once a turn has seen it, it is done.
    await timers.seen([first.eventId!]);
    expect(await database.client.pendingTimerEvent.count()).toBe(0);
  } finally {
    timers.close();
    await database.close();
  }
});

it("applies the owner's changes all or nothing, and says what changed", async () => {
  const { database, agent, make } = await setup();
  const timers = make();
  try {
    const timer = await timers.create(agent.id, { kind: 'timer', delaySeconds: 600, note: 'old', human: true });
    const reminder = await timers.create(agent.id, {
      kind: 'reminder',
      delaySeconds: 60,
      everySeconds: 3600,
      note: 'stretch',
      human: true,
    });
    const nextAt = new Date(Date.parse('2026-09-29T12:00:00.000Z') + 7200_000).toISOString();
    // A bad change refuses the whole save.
    await expect(
      timers.edit(agent.id, [
        { id: timer.id, cancel: true },
        { id: reminder.id, everySeconds: 2 },
      ]),
    ).rejects.toThrow(TimerError);
    expect(await timers.list(agent.id)).toHaveLength(2);
    const said = await timers.edit(agent.id, [
      { id: timer.id, cancel: true },
      { id: reminder.id, note: 'drink water', nextAt, total: 5 },
    ]);
    expect(said).toEqual([
      `Cancelled your timer ${timer.id} ("old").`,
      `Changed your reminder ${reminder.id} ("stretch"): note now "drink water", next at ${nextAt}, 5 times in all.`,
    ]);
    expect(await timers.list(agent.id)).toMatchObject([{ id: reminder.id, note: 'drink water', nextAt, total: 5 }]);
    // Unchanged values change nothing (and say nothing).
    expect(await timers.edit(agent.id, [{ id: reminder.id, note: 'drink water' }])).toEqual([]);
    await expect(timers.edit(agent.id, [{ id: timer.id, note: 'x' }])).rejects.toThrow(/no longer exists/);
  } finally {
    timers.close();
    await database.close();
  }
});
