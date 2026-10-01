import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { ComputerMonitors } from './monitors';
import type { ComputerUseService } from './service';

const settle = (ms = 260) => new Promise(resolve => setTimeout(resolve, ms));

async function setup() {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({
    data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' },
  });
  // The command's output: the test pushes text, then ends it the way the controller does.
  let push!: (text: string) => void, finish!: () => void;
  const commands: string[] = [];
  const stream = async (_computerId: string, command: string, signal: AbortSignal) => {
    commands.push(command);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        push = text => controller.enqueue(new TextEncoder().encode(text));
        finish = () => controller.close();
        signal.addEventListener('abort', () => {
          try {
            controller.close();
          } catch {
            /* closed already */
          }
        });
      },
    });
  };
  const computers = {
    held: async () => ({ computerId: computer.id, name: 'Desk', token: 'claim' }),
    watchClaim: async () => ({}),
  } as unknown as ComputerUseService;
  const events: string[] = [];
  const turns: (() => void)[] = [];
  const monitors = new ComputerMonitors(
    db,
    computers,
    () => stream,
    async (_agent, text) => {
      events.push(text);
      return { handled: new Promise<void>(resolve => turns.push(resolve)) };
    },
  );
  return {
    db,
    agent,
    monitors,
    events,
    commands,
    push: (text: string) => push(text),
    finish: () => finish(),
    endTurns: async () => {
      for (const end of turns.splice(0)) end();
      await settle(20);
    },
    close: async () => {
      monitors.close();
      await db.close();
    },
  };
}

it('wakes the agent with batched lines, holds output while it works, and stops when the command exits', async () => {
  const t = await setup();
  try {
    const started = await t.monitors.create(t.agent.id, {
      command: 'tail -F /tmp/build/log | grep --line-buffered -E "ERROR|ready"',
      human: true,
    });
    expect(started).toMatchObject({ kind: 'monitor', computer: 'Desk', wakeUps: 0 });
    expect(t.commands).toEqual(['tail -F /tmp/build/log | grep --line-buffered -E "ERROR|ready"']);
    expect(await t.db.client.computerWatch.count({ where: { kind: 'monitor' } })).toBe(1);
    // Lines printed close together are one wake-up.
    t.push('ERROR one\nERROR tw');
    t.push('o\n');
    await settle();
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toContain('printed 2 line(s)');
    expect(t.events[0]).toContain('ERROR one\nERROR two');
    expect(t.events[0]).toContain(`cancel_timer({id: "${started.id}"})`);
    // While that turn runs, output waits and comes together afterwards.
    t.push('ERROR three\n');
    await settle();
    t.push('ready\n');
    await settle();
    expect(t.events).toHaveLength(1);
    expect(t.monitors.list(t.agent.id)[0]).toMatchObject({ state: 'holding output while you handle its last wake-up' });
    await t.endTurns();
    expect(t.events).toHaveLength(2);
    expect(t.events[1]).toContain('printed 2 line(s) since you were last woken');
    expect(t.events[1]).toContain('ERROR three\nready');
    // The command ends by itself: the agent hears how, with any output not shown yet.
    await t.endTurns();
    t.push('last line\n\n\0exit {"code":1,"stderr":"grep: bad"}\n');
    t.finish();
    await settle(40);
    expect(t.events.at(-1)).toContain('ended: the command exited with code 1; its last error output: grep: bad');
    expect(t.events.at(-1)).toContain('last line');
    expect(t.monitors.list(t.agent.id)).toEqual([]);
    expect(await t.db.client.computerWatch.count()).toBe(0);
  } finally {
    await t.close();
  }
});

it('stops a monitor whose output floods, cancels quietly, and refuses what it cannot keep', async () => {
  const t = await setup();
  try {
    const noisy = await t.monitors.create(t.agent.id, { command: 'yes', human: true });
    t.push('y\n'.repeat(400));
    await settle(40);
    expect(t.events.at(-1)).toContain('printed more than 300 lines within 10 seconds');
    expect(t.events.at(-1)).toContain('tighter filter');
    expect(t.monitors.list(t.agent.id).some(item => item.id === noisy.id)).toBe(false);
    const quiet = await t.monitors.create(t.agent.id, { command: 'sleep 999', human: true });
    const before = t.events.length;
    expect(await t.monitors.cancel(t.agent.id, quiet.id)).toBe(true);
    await settle(40);
    expect(t.events).toHaveLength(before);
    await expect(t.monitors.create(t.agent.id, { command: ' ', human: true })).rejects.toThrow('1..4000');
    await expect(t.monitors.create(t.agent.id, { command: 'x', timeoutSeconds: 10, human: true })).rejects.toThrow(
      'timeout_seconds',
    );
    for (let index = 0; index < 3; index++)
      await t.monitors.create(t.agent.id, { command: `sleep ${index}`, human: true });
    await expect(t.monitors.create(t.agent.id, { command: 'one more', human: true })).rejects.toThrow('At most 3');
  } finally {
    await t.close();
  }
});
