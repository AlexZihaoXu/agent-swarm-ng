import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../../scripts/patch-selkies-http-client.mjs', import.meta.url), 'utf8');
it('versions the mutable vendor derivative so a cached pre-cursor client cannot hide the remote pointer', () => {
  const html = readFileSync(new URL('../../public/desktop-frame.html', import.meta.url), 'utf8');
  const pin = source.match(/sha256\(patched\) !== '([a-f0-9]{64})'/)![1];
  const imports = JSON.parse(html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/)![1]).imports;
  expect(imports['./assets/selkies-core-BbKps5RD.js']).toBe(`./assets/selkies-core-BbKps5RD.js?swarm-revision=${pin}`);
  expect(html).toContain(`src="./assets/index-CPWh3fQ6.js?swarm-revision=${pin}"`);
  expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'));
});
const rules = runInNewContext(source.match(/const cursorPatches = (\[[\s\S]*?\n\]);/)![1]) as [
  string,
  string,
  number,
][];
it('requests the real composited cursor on stream initialization, independently of input lock', () => {
  const code = rules.find(([needle]) => needle.startsWith('Rt&&'))![1] + ')';
  const messages: string[] = [];
  const context = {
    Rt: false,
    l: { readyState: 1, send: (message: string) => messages.push(message) },
    WebSocket: { OPEN: 1 },
    window: { __swarmNativeCursor: true, swarmDesktopInputEnabled: false },
  };
  runInNewContext(code, context);
  expect(messages).toEqual(['SET_NATIVE_CURSOR_RENDERING,1']);
  context.window.swarmDesktopInputEnabled = true;
  runInNewContext(code, context);
  expect(messages).toEqual(['SET_NATIVE_CURSOR_RENDERING,1', 'SET_NATIVE_CURSOR_RENDERING,1']);
});
it('a shared viewer cannot accidentally remove the native cursor on unlock/detach', () => {
  for (const [needle, replacement] of rules.filter(([needle]) => needle.includes(',0'))) {
    const messages: string[] = [];
    const sender = {
      send: (value: string) => messages.push(value),
      sendDataChannelMessage: (value: string) => messages.push(value),
    };
    const context = { window: { __swarmNativeCursor: true }, sender, l: sender, O: sender };
    runInNewContext(replacement.replaceAll('this.send', 'sender.send'), context);
    expect(messages[0], needle).toMatch(/,1$/);
    context.window.__swarmNativeCursor = false;
    runInNewContext(replacement.replaceAll('this.send', 'sender.send'), context);
    expect(messages[1], needle).toMatch(/,0$/);
  }
});
it('does not draw a duplicate local cursor and leaves upstream behavior when not opted in', async () => {
  const prefix = rules.find(([needle]) => needle === 'async updateServerCursor(e){')![1];
  const window = { __swarmNativeCursor: true };
  const cursor = {
    cursorDiv: { style: { display: 'block' } },
    element: {
      style: {
        setProperty(name: string, value: string) {
          expect(name).toBe('cursor');
          expect(value).toBe('none');
        },
      },
    },
  };
  const fn = runInNewContext(`({${prefix}throw new Error('upstream');}}).updateServerCursor`, { window });
  await fn.call(cursor, {});
  expect(cursor.cursorDiv.style.display).toBe('none');
  window.__swarmNativeCursor = false;
  await expect(fn.call(cursor, {})).rejects.toThrow('upstream');
});
