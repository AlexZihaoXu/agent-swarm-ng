import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { ComputerUseError, ComputerUseService, type ComputerRuntime } from './service';
import { ComputerWatches, type Judge } from './watches';

const session = '12345678-1234-1234-1234-123456789abc';
async function setup(judge: Judge) {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'model', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({
    data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' },
  });
  const state = {
    screen: 'working...',
    alive: true,
    pixels: 1,
    gone: false,
    prepareFails: false,
    hang: false,
    command: '',
  };
  const runtime: ComputerRuntime = {
    capture: async (_id, _request, signal) => {
      if (state.hang)
        await new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        );
      return {
        mimeType: 'image/png',
        data: new Uint8Array([state.pixels]),
        width: 1,
        height: 1,
        bounds: [0, 0, 999, 999],
      };
    },
    execute: async () => ({ started: true, completed: 1, error: null }),
    prepareCore: async (_id, request) => {
      if (state.prepareFails) throw new ComputerUseError('Computer controller unavailable.', 503);
      return request;
    },
    core: async (_id, request: any) =>
      request.session !== session || (state.gone && request.operation !== 'delete')
        ? { started: true, settled: true as const, error: 'Unknown terminal session.' }
        : {
            started: true,
            settled: true as const,
            result: {
              type: 'terminal',
              session: {
                id: session,
                name: 'claude',
                alive: state.alive,
                exitCode: state.alive ? null : 1,
                columns: 120,
                ...(state.command ? { currentCommand: state.command } : {}),
              },
              text: state.screen,
            },
          },
    cancel: async () => {},
  };
  const service = new ComputerUseService(db, runtime);
  await service.assign(agent.id, [computer.id]);
  await service.use(agent.id, computer.id, true);
  let clock = 1_000_000;
  const events: string[] = [];
  // Each wake-up's turn stays "running" until the test ends it (repeating watches wait for it).
  const turns: (() => void)[] = [];
  const watches = new ComputerWatches(
    db,
    service,
    async (_agent, text) => {
      events.push(text);
      return { handled: new Promise<void>(resolve => turns.push(resolve)) };
    },
    judge,
    () => clock,
  );
  // As the broker wires it.
  service.onAgentTerminalDelete = ({ agentId, computerId, session }) =>
    void watches.terminalDeleted(agentId, computerId, session);
  return {
    db,
    agent,
    computer,
    service,
    state,
    watches,
    events,
    /** Ends the turns that received wake-ups so far (lets a paused repeating watch go on). */
    endTurns: async () => {
      for (const end of turns.splice(0)) end();
      await new Promise(resolve => setTimeout(resolve, 0));
    },
    tick: async (seconds: number) => {
      clock += seconds * 1000;
      await watches.due();
    },
    close: async () => {
      watches.close();
      await db.close();
    },
  };
}
const terminalWatch = { kind: 'terminal' as const, session, until: 'Claude finished', everySeconds: 30, human: true };

it('checks at its interval, tells the watcher how long the view is unchanged, and fires once', async () => {
  const seen: string[] = [];
  const judge = vi.fn<Judge>(async (_watch, input) => {
    seen.push(input.text);
    return input.text.includes('> ')
      ? { notify: true, summary: 'Claude is back at its prompt.' }
      : { notify: false, summary: 'still working' };
  });
  const t = await setup(judge);
  try {
    const watch = await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false });
    expect(watch).toMatchObject({ kind: 'watch_terminal', sessionName: 'claude', everySeconds: 30, context: 'fresh' });
    expect(watch).not.toHaveProperty('hint');
    // Default timeout: the larger of 10 minutes and 10 intervals.
    expect(Date.parse(watch.timesOutAt) - Date.parse(watch.createdAt)).toBe(600_000);
    await t.tick(10);
    expect(judge).not.toHaveBeenCalled(); // not due yet
    await t.tick(20);
    await t.tick(30);
    await t.tick(30);
    expect(seen).toHaveLength(3);
    expect(seen[0]).toContain('This is the first check.');
    expect(seen[0]).toContain('Condition to watch for: Claude finished');
    expect(seen[0]).toContain('Terminal state: running');
    // Nothing is skipped because it is unchanged; the watcher is told for how long instead.
    expect(seen[2]).toContain('Unchanged');
    expect(seen[2]).toContain('60s, 3 checks in a row');
    t.state.screen = 'Done.\n> ';
    await t.tick(30);
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toContain('fired');
    expect(t.events[0]).toContain("Watcher's report: Claude is back at its prompt.");
    expect(t.events[0]).toContain('The watch is finished and removed');
    // Changed since the last check, and the start view is shown for comparison.
    expect(seen[3]).toContain('Changed since the previous check');
    expect(seen[3]).toContain('when the watch started');
    expect(t.watches.list(t.agent.id)).toEqual([]);
    expect(await t.db.client.computerWatch.count()).toBe(0);
    await t.tick(30);
    expect(judge).toHaveBeenCalledTimes(4); // once only
  } finally {
    await t.close();
  }
});

