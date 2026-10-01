import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { ComputerUseService } from './service';
import { ScreenshotPool } from './image-pool';
import { createComputerTools, COMPUTER_USE_GUIDANCE } from './tools';
import { swarmKnowledge } from '../swarm-knowledge/entries';
import { validateToolArguments } from '@earendil-works/pi-ai';
it('binds real agent identity, returns model image content and maps name/params combos to the controller', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const pool = new ScreenshotPool(join(db.dataDirectory, 'computer-screenshots'));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'gpt-4o', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({
    data: { name: 'Desk', state: 'running', requestKey: crypto.randomUUID() },
  });
  let received: unknown;
  const captures: unknown[] = [];
  const service = new ComputerUseService(db, {
    capture: async (_id, request) => {
      captures.push(request);
      const full = (request as { quality?: string }).quality === 'full';
      return {
        mimeType: 'image/jpeg',
        data: Buffer.from([255, 216, 255, 217]),
        bounds: [0, 0, 999, 999],
        width: full ? 1920 : 634,
        height: full ? 1080 : 356,
      };
    },
    cancel: async () => {},
    execute: async (_id, request) => {
      received = request;
      return { started: true, completed: 1, error: null };
    },
  });
  try {
    await service.assign(agent.id, [computer.id]);
    const tools = createComputerTools(service, pool, agent.id);
    const invoke = (name: string, args: object, vision = true) =>
      tools
        .find(tool => tool.name === name)!
        .execute('call', args as never, undefined, undefined, {
          model: { input: vision ? ['text', 'image'] : ['text'] },
        } as never);
    await invoke('use_computer', { computer: 'Desk', write: true });
    await expect(invoke('glance', {}, false)).rejects.toThrow(/image input/);
    await expect(invoke('run_actions', { actions: [{ name: 'mouse.left_click' }] })).rejects.toThrow(/look/i);
    const shot = await invoke('look_at', { x: 0, y: 500, size: 100 });
    expect(shot.content[1].type).toBe('image');
    expect(JSON.stringify(shot.details)).toContain('computerImage');
    const glance = tools.find(tool => tool.name === 'glance')!;
    expect(
      validateToolArguments(glance, { type: 'toolCall', id: 'full', name: 'glance', arguments: { quality: 'full' } }),
    ).toEqual({ quality: 'full' });
    expect(() =>
      validateToolArguments(glance, { type: 'toolCall', id: 'bad', name: 'glance', arguments: { quality: 'native' } }),
    ).toThrow();
    const full = await invoke('glance', { quality: 'full' });
    expect(captures.at(-1)).toEqual({ kind: 'glance', quality: 'full' });
    expect(JSON.parse((full.content[0] as { text: string }).text)).toMatchObject({
      width: 1920,
      height: 1080,
      resolution: 'full',
    });
    await invoke('run_actions', { actions: [{ name: 'keyboard.type', params: { text: 'Hi', cpm: 800 } }] });
    expect(received).toEqual({
      actions: [{ type: 'keyboard.type', text: 'Hi', cpm: 800 }],
      per_action_pause: undefined,
    });
    await service.assign(agent.id, []);
    await expect(invoke('glance', {})).rejects.toThrow(/use_computer/);
  } finally {
    await pool.removeAgent(agent.id);
    await db.close();
  }
});
it('teaches the computer tools through real Knowledge entries and prompt guidance', () => {
  for (const id of ['practices/computer-use', 'practices/desktop', 'practices/browser', 'practices/waiting']) {
    expect(swarmKnowledge.read({ id }).text.length).toBeGreaterThan(200);
    expect(COMPUTER_USE_GUIDANCE).toContain(id);
  }
  expect(COMPUTER_USE_GUIDANCE).toContain('low is for orientation');
  expect(COMPUTER_USE_GUIDANCE).toContain('quality:"full"');
  const actions =
    swarmKnowledge.read({ id: 'practices/desktop' }).text +
    swarmKnowledge.read({ id: 'concepts/computers/desktop' }).text;
  expect(actions).toContain('100%');
  expect(actions).toContain('0.2');
  expect(actions).toContain('Do not guess');
  const browser = swarmKnowledge.read({ id: 'practices/browser' }).text;
  expect(browser).toContain('ONE attempt');
  expect(browser).toContain('before trying');
  expect(browser).toContain('Google');
  expect(browser).toContain('GitHub');
});
