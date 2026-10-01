import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { ComputerUseService } from './service';
import { AgentRecordings } from './recordings';
import { SwarmSettingsStore } from '../swarm-settings';

const terminal = '12345678-1234-1234-1234-123456789abc';
async function fixture() {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const ada = await db.createAgent({ name: 'Ada', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
  const bo = await db.createAgent({ name: 'Bo', endpointId: 'm', model: 'm', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({
    data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' },
  });
  const service = new ComputerUseService(db, {
    capture: async () => ({}) as never,
    execute: async () => ({}) as never,
    cancel: async () => {},
  });
  await service.assign(ada.id, [computer.id]);
  await service.assign(bo.id, [computer.id]);
  const calls: { op: string; input: Record<string, any> }[] = [];
  const woken: { agentId: string; text: string }[] = [];
  let now = 1_790_000_000_000;
  const controller = async (_id: string, op: string, input: Record<string, any>) => {
    calls.push({ op, input });
    if (op === 'terminals') return { terminals: [{ id: terminal, name: 'build' }] };
    if (op === 'stop')
      return {
        folder: `/home/agent/${input.id}`,
        files: [{ name: 'clip-01-desktop.mp4', size: 2048, seconds: 3 }],
        sheet: null,
      };
    return { id: input.id };
  };
  const recordings = new AgentRecordings(
    db,
    service,
    () => controller as never,
    new SwarmSettingsStore(db),
    (agentId, text) => void woken.push({ agentId, text }),
    () => now,
  );
  return {
    db,
    ada,
    bo,
    computer,
    service,
    recordings,
    calls,
    woken,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
    close: async () => {
      recordings.close();
      await db.close();
    },
  };
}

it('records sources the agent can read into one folder, tells the holder, and keeps to the limits', async () => {
  const f = await fixture();
  try {
    await f.service.use(f.bo.id, 'Desk', true);
    await f.service.use(f.ada.id, 'Desk');
    const started = await f.recordings.start(f.ada.id, {
      sources: ['desktop', { terminal }],
      mode: 'events',
      events: { 'mouse.move_to': { before: 2.5, after: 2.5 }, mark: {} },
      human: true,
    });
    expect(started.recordings.map(item => item.source)).toEqual(['desktop', 'terminal build']);
    const starts = f.calls.filter(call => call.op === 'start').map(call => call.input);
    expect(starts.map(input => input.label)).toEqual(['desktop', 'terminal-build']);
    expect(new Set(starts.map(input => input.folder)).size).toBe(1);
    expect(starts[0].folder).toMatch(/^Videos\/agent-recordings\/2026-09-21_\d\d-\d\d-\d\d_Ada$/);
    expect(starts[0]).toMatchObject({ fps: 30, kbps: 1000, defaults: [2.5, 2.5], maxSeconds: 1800 });
    expect(starts[1]).toMatchObject({ session: terminal, fps: 15 });
    // Terminal events never count for a desktop recording, and the reverse.
    expect(starts[0].rules).toEqual({ 'mouse.move_to': { before: 2.5, after: 2.5 }, mark: {} });
    expect(starts[1].rules).toEqual({ mark: {} });
    expect(f.woken).toEqual([
      { agentId: f.bo.id, text: expect.stringContaining('Ada started recording Desk (desktop, terminal-build)') },
    ]);
    expect(await f.db.client.agentRecording.count()).toBe(2);
    await expect(f.recordings.start(f.ada.id, { sources: ['desktop'], mode: 'session', human: true })).rejects.toThrow(
      'desktop is already recording',
    );
    await expect(
      f.recordings.start(f.bo.id, { sources: ['desktop', 'desktop'], mode: 'session', human: true }),
    ).rejects.toThrow('At most 3 sources recording at once on Desk');
    await expect(
      f.recordings.start(f.bo.id, {
        sources: ['desktop'],
        mode: 'events',
        events: { 'terminal.type': {} },
        human: true,
      }),
    ).rejects.toThrow('terminal.type is not an event of the desktop recording you chose');
    await expect(
      f.recordings.start(f.bo.id, { sources: [{ terminal: crypto.randomUUID() }], mode: 'session', human: true }),
    ).rejects.toThrow('No terminal');
  } finally {
    await f.close();
  }
});

it('reminds halfway through the lease, renews them all at once, and saves what is not renewed', async () => {
  const f = await fixture();
  try {
    await f.service.use(f.ada.id, 'Desk');
    await f.recordings.start(f.ada.id, { sources: ['desktop'], mode: 'session', human: true });
    f.advance(149);
    await f.recordings.tick();
    expect(f.woken).toEqual([]);
    f.advance(2);
    await f.recordings.tick();
    await f.recordings.tick();
    expect(f.woken).toHaveLength(1);
    expect(f.woken[0].text).toContain('desktop on Desk has run 2:30 since you last renewed');
    expect(f.woken[0].text).toContain('renew_recording');
    f.advance(100);
    expect(await f.recordings.renew(f.ada.id)).toMatchObject({ renewed: ['desktop'] });
    f.advance(290);
    await f.recordings.tick();
    expect(f.recordings.forAgent(f.ada.id)).toHaveLength(1);
    f.advance(15);
    await f.recordings.tick();
    expect(f.recordings.forAgent(f.ada.id)).toHaveLength(0);
    expect(f.woken.at(-1)!.text).toContain('stopped (it was not renewed within 5:00) and was saved');
    const stop = f.calls.find(call => call.op === 'stop')!.input;
    expect(stop.notes[0].text).toMatch(/^renewed \(lease until/);
    expect(await f.db.client.agentRecording.count()).toBe(0);
  } finally {
    await f.close();
  }
});

it('marks and stops on request, stops when the assignment goes, and saves after a restart', async () => {
  const f = await fixture();
  try {
    await f.service.use(f.ada.id, 'Desk');
    await f.recordings.start(f.ada.id, { sources: ['desktop'], mode: 'events', human: true });
    expect(f.calls.find(call => call.op === 'start')!.input.rules).toEqual({ '*': {} });
    await f.recordings.mark(f.ada.id, 'build failed');
    expect(f.calls.at(-1)).toMatchObject({ op: 'mark', input: { label: 'build failed' } });
    const [saved] = await f.recordings.stop(f.ada.id);
    expect(saved).toMatchObject({ label: 'desktop', computer: 'Desk', files: [{ name: 'clip-01-desktop.mp4' }] });
    await expect(f.recordings.stop(f.ada.id)).rejects.toThrow('You are not recording anything.');
    await f.recordings.start(f.ada.id, { sources: ['desktop'], mode: 'session', human: false });
    await f.service.assign(f.ada.id, []);
    await f.recordings.tick();
    expect(f.woken.at(-1)!.text).toContain('its computer assignment was removed');
    // A row left by a backend that stopped: the next start saves it and leaves a notice.
    await f.db.client.agentRecording.create({
      data: { id: crypto.randomUUID(), agentId: f.bo.id, computerId: f.computer.id, label: 'desktop', folder: 'x' },
    });
    const next = new AgentRecordings(
      f.db,
      f.service,
      () => (async () => ({ folder: '/home/agent/x', files: [] })) as never,
      new SwarmSettingsStore(f.db),
      () => {},
    );
    await next.ready();
    next.close();
    expect(await f.db.client.agentRecording.count()).toBe(0);
    expect((await f.service.notices(f.bo.id))[0].text).toContain(
      'The platform restarted, so your recording (desktop) was stopped and saved',
    );
  } finally {
    await f.close();
  }
});