it('checks immediately by default and refuses what it cannot keep', async () => {
  const judge = vi.fn<Judge>(async () => ({ notify: false, summary: 'no' }));
  const t = await setup(judge);
  try {
    await expect(t.watches.create(t.agent.id, { ...terminalWatch, everySeconds: 29 })).rejects.toThrow('30..3600');
    await expect(
      t.watches.create(t.agent.id, { ...terminalWatch, context: 'fork', everySeconds: 150 }),
    ).rejects.toThrow('below 150');
    await expect(t.watches.create(t.agent.id, { ...terminalWatch, until: ' ' })).rejects.toThrow('condition');
    await expect(
      t.watches.create(t.agent.id, { ...terminalWatch, session: '87654321-1234-1234-1234-123456789abc' }),
    ).rejects.toThrow('cannot be watched');
    await t.watches.create(t.agent.id, { ...terminalWatch, context: 'fork', everySeconds: 149 });
    await vi.waitFor(() => expect(judge).toHaveBeenCalledTimes(1));
    await t.watches.create(t.agent.id, terminalWatch);
    await t.watches.create(t.agent.id, { kind: 'desktop', until: 'dialog', everySeconds: 30, human: false });
    await expect(t.watches.create(t.agent.id, terminalWatch)).rejects.toThrow('At most 3');
    // The agent's own release or cancel ends watches quietly.
    const [first] = t.watches.list(t.agent.id);
    expect(await t.watches.cancel(t.agent.id, first.id)).toBe(true);
    expect(await t.watches.releasedBy(t.agent.id, null)).toBe(2);
    expect(t.watches.list(t.agent.id)).toEqual([]);
    expect(t.events).toEqual([]);
  } finally {
    await t.close();
  }
});

it('wakes the agent when it times out, a check fails, or it loses the computer', async () => {
  let fail = false;
  const t = await setup(async () => {
    if (fail) throw new Error('model unavailable');
    return { notify: false, summary: 'still compiling' };
  });
  try {
    await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false, timeoutSeconds: 60 });
    await t.tick(30);
    await t.tick(30);
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toContain('timed out');
    expect(t.events[0]).toContain('the last check said: still compiling');

    await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false });
    fail = true;
    await t.tick(30);
    expect(t.events[1]).toContain('a check failed (model unavailable)');
    expect(t.events[1]).toContain('look yourself');

    fail = false;
    await t.watches.create(t.agent.id, {
      kind: 'desktop',
      until: 'dialog',
      everySeconds: 30,
      human: true,
      checkNow: false,
    });
    await t.service.forceRelease(t.computer.id);
    await t.tick(30);
    expect(t.events[2]).toContain('you no longer hold that computer');
    expect(t.watches.list(t.agent.id)).toEqual([]);
  } finally {
    await t.close();
  }
});

it('sends desktop checks the current screen and the screen at watch start', async () => {
  const images: number[] = [];
  const t = await setup(async (_watch, input) => {
    images.push(input.images.length);
    return { notify: false, summary: 'no' };
  });
  try {
    await t.watches.create(t.agent.id, {
      kind: 'desktop',
      until: 'a dialog appears',
      everySeconds: 30,
      human: true,
      checkNow: false,
    });
    await t.tick(30);
    await t.tick(30);
    t.state.pixels = 2;
    await t.tick(30);
    expect(images).toEqual([1, 1, 2]);
  } finally {
    await t.close();
  }
});

it('after a restart, tells each agent its watch ended', async () => {
  const t = await setup(async () => ({ notify: false, summary: 'no' }));
  try {
    await t.db.client.computerWatch.create({
      data: { agentId: t.agent.id, computerId: t.computer.id, kind: 'terminal', until: 'build done', human: true },
    });
    // A process that started after the row was written reports it; its own new watches are left alone.
    await new Promise(resolve => setTimeout(resolve, 5));
    const restarted = new ComputerWatches(
      t.db,
      t.service,
      async (_agent, text) => Boolean(t.events.push(text)),
      async () => ({
        notify: false,
        summary: 'no',
      }),
    );
    await restarted.start();
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toContain('the platform restarted');
    expect(t.events[0]).toContain('build done');
    expect(await t.db.client.computerWatch.count()).toBe(0);
  } finally {
    await t.close();
  }
});

