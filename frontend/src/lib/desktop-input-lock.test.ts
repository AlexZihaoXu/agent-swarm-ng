import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const html = readFileSync(new URL('../../public/desktop-frame.html', import.meta.url), 'utf8');
it('trusted frame starts input-locked and gates keys, pointer and shortcut messages across toggles', () => {
  const handlers = new Map<string, Array<(event: any) => void>>();
  const sent: string[] = [];
  let resets = 0;
  const parent = {};
  const window = {
    parent,
    swarmDesktopInputEnabled: undefined,
    webrtcInput: {
      inputAttached: true,
      send: (value: string) => sent.push(value),
      resetKeyboard: () => {
        resets++;
      },
      buttonMask: 0,
    },
    addEventListener: (name: string, handler: (event: any) => void) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
  };
  const context = { window, location: { origin: 'http://dashboard' }, document: { activeElement: { blur() {} } } };
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    if (
      (match[1].includes('swarmDesktopInputEnabled') || match[1].includes('const shortcuts')) &&
      !match[1].includes('navigator.clipboard') // covered by desktop-clipboard-gate.test.ts
    )
      runInNewContext(match[1], context);
  const message = (data: object, source: object = parent) =>
    handlers.get('message')!.forEach(handler => handler({ data, source, origin: 'http://dashboard' }));
  const shortcut = () => message({ type: 'swarm:desktop-shortcut', name: 'new-tab' });
  shortcut();
  expect(sent).toEqual([]);
  let blocked = 0;
  handlers.get('keydown')![0]({
    preventDefault() {
      blocked++;
    },
    stopImmediatePropagation() {},
  });
  expect(blocked).toBe(1);
  message({ type: 'swarm:desktop-input', enabled: true }, {});
  shortcut();
  expect(sent).toEqual([]);
  message({ type: 'swarm:desktop-input', enabled: true });
  shortcut();
  expect(sent).toEqual(['kd,65507', 'kd,116', 'ku,116', 'ku,65507']);
  message({ type: 'swarm:desktop-input', enabled: false });
  expect(resets).toBe(1);
  shortcut();
  expect(sent).toHaveLength(4);
  for (const kind of ['pointerdown', 'wheel', 'touchstart', 'paste']) expect(handlers.has(kind)).toBe(true);
});
