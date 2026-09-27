import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { ComputerUseService } from './service';
import { ScreenshotPool } from './image-pool';
import { createComputerTools, COMPUTER_USE_GUIDANCE } from './tools';
import { swarmKnowledge } from '../swarm-knowledge/entries';
it('binds real agent identity, returns model image content and maps name/params combos to the controller', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const pool = new ScreenshotPool(join(db.dataDirectory, 'computer-screenshots'));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'gpt-4o', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({ data: { name: 'Desk', state: 'running', requestKey: crypto.randomUUID() } });
  let received: unknown;
  const service = new ComputerUseService(db, { capture: async () => ({ mimeType: 'image/jpeg', data: Buffer.from([255,216,255,217]), bounds: [0,0,999,999], width: 634, height: 356 }), cancel: async () => {}, execute: async (_id, request) => { received = request; return { started: true, completed: 1, error: null }; } });
  try {
    await service.assign(agent.id, [computer.id]);
    const tools = createComputerTools(service, pool, agent.id);
    const invoke = (name: string, args: object, vision = true) => tools.find(tool => tool.name === name)!.execute('call', args as never, undefined, undefined, { model: { input: vision ? ['text','image'] : ['text'] } } as never);
    await invoke('use_computer', { computer: 'Desk' });
    await expect(invoke('glance', {}, false)).rejects.toThrow(/image input/);
    await expect(invoke('run_actions', { actions: [{ name: 'mouse.left_click' }] })).rejects.toThrow(/look/i);
    const shot = await invoke('look_at', { x: 0, y: 500, size: 100 });
    expect(shot.content[1].type).toBe('image'); expect(JSON.stringify(shot.details)).toContain('computerImage');
    await invoke('run_actions', { actions: [{ name: 'keyboard.type', params: { text: 'Hi', cpm: 800 } }] });
    expect(received).toEqual({ actions: [{ type: 'keyboard.type', text: 'Hi', cpm: 800 }], per_action_pause: undefined });
    await service.assign(agent.id, []);
    await expect(invoke('glance', {})).rejects.toThrow(/use_computer/);
  } finally { await pool.removeAgent(agent.id); await db.close(); }
});
it('teaches the computer tools through real Knowledge entries and prompt guidance', () => {
  for (const id of ['use','actions','browser']) {
    expect(swarmKnowledge.read({ id: `swarm/computers/${id}` }).text.length).toBeGreaterThan(200);
    expect(COMPUTER_USE_GUIDANCE).toContain(`swarm/computers/${id}`);
  }
  const browser = swarmKnowledge.read({ id: 'swarm/computers/browser' }).text;
  expect(browser).toContain('ONE attempt'); expect(browser).toContain('before trying'); expect(browser).toContain('Google'); expect(browser).toContain('GitHub');
});