it('counts watches being created against the limit, and ties a watch to the claim it was set under', async () => {
  const t = await setup(async () => ({ notify: false, summary: 'no' }));
  try {
    // Several watch calls in one turn run in parallel.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false })),
    );
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3);
    await t.watches.releasedBy(t.agent.id, null);
    // A force release followed by a new claim does not carry the watch over.
    await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false });
    await t.service.forceRelease(t.computer.id);
    await t.service.use(t.agent.id, t.computer.id, true);
    await t.tick(30);
    expect(t.events.at(-1)).toContain('you no longer hold that computer');
    // A stopped computer says so.
    await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false });
    await t.db.client.computer.update({ where: { id: t.computer.id }, data: { state: 'stopped' } });
    await t.tick(30);
    expect(t.events.at(-1)).toContain('the computer is not running');
  } finally {
    await t.close();
  }
});

it('your own release (even mid-check) and your own terminal delete end watches quietly; others are reported', async () => {
  const t = await setup(async () => ({ notify: false, summary: 'no' }));
  try {
    // Someone else closing the watched terminal is reported.
    await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false });
    t.state.gone = true;
    await t.tick(30);
    expect(t.events.at(-1)).toContain('the terminal can no longer be viewed');
    // Deleting it yourself is not.
    t.state.gone = false;
    await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false });
    await t.service.core(t.agent.id, { kind: 'terminal', operation: 'delete', session });
    t.state.gone = true;
    await t.tick(30);
    expect(t.events).toHaveLength(1);
    expect(t.watches.list(t.agent.id)).toEqual([]);
    // Releasing the computer while a desktop check is reading it.
    t.state.hang = true;
    await t.watches.create(t.agent.id, {
      kind: 'desktop',
      until: 'dialog',
      everySeconds: 30,
      human: true,
      checkNow: false,
    });
    const events = t.events.length;
    const checking = t.tick(30);
    await new Promise(resolve => setTimeout(resolve, 20));
    const { ended } = await t.watches.releasing(t.agent.id, () => t.service.use(t.agent.id, null));
    await checking;
    expect(ended).toBe(1);
    expect(t.events).toHaveLength(events);
  } finally {
    await t.close();
  }
});

it('always checks at least once, and a failed read never blocks the computer', async () => {
  const judge = vi.fn<Judge>(async () => ({ notify: false, summary: 'not yet' }));
  const t = await setup(judge);
  try {
    await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false, timeoutSeconds: 30 });
    await t.tick(30);
    expect(judge).toHaveBeenCalledTimes(1);
    await t.tick(0);
    expect(t.events.at(-1)).toContain('timed out');
    // A controller hiccup during a watch read fails that watch's check only.
    await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false });
    t.state.prepareFails = true;
    await t.tick(30);
    expect(t.events.at(-1)).toContain('a check failed');
    t.state.prepareFails = false;
    expect((await t.service.terminalView(t.agent.id, { session })).error).toBeUndefined();
  } finally {
    await t.close();
  }
});

it('a force release during a read says the computer was lost, and an own delete ends the watch at any interval', async () => {
  const t = await setup(async () => ({ notify: false, summary: 'no' }));
  try {
    t.state.hang = true;
    await t.watches.create(t.agent.id, {
      kind: 'desktop',
      until: 'dialog',
      everySeconds: 30,
      human: true,
      checkNow: false,
    });
    const checking = t.tick(30);
    await new Promise(resolve => setTimeout(resolve, 20));
    await t.service.forceRelease(t.computer.id);
    await checking;
    expect(t.events.at(-1)).toContain('you no longer hold that computer');
    t.state.hang = false;
    // An hour-long interval: deleting the terminal yourself removes the watch at once, quietly.
    await t.service.use(t.agent.id, t.computer.id, true);
    await t.watches.create(t.agent.id, { ...terminalWatch, everySeconds: 3600, checkNow: false });
    const events = t.events.length;
    await t.service.core(t.agent.id, { kind: 'terminal', operation: 'delete', session });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(t.watches.list(t.agent.id)).toEqual([]);
    expect(t.events).toHaveLength(events);
  } finally {
    await t.close();
  }
});

