import { expect, it } from 'vitest';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { classify, accessOf } from './tool-access';
import { createHelpTool } from './help-tool';
import { createChatSession } from './chat-runtime';

const tool = (name: string, description = `${name} does a thing.`) =>
  defineTool({
    name,
    label: name,
    description,
    parameters: Type.Object({ path: Type.String() }, { additionalProperties: false }),
    async execute() {
      return { content: [], details: {} };
    },
  });
const tools = classify({ read: 'r', write: 'w', bash: 'rw', use_computer: 'claim', terminal_view: 'r' }, [
  tool('read'),
  tool('write'),
  tool('bash'),
  tool('use_computer'),
  tool('terminal_view'),
]);
const ask = async (params: object, heartbeat = false) => {
  const help = createHelpTool(
    () => tools,
    () => heartbeat,
  );
  const result = await help.execute('call', params as never, undefined, undefined, undefined as never);
  return (result.content[0] as { text: string }).text;
};

it('classifies every tool a factory makes and refuses one it forgot', () => {
  expect(tools.map(accessOf)).toEqual(['r', 'w', 'rw', 'claim', 'r']);
  expect(() => classify({ read: 'r' }, [tool('read'), tool('bash')])).toThrow('Tool bash has no access class.');
});

it('lists classes by default, one line each, and filters which tools and which fields', async () => {
  const all = await ask({});
  expect(all).toContain('read: r\nwrite: w\nbash: rw\nuse_computer: claim\nterminal_view: r\nhelp: r');
  expect(all).toContain('rw = reads and changes');
  expect(await ask({ class: 'r', match: 'terminal' })).toBe(
    'Classes: r = reads only; changes nothing anyone else can see.\nterminal_view: r',
  );
  const params = await ask({ tools: ['bash'], fields: ['params'] });
  expect(params.split('\n')[0]).toBe('# bash');
  expect(JSON.parse(params.split('\n')[1].slice('params: '.length))).toMatchObject({
    properties: { path: { type: 'string' } },
  });
  expect(params).not.toContain('does a thing');
  expect(await ask({ tools: ['bash'], fields: ['description', 'knowledge'] })).toBe(
    '# bash\nbash does a thing.\nknowledge: concepts/computers/files, practices/files',
  );
  expect(await ask({ tools: ['nope'] })).toBe('Not your tools: nope.\nNo tool matches.');
  expect(await ask({ class: 'w' }, true)).toContain(
    'In this heartbeat: r is free; the first w or rw call makes it your real turn.',
  );
  expect(await ask({ class: 'r' }, true)).not.toContain('heartbeat');
});

it('refuses a session with an untagged tool before calling any model', async () => {
  await expect(
    createChatSession(
      {
        name: 'A',
        model: 'model',
        thinkingLevel: 'off',
        baseUrl: 'http://127.0.0.1:9',
        channel: { id: 'c', kind: 'platform-chat', agentId: 'a' },
      },
      [],
      () => {},
      [tool('sneaky') as never],
    ),
  ).rejects.toThrow('Tool sneaky has no access class.');
});
