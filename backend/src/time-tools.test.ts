import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { AgentTimers } from './agent-timers';
import { createTimeTools, currentTime } from './time-tools';

it('tells the time in a zone and reports an unknown zone as a correctable error', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const toronto = currentTime('America/Toronto', now);
  expect(toronto).toMatchObject({
    utc: '2026-09-29T12:00:00.000Z',
    unixMs: now.getTime(),
    timeZone: 'America/Toronto',
  });
  expect(toronto.local).toContain('08:00:00');
  expect(() => currentTime('Mars/Olympus', now)).toThrow();
});

it('timer tools act for this agent, keep its authority, and return mistakes to the agent', async () => {
  const database = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await database.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  const timers = new AgentTimers(database, async () => true);
  const tools = Object.fromEntries(createTimeTools(timers, agent.id, () => true).map(tool => [tool.name, tool]));
  const call = async (name: string, params: object) => {
    const result = await tools[name].execute('call', params as never, undefined, undefined, undefined as never);
    return {
      ...JSON.parse((result.content[0] as { text: string }).text),
      isError: Boolean((result as { isError?: boolean }).isError),
    };
  };
  try {
    expect(Object.keys(tools).sort()).toEqual([
      'cancel_timer',
      'current_time',
      'list_timers',
      'set_reminder',
      'set_timer',
    ]);
    expect(await call('current_time', { timezone: 'Nowhere/Land' })).toMatchObject({ isError: true });
    const timer = await call('set_timer', { seconds: 90, note: 'check the deploy' });
    expect(timer).toMatchObject({ kind: 'timer', note: 'check the deploy', isError: false });
    expect((await database.client.agentTimer.findUnique({ where: { id: timer.id } }))?.human).toBe(true);
    expect(await call('set_reminder', { every_seconds: 5, note: 'too often' })).toMatchObject({ isError: true });
    const reminder = await call('set_reminder', { every_seconds: 60, times: 3, note: 'stand up' });
    expect(reminder).toMatchObject({ kind: 'reminder', total: 3, everySeconds: 60 });
    expect((await call('list_timers', {})).timers.map((item: { id: string }) => item.id)).toEqual([
      reminder.id, // soonest first
      timer.id,
    ]);
    expect(await call('cancel_timer', { id: timer.id })).toMatchObject({ cancelled: true });
    expect(await call('cancel_timer', { id: timer.id })).toMatchObject({ isError: true });
  } finally {
    timers.close();
    await database.close();
  }
});