it('a repeating watch fires once per occurrence, pauses while you handle it, merges fast firings, and remembers', async () => {
  const seen: string[] = [];
  let answer: boolean | 'fail' = false;
  const judge = vi.fn<Judge>(async (_watch, input) => {
    seen.push(input.text);
    if (answer === 'fail') throw new Error('model unavailable');
    return answer ? { notify: true, summary: 'tests failed' } : { notify: false, summary: 'tests pass' };
  });
  const t = await setup(judge);
  const step = async (value: boolean | 'fail', seconds = 30) => {
    answer = value;
    await t.tick(seconds);
  };
  try {
    const watch = await t.watches.create(t.agent.id, {
      ...terminalWatch,
      until: 'a test run fails',
      timeoutSeconds: 3600,
      repeat: { cooldownSeconds: 600, maxFires: 4 },
    });
    await step(true, 0); // t=0
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toContain('fired at');
    expect(t.events[0]).toContain('firing 1 of at most 4');
    expect(t.events[0]).toContain(`cancel_timer({id: "${watch.id}"})`);
    expect((t.watches.list(t.agent.id)[0] as { repeat?: object }).repeat).toMatchObject({
      fires: 1,
      state: 'paused while you handle its last wake-up',
    });
    // Nothing is checked while the agent is still handling the wake-up.
    await t.tick(300); // t=300
    expect(judge).toHaveBeenCalledTimes(1);
    await t.endTurns();
    // Still failing: the same occurrence does not fire again, but the watcher knows what it last reported.
    await step(true); // t=330
    expect(t.events).toHaveLength(1);
    expect(seen.at(-1)).toContain('This watch repeats. It last fired at');
    expect(seen.at(-1)).toContain('reporting: tests failed');
    // Cleared and back twice within the cooldown: the firings wait, merged.
    await step(false); // t=360, re-armed
    await step(true); // t=390, fires (pending)
    await step(false); // t=420
    await step(true); // t=450, fires again (merged)
    expect(t.events).toHaveLength(1);
    // A few failed checks in a row are ridden out, with a longer pause each time.
    await step('fail'); // t=480; next check 2 intervals later
    await step('fail', 60); // t=540; next 4 intervals later
    expect(t.watches.list(t.agent.id)).toHaveLength(1);
    // The cooldown ends: one wake-up with both firings.
    await step(false, 60); // t=600
    expect(t.events).toHaveLength(2);
    expect(t.events[1]).toContain('fired 2 times since you were last woken');
    expect(t.events[1]).toContain("Watcher's latest report: tests failed");
    await t.endTurns();
    await step(true, 60); // still failing since the last firing: not armed
    await step(false);
    await step(true); // the 4th firing is the last (max 4): it says so and removes the watch
    expect(t.events.at(-1)).toContain('fired for the last time');
    expect(t.watches.list(t.agent.id)).toEqual([]);
  } finally {
    await t.close();
  }
});

it('a repeating watch ends after three failed checks in a row, and checks cannot pile up', async () => {
  const judge = vi.fn<Judge>(async () => {
    throw new Error('model unavailable');
  });
  const t = await setup(judge);
  try {
    await t.watches.create(t.agent.id, { ...terminalWatch, repeat: {} });
    await t.tick(0);
    await t.tick(60); // 1st retry after 2 intervals
    expect(t.events).toHaveLength(0);
    await t.tick(120); // 2nd retry after 4 intervals
    expect(t.events.at(-1)).toContain('3 checks in a row failed (the last: model unavailable)');
    expect(judge).toHaveBeenCalledTimes(3);
  } finally {
    await t.close();
  }
});

it('a paused repeating watch still ends at its time limit, and a second occurrence on a changed view fires', async () => {
  let report = 'error A';
  const judge = vi.fn<Judge>(async () => ({ notify: true, summary: report }));
  const t = await setup(judge);
  try {
    await t.watches.create(t.agent.id, { ...terminalWatch, timeoutSeconds: 300, repeat: { cooldownSeconds: 30 } });
    await t.tick(0);
    expect(t.events).toHaveLength(1);
    await t.endTurns();
    // Error B appears before error A ever cleared: the view and the report differ, so it is a new occurrence.
    t.state.screen = 'error A\nerror B';
    report = 'error B';
    await t.tick(30);
    expect(t.events).toHaveLength(2);
    expect(t.events[1]).toContain('error B');
    // Same view, same report: not again.
    await t.endTurns();
    await t.tick(30);
    expect(t.events).toHaveLength(2);
    // A wake-up whose turn never ends does not keep the watch past its time limit.
    t.state.screen = 'error C';
    report = 'error C';
    await t.tick(30);
    expect(t.events).toHaveLength(3);
    await t.tick(300);
    expect(t.events.at(-1)).toContain('reached its time limit');
    expect(t.watches.list(t.agent.id)).toEqual([]);
  } finally {
    await t.close();
  }
});

it('points a watch on a terminal running Claude Code to its listener', async () => {
  const t = await setup(vi.fn<Judge>(async () => ({ notify: false, summary: 'working' })));
  try {
    t.state.command = 'claude';
    const watch = await t.watches.create(t.agent.id, { ...terminalWatch, checkNow: false });
    expect(watch).toMatchObject({ kind: 'watch_terminal' });
    expect((watch as { hint?: string }).hint).toContain(
      'This terminal runs Claude Code. harness_listener_add({terminal})',
    );
  } finally {
    await t.close();
  }
});
